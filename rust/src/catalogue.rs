use std::collections::{HashMap, HashSet};

use curly_message_parser::{modifier_input, string_conversion};

use crate::finding::{CatalogueFinding, Finding};
use crate::message::{FORMATTING, Modifiers, Options, lint_tree, resolvable};
use crate::plural::{Asked, Plurals, bits};
use crate::rules::Code;
use crate::tag::locale_key;
use crate::tree::{Placeholder, Tree, read};

/// A message, the id a catalogue gives it and the locale it is written for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entry {
    pub locale: String,
    pub id: String,
    pub message: String,
}

/// What a host gives the rules of a catalogue: [`EntriesOptions::default`],
/// with what differs from it set.
#[derive(Clone, Copy, Debug)]
#[non_exhaustive]
pub struct EntriesOptions<'a> {
    /// The names of the modifiers a host registers (section 11.3).
    pub modifiers: &'a [String],
    /// Whether the host satisfies the Intl level (section 2).
    pub intl: bool,
    /// The locale every other is compared with. Where none is named, `en` is
    /// where the catalogue holds it, and otherwise the first locale. Two
    /// tags that differ only in case, or in `_` for `-`, name one locale. A
    /// source no message and no locale of `locales` is written for is a
    /// `missing-source` error; one that holds no message is compared as any
    /// other.
    pub source: Option<&'a str>,
    /// The locales the catalogue is written for, a locale with no message
    /// among them, which lacks every message of the source locale. A
    /// spelling of a locale whose messages are written otherwise is a
    /// `duplicate-locale` warning.
    pub locales: &'a [String],
}

impl Default for EntriesOptions<'_> {
    fn default() -> Self {
        Self {
            modifiers: &[],
            intl: true,
            source: None,
            locales: &[],
        }
    }
}

impl<'a> EntriesOptions<'a> {
    /// The options with the modifiers a host registers.
    #[must_use]
    pub const fn modifiers(mut self, modifiers: &'a [String]) -> Self {
        self.modifiers = modifiers;
        self
    }

    /// The options with whether the host satisfies the Intl level.
    #[must_use]
    pub const fn intl(mut self, intl: bool) -> Self {
        self.intl = intl;
        self
    }

    /// The options with the locale every other is compared with.
    #[must_use]
    pub const fn source(mut self, source: &'a str) -> Self {
        self.source = Some(source);
        self
    }

    /// The options with the locales the catalogue is written for.
    #[must_use]
    pub const fn locales(mut self, locales: &'a [String]) -> Self {
        self.locales = locales;
        self
    }
}

/// Which messages are compared with the source locale's.
#[derive(Clone, Copy)]
pub(crate) enum Comparing<'a> {
    None,
    All,
    /// Those whose ids the function takes.
    Ids(&'a dyn Fn(&str) -> bool),
}

/// Values in the order they were first inserted, each under its key.
struct Ordered<T> {
    keys: Vec<String>,
    values: HashMap<String, T>,
}

impl<T> Ordered<T> {
    fn new() -> Self {
        Self {
            keys: Vec::new(),
            values: HashMap::new(),
        }
    }

    fn get(&self, key: &str) -> Option<&T> {
        self.values.get(key)
    }

    fn insert(&mut self, key: &str, value: T) {
        if self.values.insert(key.to_owned(), value).is_none() {
            self.keys.push(key.to_owned());
        }
    }

    fn iter(&self) -> impl Iterator<Item = (&str, &T)> {
        self.keys
            .iter()
            .filter_map(|key| Some((key.as_str(), self.values.get(key)?)))
    }

    fn first(&self) -> Option<&T> {
        self.iter().next().map(|(_, value)| value)
    }
}

/// What a message reads of one parameter, as the source locale's is
/// compared with it.
struct Parameter {
    name: Box<str>,
    /// Where the parameter is first read.
    first: (usize, usize),
    /// How it is shown, each way once (see `showing`).
    shown: Box<[Box<str>]>,
    /// Where its first plural selection points, where it has one.
    plural: Option<(usize, usize)>,
    /// The numbers its plural selections give text of their own, where it
    /// has one.
    numbers: Box<[f64]>,
    /// Those numbers, and the numbers its `eq` comparisons spell, by their
    /// bits, where it has one.
    keyed: Box<[u64]>,
}

/// The parameters a message reads, in the order it first reads each: what
/// a comparison takes of a message, which is all a catalogue holds of it.
type Parameters = Box<[Parameter]>;

