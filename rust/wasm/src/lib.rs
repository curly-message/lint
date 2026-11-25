//! `curly-message-lint` as the WebAssembly module `@curly-message/lint`
//! runs: the rules, the catalogue reader and the command, each behind one
//! export, with the plural rules, the files and the streams of the runtime
//! behind its imports. Offsets leave in UTF-16 code units, the unit of a
//! JavaScript string.

#![cfg(target_arch = "wasm32")]

mod abi;
mod host;
mod memory;
mod plurals;
mod wire;

use std::iter::{Peekable, once};

use curly_message_lint::command::run;
use curly_message_lint::{
    CatalogueFinding, EntriesOptions, Entry, Finding, Located, Options, RULES, Replaced, Rule,
    Scope, Severity, Unreadable, lint_entries, lint_entries_uncompared, lint_message,
    read_catalogue, read_findings,
};

use crate::host::Runtime;
use crate::plurals::Hosted;
use crate::wire::{Answer, Request, in_units};

const INTL: usize = 1;
const NAMED: usize = 2;
const UNCOMPARED: usize = 4;

/// About how many bytes one answer holds: it ends with the first item past
/// them, so that what a call answers crosses in pieces none of which grows
/// with it.
const ANSWER: usize = 1 << 20;

/// Ends the call where the host could not answer an import: it has kept
/// why, and no answer of the module's own would be the host's.
fn fail() -> ! {
    std::process::abort()
}

fn severity(of: Severity) -> usize {
    match of {
        Severity::Error => 0,
        Severity::Warning => 1,
    }
}

/// A finding but for where it is: its rule by its place in `RULES` with its
/// severity past eight bits, its message and the section it rests on.
fn found(answer: &mut Answer, finding: &Finding) {
    let rule = RULES
        .iter()
        .position(|rule| rule.code == finding.code)
        .unwrap_or(usize::MAX);

    answer.number(rule | severity(finding.severity).saturating_mul(256));
    answer.text(&finding.message);
    answer.text(finding.section.unwrap_or(""));
}

fn path(answer: &mut Answer, path: &[String]) {
    answer.number(path.len());
    path.iter().for_each(|name| answer.text(name));
}