fn parameters_of(tree: &Tree, modifiers: Modifiers<'_>) -> Parameters {
    let mut index: HashMap<&str, usize> = HashMap::new();
    let mut named: Vec<Vec<&Placeholder>> = Vec::new();

    for placeholder in resolvable(tree) {
        let Some(key) = &placeholder.key else {
            continue;
        };

        match index
            .get(key.name.as_str())
            .and_then(|at| named.get_mut(*at))
        {
            Some(placeholders) => placeholders.push(placeholder),
            None => {
                index.insert(&key.name, named.len());
                named.push(vec![placeholder]);
            }
        }
    }

    named
        .iter()
        .filter_map(|placeholders| {
            let first = placeholders.first()?;
            let plural = selecting(placeholders, PLURALS, modifiers)
                .next()
                .map(Placeholder::at);
            let (numbers, keyed) = if plural.is_some() {
                let numbers: Box<[f64]> =
                    numbers_of(selecting(placeholders, PLURALS, modifiers), false).collect();
                let keyed = numbers
                    .iter()
                    .copied()
                    .chain(numbers_of(
                        selecting(placeholders, &["eq"], modifiers),
                        true,
                    ))
                    .map(bits)
                    .collect();

                (numbers, keyed)
            } else {
                (Box::default(), Box::default())
            };

            Some(Parameter {
                name: first.key.as_ref()?.name.as_str().into(),
                first: (first.start, first.end),
                shown: showing(placeholders, modifiers)
                    .into_iter()
                    .map(Box::from)
                    .collect(),
                plural,
                numbers,
                keyed,
            })
        })
        .collect()
}

/// A message a locale is compared by, and the parameters it reads where it
/// is compared.
struct Read {
    entry: usize,
    parameters: Option<Parameters>,
}

// Each locale by its key, named as its first message writes it, or as
// `options.locales` does, with the first message under each id, the one the
// locale is compared by.
struct Locale {
    name: String,
    written: Option<String>,
    messages: Ordered<Read>,
}

// Once a locale has two spellings, each keeps the ids it defines; until
// then, those of the locale's messages are the first spelling's.
struct Spelling {
    locale: usize,
    ids: Option<HashSet<String>>,
}

#[derive(Default)]
struct Locales {
    locales: Vec<Locale>,
    keyed: HashMap<String, usize>,
    spelled: HashMap<String, Spelling>,
}

impl Locales {
    fn spelling_of(&mut self, written: &str) -> &mut Spelling {
        let Self {
            locales,
            keyed,
            spelled,
        } = self;

        spelled.entry(written.to_owned()).or_insert_with(|| {
            let locale = *keyed.entry(locale_key(written)).or_insert_with(|| {
                locales.push(Locale {
                    name: written.to_owned(),
                    written: None,
                    messages: Ordered::new(),
                });

                locales.len().saturating_sub(1)
            });

            Spelling { locale, ids: None }
        })
    }

    fn keyed(&self, tag: &str) -> Option<&Locale> {
        self.keyed
            .get(&locale_key(tag))
            .and_then(|index| self.locales.get(*index))
    }
}

// The ids of a locale's messages, which its first spelling takes once a
// second is read.
fn ids_of(locale: &Locale) -> HashSet<String> {
    #[cfg(test)]
    tests::COPIED
        .with(|copied| copied.set(copied.get().saturating_add(locale.messages.keys.len())));

    locale.messages.keys.iter().cloned().collect()
}

struct Report<'a> {
    findings: Vec<CatalogueFinding>,
    entries: &'a [Entry],
}

impl Report<'_> {
    fn add(&mut self, entry: usize, finding: Finding) {
        self.findings.push(CatalogueFinding { finding, entry });
    }

    fn make(&mut self, entry: usize, code: Code, section: Option<&'static str>, message: String) {
        self.make_at(entry, code, section, message, (0, 0));
    }

    fn make_at(
        &mut self,
        entry: usize,
        code: Code,
        section: Option<&'static str>,
        message: String,
        at: (usize, usize),
    ) {
        self.add(entry, Finding::new(code, section, message, at));
    }

    fn locale(&self, entry: usize) -> &str {
        self.entries.get(entry).map_or("", |entry| &entry.locale)
    }

    fn sorted(mut self) -> Vec<CatalogueFinding> {
        self.findings.sort_by(|a, b| {
            a.entry
                .cmp(&b.entry)
                .then_with(|| a.finding.by_place(&b.finding))
        });

        self.findings
    }
}

/// Lints a list of messages as one catalogue: each message, each with its
/// locale, then every locale against the source one. A finding names its
/// message by `entry`, the index of the message in `entries`.
pub fn lint_entries(
    entries: &[Entry],
    options: &EntriesOptions<'_>,
    plurals: &dyn Plurals,
) -> Vec<CatalogueFinding> {
    lint_entries_comparing(entries, options, Comparing::All, plurals)
}

/// Lints a list of messages as [`lint_entries`] does, but compares no
/// locale with the source one, so `options.source` is not read: each
/// message is linted with its locale, and each locale on its own, for an id
/// it defines twice and a locale written two ways. What a host lints where
/// it knows a catalogue only in part, since a comparison would report what
/// lies past the part it read as missing.
pub fn lint_entries_uncompared(
    entries: &[Entry],
    options: &EntriesOptions<'_>,
    plurals: &dyn Plurals,
) -> Vec<CatalogueFinding> {
    lint_entries_comparing(entries, options, Comparing::None, plurals)
}

/// Lints a list of messages as `lint_entries` does, comparing with the
/// source locale only the messages `comparing` takes. Each message is still
/// linted with its locale, and each locale on its own.
pub(crate) fn lint_entries_comparing(
    entries: &[Entry],
    options: &EntriesOptions<'_>,
    comparing: Comparing<'_>,
    plurals: &dyn Plurals,
) -> Vec<CatalogueFinding> {
    let modifiers = Modifiers {
        intl: options.intl,
        hosted: options.modifiers,
    };
    let mut asked = Asked::new(plurals);
    let mut report = Report {
        findings: Vec::new(),
        entries,
    };
    let mut all = Locales::default();

    for locale in options.locales {
        all.spelling_of(locale);
    }

    for (
        entry,
        Entry {
            locale: written,
            id,
            message,
        },
    ) in entries.iter().enumerate()
    {
        let tree = read(message);
        let message_options = Options {
            modifiers: options.modifiers,
            intl: options.intl,
            locale: Some(written),
        };

        for found in lint_tree(message, &tree, &message_options, &mut asked) {
            report.add(entry, found);
        }

        let spelling = all.spelling_of(written);
        let (index, split) = (spelling.locale, spelling.ids.is_some());
        let Some(locale) = all.locales.get_mut(index) else {
            continue;
        };
        let first = locale.messages.get(id).map(|read| read.entry);
        let mut another: Option<String> = None;

        match &locale.written {
            None => {
                locale.written = Some(written.clone());
                locale.name.clone_from(written);
            }
            Some(earlier) if !split && earlier != written => another = Some(earlier.clone()),
            Some(_) => {}
        }

        if let Some(earlier) = another {
            all.spelling_of(written).ids = Some(HashSet::new());

            if all.spelling_of(&earlier).ids.is_none() {
                let ids = all.locales.get(index).map(ids_of);

                all.spelling_of(&earlier).ids = ids;
            }

            report.make(
                entry,
                Code::DuplicateLocale,
                None,
                format!(
                    "`{written}` is `{earlier}` written another way, so a host that looks a locale up as written reads only the messages under the one it is asked for."
                ),
            );
        }

        let spelling = all.spelling_of(written);
        let defined = match &spelling.ids {
            Some(ids) => ids.contains(id),
            None => first.is_some(),
        };

        if defined {
            report.make(
                entry,
                Code::DuplicateId,
                None,
                format!(
                    "`{id}` is defined again in `{written}`, so one of the two messages is never read."
                ),
            );
        } else if let Some(earlier) = first.and_then(|first| entries.get(first))
            && earlier.message != *message
        {
            report.make(
                    entry,
                    Code::DuplicateId,
                    None,
                    format!(
                        "`{id}` is also defined in `{}`, the same locale written another way, so a host that reads the two as one never reads one of the two messages.",
                        earlier.locale
                    ),
                );
        }

        if let Some(ids) = &mut spelling.ids {
            ids.insert(id.clone());
        }

        if first.is_none() {
            let compared = match comparing {
                Comparing::None => false,
                Comparing::All => true,
                Comparing::Ids(takes) => takes(id),
            };

            if let Some(locale) = all.locales.get_mut(index) {
                locale.messages.insert(
                    id,
                    Read {
                        entry,
                        parameters: compared.then(|| parameters_of(&tree, modifiers)),
                    },
                );
            }
        }
    }

    // A spelling `options.locales` gives a locale whose messages are written
    // otherwise, reported on the locale's first message.
    let mut given: HashSet<&str> = HashSet::new();

    for written in options.locales {
        if !given.insert(written) {
            continue;
        }

        let Some(spelling) = all.spelled.get(written) else {
            continue;
        };
        let Some(locale) = all.locales.get(spelling.locale) else {
            continue;
        };

        if let (Some(opening), Some(earlier), None) =
            (locale.messages.first(), &locale.written, &spelling.ids)
            && earlier != written
        {
            report.make(
                    opening.entry,
                    Code::DuplicateLocale,
                    None,
                    format!(
                        "`{written}`, under which no message was read, is `{earlier}` written another way, so a host that looks a locale up as written reads only the messages under the one it is asked for."
                    ),
                );
        }
    }

    if matches!(comparing, Comparing::None) {
        return report.sorted();
    }

    let reference = match options.source {
        None => all.keyed("en").or(all.locales.first()),
        Some(named) => all.keyed(named),
    };

    let Some(reference) = reference else {
        for locale in &all.locales {
            let compared = locale
                .messages
                .first()
                .filter(|opening| opening.parameters.is_some());

            if let Some(opening) = compared {
                report.make(
                    opening.entry,
                    Code::MissingSource,
                    None,
                    format!(
                        "The source locale `{}` is no locale of the catalogue, so nothing `{}` holds is compared with it.",
                        options.source.unwrap_or_default(),
                        locale.name
                    ),
                );
            }
        }

        return report.sorted();
    };

    for other in &all.locales {
        if std::ptr::eq(other, reference) {
            continue;
        }

        for (id, read) in reference.messages.iter() {
            if read.parameters.is_some() && other.messages.get(id).is_none() {
                report.make(
                    read.entry,
                    Code::MissingMessage,
                    None,
                    format!("`{}` has no message `{id}`.", other.name),
                );
            }
        }

        for (id, read) in other.messages.iter() {
            let Some(parameters) = &read.parameters else {
                continue;
            };

            let Some(compared) = reference.messages.get(id) else {
                report.make(
                    read.entry,
                    Code::OrphanMessage,
                    None,
                    format!(
                        "`{}` has no message `{id}`, so nothing this message renders is compared with it.",
                        reference.name
                    ),
                );
                continue;
            };

            if let Some(source_parameters) = &compared.parameters {
                let source = report.locale(compared.entry).to_owned();

                compare(
                    &source,
                    source_parameters,
                    read.entry,
                    parameters,
                    &mut report,
                );
            }
        }
    }

    report.sorted()
}