/// What an answer is written of, each already placed in code units.
enum Item {
    Number(usize),
    Found(Finding),
    Catalogued(CatalogueFinding),
    Replaced(Replaced),
    String(Located),
    Unreadable(Unreadable),
    Rule(&'static Rule),
}

impl Item {
    fn write(self, answer: &mut Answer) {
        match self {
            Self::Number(number) => answer.number(number),
            Self::Found(finding) => {
                found(answer, &finding);
                answer.number(finding.start);
                answer.number(finding.end);
            }
            Self::Catalogued(catalogued) => {
                answer.number(catalogued.entry);
                Self::Found(catalogued.finding).write(answer);
            }
            Self::Replaced(replaced) => {
                path(answer, &replaced.path);
                answer.number(replaced.start);
                answer.number(replaced.end);
            }
            Self::String(located) => {
                path(answer, &located.path);
                answer.text(&located.value);
                answer.number(located.start);
                answer.number(located.end);

                // Each escape sequence: the code unit of the value it spells,
                // and how long it is written, which no sequence writes with
                // anything but ASCII.
                let (mut spelled, written): (Vec<usize>, Vec<usize>) = located
                    .escapes()
                    .map(|escape| (escape.index, escape.end.saturating_sub(escape.start)))
                    .unzip();

                in_units(&located.value, &mut spelled);
                answer.number(spelled.len());

                for (spelled, written) in spelled.into_iter().zip(written) {
                    answer.number(spelled);
                    answer.number(written);
                }
            }
            Self::Unreadable(unreadable) => {
                answer.text(&unreadable.message);
                answer.number(unreadable.offset);
            }
            Self::Rule(rule) => {
                answer.number(severity(rule.severity));
                answer.number(match rule.scope {
                    Scope::Message => 0,
                    Scope::Locale => 1,
                    Scope::Catalogue => 2,
                });
                answer.text(rule.name);
                answer.text(rule.section.unwrap_or(""));
                answer.text(rule.description);
            }
        }
    }
}

/// What is left to answer of a call, each item let go once it is written.
pub struct Answers(Peekable<Box<dyn Iterator<Item = Item>>>);

/// The first answer of a call that answers `items`, and what is left.
fn answers(items: impl Iterator<Item = Item> + 'static) -> (Answer, Option<Box<Answers>>) {
    let items: Box<dyn Iterator<Item = Item>> = Box::new(items);

    next(Box::new(Answers(items.peekable())))
}

/// The next answer of a call, and what is left, where anything is.
fn next(mut answers: Box<Answers>) -> (Answer, Option<Box<Answers>>) {
    let mut answer = Answer::default();

    while answer.size() < ANSWER {
        match answers.0.next() {
            Some(item) => item.write(&mut answer),
            None => break,
        }
    }

    let more = answers.0.peek().is_some();

    (answer, more.then_some(answers))
}

/// A request's flags, an optional name where they say one follows, and the
/// modifiers the host registers.
fn options(request: &mut Request<'_>) -> (usize, Option<String>, Vec<String>) {
    let flags = request.number();
    let named = (flags & NAMED != 0).then(|| request.text().to_owned());

    (flags, named, request.texts())
}

fn message(bytes: Box<[u8]>) -> (Answer, Option<Box<Answers>>) {
    let mut request = Request::new(&bytes);
    let (flags, locale, modifiers) = options(&mut request);
    let message = request.text();
    let mut options = Options::default()
        .modifiers(&modifiers)
        .intl(flags & INTL != 0);

    if let Some(locale) = &locale {
        options = options.locale(locale);
    }

    let mut findings = lint_message(message, &options, &Hosted);

    in_units(
        message,
        findings
            .iter_mut()
            .flat_map(|finding| [&mut finding.start, &mut finding.end]),
    );

    answers(once(Item::Number(findings.len())).chain(findings.into_iter().map(Item::Found)))
}

/// A list of entries the host hands in batches, and what it is linted with.
pub struct List {
    flags: usize,
    source: Option<String>,
    modifiers: Vec<String>,
    locales: Vec<String>,
    entries: Vec<Entry>,
}

/// Adds a batch to a list: where it opens the list, what the list is
/// linted with, then how many entries it holds and each entry's locale, id
/// and message.
fn push(list: Option<Box<List>>, bytes: Box<[u8]>) -> Box<List> {
    let mut request = Request::new(&bytes);
    let mut list = list.unwrap_or_else(|| {
        let (flags, source, modifiers) = options(&mut request);

        Box::new(List {
            flags,
            source,
            modifiers,
            locales: request.texts(),
            entries: Vec::new(),
        })
    });
    let count = request.number();

    list.entries.reserve(count);

    for _ in 0..count {
        list.entries.push(Entry {
            locale: request.text().to_owned(),
            id: request.text().to_owned(),
            message: request.text().to_owned(),
        });
    }

    list
}

fn entries(list: Option<Box<List>>, bytes: Box<[u8]>) -> (Answer, Option<Box<Answers>>) {
    let List {
        flags,
        source,
        modifiers,
        locales,
        entries,
    } = *push(list, bytes);
    let mut options = EntriesOptions::default()
        .modifiers(&modifiers)
        .intl(flags & INTL != 0)
        .locales(&locales);

    if let Some(source) = &source {
        options = options.source(source);
    }

    let lint = if flags & UNCOMPARED == 0 {
        lint_entries
    } else {
        lint_entries_uncompared
    };
    let mut findings = lint(&entries, &options, &Hosted);

    // The findings come ordered by entry, so each message is read once.
    for of_entry in findings.chunk_by_mut(|one, other| one.entry == other.entry) {
        let message = of_entry
            .first()
            .and_then(|first| entries.get(first.entry))
            .map_or("", |entry| entry.message.as_str());

        in_units(
            message,
            of_entry
                .iter_mut()
                .flat_map(|found| [&mut found.finding.start, &mut found.finding.end]),
        );
    }

    // What is answered holds no message, and the list is held no longer.
    drop(entries);

    answers(once(Item::Number(findings.len())).chain(findings.into_iter().map(Item::Catalogued)))
}

fn read(bytes: Box<[u8]>) -> (Answer, Option<Box<Answers>>) {
    let mut request = Request::new(&bytes);
    let text = request.text();
    let mut read = read_catalogue(text);
    let mut findings = read_findings(&read);

    // Every place in the file the answer names, read off the text at once.
    {
        let mut places: Vec<&mut usize> = findings
            .iter_mut()
            .flat_map(|finding| [&mut finding.start, &mut finding.end])
            .collect();

        match &mut read {
            Ok(catalogue) => {
                places.extend(
                    catalogue
                        .replaced
                        .iter_mut()
                        .flat_map(|of| [&mut of.start, &mut of.end]),
                );
                places.extend(
                    catalogue
                        .strings
                        .iter_mut()
                        .flat_map(|of| [&mut of.start, &mut of.end]),
                );
            }
            Err(unreadable) => places.push(&mut unreadable.offset),
        }

        in_units(text, places);
    }

    drop(request);
    drop(bytes);

    let found = once(Item::Number(findings.len())).chain(findings.into_iter().map(Item::Found));
    let read: Box<dyn Iterator<Item = Item>> = match read {
        Ok(catalogue) => Box::new(
            [Item::Number(1), Item::Number(catalogue.replaced.len())]
                .into_iter()
                .chain(catalogue.replaced.into_iter().map(Item::Replaced))
                .chain(once(Item::Number(catalogue.strings.len())))
                .chain(catalogue.strings.into_iter().map(Item::String)),
        ),
        Err(unreadable) => Box::new([Item::Number(0), Item::Unreadable(unreadable)].into_iter()),
    };

    answers(found.chain(read))
}

fn rules() -> (Answer, Option<Box<Answers>>) {
    answers(once(Item::Number(RULES.len())).chain(RULES.iter().map(Item::Rule)))
}

fn command(bytes: Box<[u8]>) -> i32 {
    let mut request = Request::new(&bytes);
    let separator = u32::try_from(request.number())
        .ok()
        .and_then(char::from_u32)
        .unwrap_or('/');
    let argv = request.texts();

    run(&argv, &mut Runtime { separator })
}