// The format's own selection a placeholder makes, as the rules of a message
// read it: a formatting modifier selects nothing.
fn selection_of<'p>(placeholder: &'p Placeholder, modifiers: Modifiers<'_>) -> Option<&'p str> {
    modifiers
        .own(placeholder)
        .filter(|name| !FORMATTING.contains(name))
}

// How the placeholders of a parameter show its value, each way once: with
// the formatting modifier or the host's modifier one names, or as it is. A
// selection shows nothing of it.
fn showing<'p>(placeholders: &[&'p Placeholder], modifiers: Modifiers<'_>) -> Vec<&'p str> {
    let mut shown: Vec<&str> = Vec::new();
    let mut seen: HashSet<&str> = HashSet::new();

    for placeholder in placeholders {
        if selection_of(placeholder, modifiers).is_some() {
            continue;
        }

        let how = placeholder
            .modifier
            .as_ref()
            .map_or("", |modifier| modifier.name.as_str());

        if seen.insert(how) {
            shown.push(how);
        }
    }

    shown
}

fn selecting<'p>(
    placeholders: &'p [&'p Placeholder],
    selections: &'p [&str],
    modifiers: Modifiers<'p>,
) -> impl Iterator<Item = &'p Placeholder> {
    placeholders.iter().copied().filter(move |placeholder| {
        selection_of(placeholder, modifiers).is_some_and(|name| selections.contains(&name))
    })
}

// The numbers the options of selections give text of their own. A number key
// of `plural` selects for the number it reads as (section 11.5), and a key
// of `eq` only for the number whose text it spells (section 11.1).
fn numbers_of<'p>(
    placeholders: impl Iterator<Item = &'p Placeholder>,
    spelled: bool,
) -> impl Iterator<Item = f64> {
    placeholders
        .flat_map(Placeholder::choices)
        .filter_map(move |choice| {
            let number = modifier_input(&choice.name)?;

            (!spelled || string_conversion(number) == choice.name.to_lowercase()).then_some(number)
        })
}

const PLURALS: &[&str] = &["plural", "ordinal"];

fn by_name(parameters: &[Parameter]) -> HashMap<&str, &Parameter> {
    parameters
        .iter()
        .map(|parameter| (&*parameter.name, parameter))
        .collect()
}

fn compare(
    source: &str,
    reference: &[Parameter],
    entry: usize,
    parameters: &[Parameter],
    report: &mut Report<'_>,
) {
    let (referenced, read) = (by_name(reference), by_name(parameters));

    for compared in reference {
        if !read.contains_key(&*compared.name) {
            report.make(
                entry,
                Code::ParameterMismatch,
                Some("9.2"),
                format!(
                    "This message never reads `{}`, which the `{source}` message reads.",
                    compared.name
                ),
            );
        }
    }

    for parameter in parameters {
        let name = &parameter.name;
        let Some(compared) = referenced.get(&**name) else {
            report.make_at(
                entry,
                Code::ParameterMismatch,
                Some("9.2"),
                format!(
                    "`{name}` is read here and never in the `{source}` message, so a payload written for that message does not carry it."
                ),
                parameter.first,
            );
            continue;
        };

        let (shown, reshown) = (&parameter.shown, &compared.shown);
        let differs = shown.iter().any(|how| !reshown.contains(how))
            || reshown.iter().any(|how| !shown.contains(how));

        // A message that only selects by a parameter shows it no other way.
        if !shown.is_empty() && !reshown.is_empty() && differs {
            let spell = |hows: &[Box<str>]| {
                hows.iter()
                    .map(|how| {
                        if how.is_empty() {
                            "as it is".to_owned()
                        } else {
                            format!("with `{how}`")
                        }
                    })
                    .collect::<Vec<_>>()
                    .join(" and ")
            };

            report.make_at(
                entry,
                Code::ModifierMismatch,
                Some("11"),
                format!(
                    "`{name}` is shown {} here and {} in the `{source}` message.",
                    spell(shown),
                    spell(reshown)
                ),
                parameter.first,
            );
        }

        let Some(at) = parameter.plural else {
            continue;
        };

        // Text of its own for a number, given by the plural selection or by
        // one that compares the value with the number's key.
        let mut keyed: HashSet<u64> = parameter.keyed.iter().copied().collect();

        for &number in &compared.numbers {
            // Each number the source keys is reported once.
            if !keyed.insert(bits(number)) {
                continue;
            }

            let number = string_conversion(number);

            report.make_at(
                entry,
                Code::MissingNumberKey,
                Some("11.5"),
                format!(
                    "The `{source}` message gives `{number}` text of its own, and this selection has no `{number}` option, so it takes its category's."
                ),
                at,
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use std::cell::Cell;

    use super::{EntriesOptions, Entry, lint_entries};
    use crate::plural::NoPlurals;
    use crate::tree::READ;

    thread_local! {
        /// How many ids were copied out of a locale's messages.
        pub(super) static COPIED: Cell<usize> = const { Cell::new(0) };
    }

    fn copied(entries: &[Entry]) -> usize {
        COPIED.with(|copied| copied.set(0));
        lint_entries(entries, &EntriesOptions::default(), &NoPlurals);
        COPIED.with(Cell::get)
    }

    fn alternating(pairs: usize) -> Vec<Entry> {
        (0..pairs)
            .flat_map(|pair| {
                ["en", "EN"].into_iter().map(move |locale| Entry {
                    locale: locale.to_owned(),
                    id: format!("{locale}.{pair}"),
                    message: String::new(),
                })
            })
            .collect()
    }

    #[test]
    fn each_message_is_read_once() {
        let entries: Vec<Entry> = (0..20)
            .flat_map(|pair| {
                ["cs", "en", "de"].into_iter().map(move |locale| Entry {
                    locale: locale.to_owned(),
                    id: pair.to_string(),
                    message: "{{n:plural; 1:a; other:b;}} {{name}}".to_owned(),
                })
            })
            .collect();

        READ.with(|read| read.set(0));
        lint_entries(&entries, &EntriesOptions::default(), &NoPlurals);

        assert_eq!(READ.with(Cell::get), entries.len());
    }

    #[test]
    fn a_locale_written_two_ways_has_its_ids_copied_once() {
        assert_eq!(copied(&alternating(2)), 1);
        assert_eq!(copied(&alternating(2_000)), 1);
    }

    #[test]
    fn a_locale_written_many_ways_has_its_ids_copied_once() {
        let spellings = ["en-us", "EN-us", "en-US", "en_us", "EN_US", "En-Us"];
        let entries: Vec<Entry> = (0..600)
            .map(|index| Entry {
                locale: spellings
                    .get(index % spellings.len())
                    .map_or_else(String::new, |tag| (*tag).to_owned()),
                id: index.to_string(),
                message: String::new(),
            })
            .collect();

        assert_eq!(copied(&entries), 1);
    }

    #[test]
    fn a_locale_written_one_way_has_no_id_copied() {
        let entries: Vec<Entry> = alternating(50)
            .into_iter()
            .filter(|entry| entry.locale == "en")
            .collect();

        assert_eq!(copied(&entries), 0);
    }
}
