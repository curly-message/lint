//! The `curly-lint` command, over a host that reads the files: its
//! arguments, what it reports and the code it exits with.

use std::collections::{HashMap, HashSet};

use crate::catalogue::{Comparing, EntriesOptions, Entry, lint_entries_comparing};
use crate::finding::{Finding, by_units};
use crate::locale::{Pattern, Placed, Reader, Reading, read_pattern, tag_of};
use crate::message::{Options, lint_message};
use crate::plural::Plurals;
use crate::read::{Located, read_catalogue, read_findings};
use crate::rules::Severity;
use crate::tag::locale_key;

/// What `--help` prints, and wrong arguments after what is wrong with them.
pub const USAGE: &str = r#"Usage: curly-lint [options] <pattern, file or directory>...

Lints the Curly Message Format messages in JSON catalogues. A pattern names
them, and where their paths hold each file's locale and namespace: in
"locales/{locale}/{namespace}.json", locales/cs/admin/users.json holds cs
messages whose ids sit under admin.users. A file or a directory searched for
.json files names neither. Quote a pattern, as a shell may read its braces.

Options:
  --locale <tag>      The locale of every file whose path holds none.
  --source <tag>      The locale the others are compared with (default: en,
                      or the first locale found).
  --modifier <name>   A modifier the host registers. Repeat for each.
  --no-intl           The host satisfies Core alone, so number, date, ago,
                      currency, plural and ordinal are unknown modifiers
                      unless --modifier names them.
  --format <format>   text (default) or json.
  --quiet             Report errors only.
  --help              Print this and exit.

Exits 1 where an error is found, a file that is not JSON included, 2 where
the arguments are wrong, a path cannot be read, a pattern names no file or
the output cannot be written, and 0 otherwise. A reader that closes the
output early, as head does, ends the report but changes none of these.

What a file that cannot be read or is not JSON holds is unknown, so
nothing under its namespace is compared. What a directory that cannot be
read holds is unknown too, so where its files would be read in a locale,
no locale is compared with another."#;

/// What stands at a path.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub enum Kind {
    File,
    Directory,
    Link,
    /// Anything else a path names: a pipe, a device.
    Other,
}

/// Why a path cannot be read.
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub struct Fault {
    /// Whether the path is not there: missing, below a file, or a loop of
    /// links.
    pub missing: bool,
    /// What the host says of it.
    pub message: String,
}

impl Fault {
    /// A path that is there and cannot be read, and what the host says of
    /// it.
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            missing: false,
            message: message.into(),
        }
    }

    /// A path that is not there, and what the host says of it.
    pub fn missing(message: impl Into<String>) -> Self {
        Self {
            missing: true,
            message: message.into(),
        }
    }
}

/// A name a directory holds.
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub struct Named {
    pub name: String,
    /// What the name is, a link not followed.
    pub kind: Kind,
}

impl Named {
    /// A name, and what it is.
    pub fn new(name: impl Into<String>, kind: Kind) -> Self {
        Self {
            name: name.into(),
            kind,
        }
    }
}

/// What the command runs on: the files it reads, where it writes, and the
/// plural rules it reads a locale's categories from. A path is text, written
/// as the host writes one; the command joins names onto it with the host's
/// separator and otherwise asks the host.
pub trait Host {
    /// What parts the names of a path.
    fn separator(&self) -> char;

    /// A path as it stands from the root, read from the working directory
    /// where it is written from there, with no `.` or `..` left in it.
    fn resolve(&self, path: &str) -> String;

    /// A resolved path as it is written from the working directory.
    fn relative(&self, path: &str) -> String;

    /// What stands at a path, links followed.
    fn stat(&self, path: &str) -> Result<Kind, Fault>;

    /// What stands at a path, a link not followed.
    fn lstat(&self, path: &str) -> Result<Kind, Fault>;

    /// Where a path stands once every link in it is followed.
    fn realpath(&self, path: &str) -> Result<String, Fault>;

    /// The names a directory holds, in any order.
    fn read_dir(&self, path: &str) -> Result<Vec<Named>, Fault>;

    /// The text of a file, each byte that is no UTF-8 read as U+FFFD.
    fn read(&self, path: &str) -> Result<String, Fault>;

    /// The plural rules the host has.
    fn plurals(&self) -> &dyn Plurals;

    /// Writes to the report.
    fn out(&mut self, text: &str);

    /// Writes what is said beside the report.
    fn err(&mut self, text: &str);
}

/// One problem, where it stands in a file: lines and columns from 1, a
/// column counting UTF-16 code units, as an editor does.
#[derive(Clone, Debug, PartialEq, Eq)]
struct Problem {
    pub file: String,
    pub line: usize,
    pub column: usize,
    pub end_line: usize,
    pub end_column: usize,
    pub severity: Severity,
    pub code: &'static str,
    pub message: String,
    pub locale: Option<String>,
    pub id: Option<String>,
}

/// A text as JSON writes a string.
fn json(text: &str) -> String {
    let mut out = String::with_capacity(text.len().saturating_add(2));

    out.push('"');

    for char in text.chars() {
        match char {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{8}' => out.push_str("\\b"),
            '\u{c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            char if char < ' ' => out.push_str(&format!("\\u{:04x}", u32::from(char))),
            char => out.push(char),
        }
    }

    out.push('"');

    out
}

impl Problem {
    fn json(&self) -> String {
        let mut members = vec![
            format!("\"file\": {}", json(&self.file)),
            format!("\"line\": {}", self.line),
            format!("\"column\": {}", self.column),
            format!("\"endLine\": {}", self.end_line),
            format!("\"endColumn\": {}", self.end_column),
            format!("\"severity\": {}", json(self.severity.as_str())),
            format!("\"code\": {}", json(self.code)),
            format!("\"message\": {}", json(&self.message)),
        ];

        members.extend(
            self.locale
                .iter()
                .map(|locale| format!("\"locale\": {}", json(locale))),
        );
        members.extend(self.id.iter().map(|id| format!("\"id\": {}", json(id))));

        format!("  {{\n    {}\n  }}", members.join(",\n    "))
    }
}

struct Arguments {
    locale: Option<String>,
    source: Option<String>,
    modifiers: Vec<String>,
    intl: bool,
    format: String,
    quiet: bool,
    help: bool,
    positionals: Vec<String>,
}

fn parse(argv: &[String]) -> Result<Arguments, String> {
    let mut parsed = Arguments {
        locale: None,
        source: None,
        modifiers: Vec::new(),
        intl: true,
        format: "text".to_owned(),
        quiet: false,
        help: false,
        positionals: Vec::new(),
    };
    let unknown = |option: &str| {
        format!(
            "Unknown option '{option}'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- \"{option}\""
        )
    };
    let mut arguments = argv.iter();

    while let Some(argument) = arguments.next() {
        if argument == "--" {
            parsed.positionals.extend(arguments.by_ref().cloned());
            break;
        }

        let Some(long) = argument.strip_prefix("--") else {
            match argument
                .strip_prefix('-')
                .and_then(|short| short.chars().next())
            {
                Some(short) => return Err(unknown(&format!("-{short}"))),
                None => parsed.positionals.push(argument.clone()),
            }

            continue;
        };
        let (name, inline) = match long.split_once('=') {
            Some((name, value)) if !name.is_empty() => (name, Some(value)),
            _ => (long, None),
        };
        let option = format!("--{name}");

        match name {
            "no-intl" | "quiet" | "help" => {
                if inline.is_some() {
                    return Err(format!("Option '{option}' does not take an argument"));
                }

                match name {
                    "no-intl" => parsed.intl = false,
                    "quiet" => parsed.quiet = true,
                    _ => parsed.help = true,
                }
            }
            "locale" | "source" | "modifier" | "format" => {
                let value = match inline {
                    Some(value) => value.to_owned(),
                    None => match arguments.next() {
                        None => return Err(format!("Option '{option} <value>' argument missing")),
                        Some(next) if next.len() > 1 && next.starts_with('-') => {
                            return Err(format!(
                                "Option '{option}' argument is ambiguous.\nDid you forget to specify the option argument for '{option}'?\nTo specify an option argument starting with a dash use '{option}=-XYZ'."
                            ));
                        }
                        Some(next) => next.clone(),
                    },
                };

                match name {
                    "locale" => parsed.locale = Some(value),
                    "source" => parsed.source = Some(value),
                    "modifier" => parsed.modifiers.push(value),
                    _ => parsed.format = value,
                }
            }
            _ => return Err(unknown(if name.is_empty() { argument } else { &option })),
        }
    }

    Ok(parsed)
}

fn join(directory: &str, name: &str, separator: char) -> String {
    if directory.ends_with(separator) {
        format!("{directory}{name}")
    } else {
        format!("{directory}{separator}{name}")
    }
}

// Whether a directory is another or holds it, both where they stand.
fn holds(outer: &str, inner: &str, separator: char) -> bool {
    inner == outer
        || inner
            .strip_prefix(outer)
            .is_some_and(|rest| outer.ends_with(separator) || rest.starts_with(separator))
}

// A path as it orders among others: name by name.
fn order_of(path: &str, separator: char) -> String {
    path.replace(separator, "\0")
}

struct Found {
    path: String,
    real: String,
    placed: Placed,
    links: usize,
}

// A directory that cannot be read, where it stands, and why.
struct Unread {
    path: String,
    real: String,
    fault: Fault,
}

// A directory being read: the names it holds still to read, and the
// readings that read them.
struct Open {
    directory: String,
    at: String,
    fresh: Vec<Reading>,
    links: usize,
    names: std::vec::IntoIter<Named>,
}

struct Walk<'a, H: Host + ?Sized> {
    host: &'a H,
    reader: Reader<'a>,
    separator: char,
    seen: HashSet<String>,
    files: Vec<Found>,
    linked: Vec<(String, String, Vec<Reading>, usize)>,
    unread: Vec<Unread>,
}

impl<H: Host + ?Sized> Walk<'_, H> {
    // Opens a directory for the readings that have not read it yet where it
    // stands, and none where every one has, or it cannot be listed.
    fn open(
        &mut self,
        directory: String,
        at: String,
        readings: Vec<Reading>,
        links: usize,
    ) -> Option<Open> {
        let fresh: Vec<Reading> = readings
            .into_iter()
            .filter(|reading| {
                self.seen
                    .insert(format!("{}\0{at}", self.reader.key(reading)))
            })
            .collect();

        if fresh.is_empty() {
            return None;
        }

        match self.host.read_dir(&directory) {
            Ok(mut names) => {
                // By code units, which no host orders otherwise.
                names.sort_by(|a, b| by_units(&a.name, &b.name));

                Some(Open {
                    directory,
                    at,
                    fresh,
                    links,
                    names: names.into_iter(),
                })
            }
            Err(fault) => {
                self.unread.push(Unread {
                    path: directory,
                    real: at,
                    fault,
                });

                None
            }
        }
    }

    // Reads a directory and every directory below it that no link leads to,
    // with a stack of its own rather than the call stack, which a tree deep
    // enough outgrows.
    fn read(&mut self, directory: String, at: String, readings: Vec<Reading>, links: usize) {
        let mut pending: Vec<Open> = self
            .open(directory, at, readings, links)
            .into_iter()
            .collect();

        while let Some(open) = pending.last_mut() {
            let Some(Named { name, kind }) = open.names.next() else {
                pending.pop();
                continue;
            };
            let link = kind == Kind::Link;
            // What the readings take the name for, asked before a link is
            // followed to learn which it is, as most names are read as
            // neither.
            let next: Vec<Reading> = if kind == Kind::Directory || link {
                open.fresh
                    .iter()
                    .flat_map(|reading| self.reader.enter(reading, &name))
                    .collect()
            } else {
                Vec::new()
            };
            let placings: Vec<Placed> = if kind == Kind::File || link {
                open.fresh
                    .iter()
                    .filter_map(|reading| self.reader.place(reading, &name))
                    .collect()
            } else {
                Vec::new()
            };

            if next.is_empty() && placings.is_empty() {
                continue;
            }

            let child = join(&open.directory, &name, self.separator);
            let stands = join(&open.at, &name, self.separator);
            let links = open.links;
            // A link to a path that is not there is passed over, as no file
            // or directory stands at its path.
            let (directory, fault) = match link.then(|| self.host.stat(&child)) {
                None => (kind == Kind::Directory, None),
                Some(Ok(found)) => (found == Kind::Directory, None),
                Some(Err(fault)) if fault.missing => continue,
                Some(Err(fault)) => (false, Some(fault)),
            };

            if directory {
                if next.is_empty() {
                    continue;
                }

                if link {
                    self.linked
                        .push((child, open.at.clone(), next, links.saturating_add(1)));
                } else if let Some(below) = self.open(child, stands, next, links) {
                    pending.push(below);
                }
            } else if !placings.is_empty() {
                let real = if link {
                    self.host.realpath(&child).unwrap_or(stands)
                } else {
                    stands
                };

                for placed in placings {
                    self.files.push(Found {
                        path: child.clone(),
                        real: real.clone(),
                        placed,
                        links: if link { links.saturating_add(1) } else { links },
                    });
                }
            } else if let Some(fault) = fault {
                self.unread.push(Unread {
                    path: child,
                    real: stands,
                    fault,
                });
            }
        }
    }
}

// The files a path names, each with where it stands, what it is read as and
// the links followed to reach it: a file given as it is, or the .json files
// below a directory. A directory is read once for each reading the reader
// keys apart, at the path with the fewest links, so a link only adds to
// what the paths without one read. A link is not followed to a directory
// that holds it, nor to the directory searched or one holding it. A
// directory that cannot be read is listed, and the walk goes on past it. A
// path that is not there is a fault, and below a directory, a link to one
// is passed over.
fn catalogues<H: Host + ?Sized>(
    host: &H,
    path: &str,
    pattern: Option<&Pattern>,
) -> Result<(Vec<Found>, Vec<Unread>), Fault> {
    let separator = host.separator();
    let directory = match host.stat(path) {
        Ok(found) => found == Kind::Directory,
        Err(fault) => {
            // A link given as it is that cannot be followed is a file that
            // cannot be read, as below a directory where the readings read
            // it as a file.
            let linked = pattern.is_none() && host.lstat(path) == Ok(Kind::Link);

            if !linked && fault.missing {
                return Err(fault);
            }

            if !linked {
                return Ok((
                    Vec::new(),
                    vec![Unread {
                        path: path.to_owned(),
                        real: path.to_owned(),
                        fault,
                    }],
                ));
            }

            false
        }
    };

    if !directory {
        if pattern.is_some() {
            return Ok((Vec::new(), Vec::new()));
        }

        // A file given as it is need stand nowhere, as a pipe does not.
        let real = host.realpath(path).unwrap_or_else(|_| {
            let (holder, name) = path.rsplit_once(separator).unwrap_or(("", path));

            let mut root = [0; 4];

            host.realpath(if holder.is_empty() {
                separator.encode_utf8(&mut root)
            } else {
                holder
            })
            .map_or_else(|_| path.to_owned(), |at| join(&at, name, separator))
        });

        return Ok((
            vec![Found {
                path: path.to_owned(),
                real,
                placed: Placed::default(),
                links: 0,
            }],
            Vec::new(),
        ));
    }

    let real = host.realpath(path)?;
    let mut walk = Walk {
        host,
        reader: Reader(pattern),
        separator,
        seen: HashSet::new(),
        files: Vec::new(),
        linked: Vec::new(),
        unread: Vec::new(),
    };

    walk.read(path.to_owned(), real.clone(), vec![Reading::default()], 0);

    let mut index = 0;

    while let Some((child, holder, readings, links)) = walk.linked.get(index).cloned() {
        let target = host.realpath(&child)?;

        if !holds(&target, &holder, separator) && !holds(&target, &real, separator) {
            walk.read(child, target, readings, links);
        }

        index = index.saturating_add(1);
    }

    Ok((walk.files, walk.unread))
}

/// Line and column, both from 1, of an offset in a text, the column in
/// UTF-16 code units. A byte order mark is no column, as an editor shows the
/// line without it.
struct Position<'a> {
    text: &'a str,
    /// Where each line starts.
    starts: Vec<usize>,
    /// For a text not all ASCII, the code units before each stride of bytes,
    /// so that a column is counted from near it however long its line is.
    units: Vec<usize>,
}

const STRIDE: usize = 1024;

impl<'a> Position<'a> {
    fn new(text: &'a str) -> Self {
        let bytes = text.as_bytes();
        let mut starts = vec![if text.starts_with('\u{feff}') { 3 } else { 0 }];

        for (index, byte) in bytes.iter().enumerate() {
            let next = index.saturating_add(1);

            if *byte == b'\n' || (*byte == b'\r' && bytes.get(next) != Some(&b'\n')) {
                starts.push(next);
            }
        }

        let mut units = Vec::new();

        if !text.is_ascii() {
            let mut count = 0_usize;

            for (index, char) in text.char_indices() {
                // A stride that opens inside a character is counted from the
                // next one's start.
                while units.len().saturating_mul(STRIDE) <= index {
                    units.push(count);
                }

                count = count.saturating_add(char.len_utf16());
            }

            while units.len().saturating_mul(STRIDE) <= text.len() {
                units.push(count);
            }
        }

        Self {
            text,
            starts,
            units,
        }
    }

    // The code units before a byte offset.
    fn units_before(&self, offset: usize) -> usize {
        let stride = offset.checked_div(STRIDE).unwrap_or_default();
        let Some(counted) = self.units.get(stride) else {
            return offset;
        };
        let mut from = stride.saturating_mul(STRIDE);

        while !self.text.is_char_boundary(from) {
            from = from.saturating_add(1);
        }

        self.text.get(from..offset).map_or(*counted, |rest| {
            counted.saturating_add(rest.encode_utf16().count())
        })
    }

    fn at(&self, offset: usize) -> (usize, usize) {
        let line = self.starts.partition_point(|start| *start <= offset).max(1);
        let start = line
            .checked_sub(1)
            .and_then(|index| self.starts.get(index))
            .copied()
            .unwrap_or_default();
        // An offset before the line's start is the byte order mark's, and
        // is no column.
        let column = self
            .units_before(offset)
            .saturating_add(1)
            .saturating_sub(self.units_before(start));

        (line, column)
    }
}

// Whether an id sits under one of the namespaces: is one, or goes on past
// one at a dot. The empty namespace holds every id.
fn under(namespaces: &HashSet<String>, id: &str) -> bool {
    namespaces.contains("")
        || namespaces.contains(id)
        || id.match_indices('.').any(|(dot, _)| {
            id.get(..dot)
                .is_some_and(|prefix| namespaces.contains(prefix))
        })
}

// A file to read, with where it stands and what a pattern places in it,
// which a path given as it is does not; or a directory that cannot be read,
// with why.
struct Listed {
    path: String,
    real: String,
    placed: Option<Placed>,
    unread: Option<Fault>,
}

// A message's file and string, to point a finding in the message at.
struct Source {
    file: usize,
    located: Located,
}

struct File {
    shown: String,
    text: String,
}

/// Runs the command over its arguments and answers with its exit code.
pub fn run<H: Host + ?Sized>(argv: &[String], host: &mut H) -> i32 {
    let arguments = match parse(argv) {
        Ok(arguments) => arguments,
        Err(message) => {
            host.err(&format!("{message}\n\n{USAGE}\n"));

            return 2;
        }
    };

    if arguments.help {
        host.out(&format!("{USAGE}\n"));

        return 0;
    }

    if arguments.format != "text" && arguments.format != "json" {
        host.err(&format!(
            "Unknown format {}: expected text or json.\n",
            json(&arguments.format)
        ));

        return 2;
    }

    if arguments.positionals.is_empty() {
        host.err(&format!("{USAGE}\n"));

        return 2;
    }

    let mut tags = [None, None];

    for ((option, value), tag) in [
        ("--locale", &arguments.locale),
        ("--source", &arguments.source),
    ]
    .into_iter()
    .zip(&mut tags)
    {
        let Some(value) = value else {
            continue;
        };

        *tag = tag_of(value);

        if tag.is_none() {
            host.err(&format!(
                "{option} {} is no locale: expected a tag such as cs or en-US.\n",
                json(value)
            ));

            return 2;
        }
    }

    let [given, source] = tags;
    let mut patterns: HashMap<&str, Pattern> = HashMap::new();

    for argument in &arguments.positionals {
        if !argument.contains(['{', '}']) {
            continue;
        }

        match read_pattern(argument) {
            Ok(pattern) => {
                patterns.insert(argument, pattern);
            }
            Err(message) => {
                host.err(&format!("The pattern {argument} {message}\n"));

                return 2;
            }
        }
    }

    let separator = host.separator();
    let options = Options {
        modifiers: &arguments.modifiers,
        intl: arguments.intl,
        locale: None,
    };
    let mut problems: Vec<(usize, Problem)> = Vec::new();
    let mut entries: Vec<Entry> = Vec::new();
    let mut sources: Vec<Source> = Vec::new();
    // Each file read, in the order the files are read in, by the path it is
    // shown at.
    let mut read: Vec<File> = Vec::new();
    let mut ranks: HashMap<String, usize> = HashMap::new();
    // Every locale a file is written for, one with no message included.
    let mut locales: Vec<String> = Vec::new();
    // The namespaces of the files that cannot be read or are not JSON. What
    // such a file holds is unknown, so no message under one is compared, in
    // any locale.
    let mut unknown: HashSet<String> = HashSet::new();
    // Whether any locale is compared with another: not where a directory
    // that cannot be read would hold files of a locale, as what any locale
    // holds is then unknown.
    let mut comparable = true;
    let mut unreadable = false;
    // The files to read, in the order of the arguments and of the paths each
    // reaches, and in that order, each directory that cannot be read.
    let mut files: Vec<Listed> = Vec::new();
    // Each file a pattern reads by where it stands and the locale it is read
    // in, and each a path given as it is reads by where it stands.
    let mut placed_at: HashSet<String> = HashSet::new();
    let mut plain_at: HashSet<String> = HashSet::new();
    // Where the files a pattern reads stand.
    let mut patterned: HashSet<String> = HashSet::new();
    let mut unplaced = 0_usize;
    // Where the files and directories that cannot be read stand.
    let mut unread_at: HashSet<String> = HashSet::new();
    // Written with forward slashes on every platform, as a path in a report
    // is read across them.
    let shown_at = |host: &H, path: &str| {
        let relative = host.relative(path);

        if relative.is_empty() {
            ".".to_owned()
        } else {
            relative.replace(separator, "/")
        }
    };

    for argument in &arguments.positionals {
        let pattern = patterns.get(argument.as_str());
        let path = host.resolve(pattern.map_or(argument, |pattern| &pattern.base));
        let (found, unread) = match catalogues(host, &path, pattern) {
            Ok(read) => read,
            Err(fault) => {
                host.err(&format!("Cannot read {argument}: {}\n", fault.message));
                unreadable = true;
                continue;
            }
        };

        if pattern.is_some() && found.is_empty() && unread.is_empty() {
            host.err(&format!("No .json file matches the pattern {argument}.\n"));
            unreadable = true;
        }

        if !unread.is_empty() && (given.is_some() || pattern.is_some_and(|pattern| pattern.locates))
        {
            comparable = false;
        }

        // A pattern reads a file once for each locale, and a directory given
        // as it is reads one once: by the first argument that reaches it, at
        // the path through the fewest links, and of those the first in the
        // order of paths.
        let mut ranked: Vec<(String, Found)> = found
            .into_iter()
            .map(|file| (order_of(&file.path, separator), file))
            .collect();

        ranked.sort_by(|(a_order, a), (b_order, b)| {
            a.links
                .cmp(&b.links)
                .then_with(|| by_units(a_order, b_order))
        });

        let mut listed: Vec<(String, Listed)> = Vec::new();

        for (order, file) in ranked {
            let fresh = if pattern.is_some() {
                let locale = file
                    .placed
                    .locale
                    .as_deref()
                    .or(given.as_deref())
                    .unwrap_or_default();

                patterned.insert(file.real.clone());
                placed_at.insert(format!("{}\0{}", file.real, locale_key(locale)))
            } else {
                plain_at.insert(file.real.clone())
            };

            if fresh {
                listed.push((
                    order,
                    Listed {
                        path: file.path,
                        real: file.real,
                        placed: pattern.map(|_| file.placed),
                        unread: None,
                    },
                ));
            }
        }

        listed.extend(unread.into_iter().map(|Unread { path, real, fault }| {
            (
                order_of(&path, separator),
                Listed {
                    path,
                    real,
                    placed: None,
                    unread: Some(fault),
                },
            )
        }));
        listed.sort_by(|(a, _), (b, _)| by_units(a, b));
        files.extend(listed.into_iter().map(|(_, file)| file));
    }

    for Listed {
        path,
        real,
        placed,
        unread,
    } in files
    {
        if let Some(fault) = unread {
            if unread_at.insert(real) {
                let shown = shown_at(host, &path);

                host.err(&format!("Cannot read {shown}: {}\n", fault.message));
            }

            unreadable = true;
            continue;
        }

        // A file a pattern reads is read as the pattern places it, whichever
        // path given as it is reaches it too.
        if placed.is_none() && patterned.contains(&real) {
            continue;
        }

        let shown = shown_at(host, &path);
        let placed = placed.unwrap_or_default();
        let locale = placed.locale.or_else(|| given.clone());
        let namespace = placed.namespace;
        let rank = *ranks.entry(shown.clone()).or_insert(read.len());
        let text = match host.read(&path) {
            Ok(text) => text,
            Err(fault) => {
                if unread_at.insert(real) {
                    host.err(&format!("Cannot read {shown}: {}\n", fault.message));
                }

                unreadable = true;

                if let Some(locale) = locale {
                    if !locales.contains(&locale) {
                        locales.push(locale);
                    }

                    unknown.insert(namespace.join("."));
                }

                // The file keeps its place among those read.
                if rank == read.len() {
                    read.push(File {
                        shown,
                        text: String::new(),
                    });
                }

                continue;
            }
        };
        let position = Position::new(&text);
        let catalogue = read_catalogue(&text);

        match &locale {
            Some(locale) if !locales.contains(locale) => locales.push(locale.clone()),
            Some(_) => {}
            None => unplaced = unplaced.saturating_add(1),
        }

        for found in read_findings(&catalogue) {
            problems.push((
                rank,
                problem(
                    &shown,
                    &position,
                    found.start,
                    found.end,
                    &found,
                    None,
                    None,
                ),
            ));
        }

        let file = read.len();

        match catalogue {
            Err(_) => {
                if locale.is_some() {
                    unknown.insert(namespace.join("."));
                }
            }
            Ok(catalogue) => {
                for located in catalogue.strings {
                    let id = namespace
                        .iter()
                        .chain(&located.path)
                        .map(String::as_str)
                        .collect::<Vec<_>>()
                        .join(".");

                    if let Some(locale) = &locale {
                        entries.push(Entry {
                            locale: locale.clone(),
                            id,
                            message: located.value.clone(),
                        });
                        sources.push(Source { file, located });
                        continue;
                    }

                    for found in lint_message(&located.value, &options, host.plurals()) {
                        let (start, end) = span(&located, &found);

                        problems.push((
                            rank,
                            problem(
                                &shown,
                                &position,
                                start,
                                end,
                                &found,
                                None,
                                Some(id.clone()),
                            ),
                        ));
                    }
                }
            }
        }

        read.push(File { shown, text });
    }

    if unplaced > 0 {
        let (count, their) = if unplaced == 1 {
            ("1 file has".to_owned(), "its")
        } else {
            (format!("{unplaced} files have"), "their")
        };

        host.err(&format!(
            "{count} no locale, so {their} messages are linted without one, and compared with no other locale's. Name it in a pattern, as in curly-lint \"locales/{{locale}}/{{namespace}}.json\".\n"
        ));
    }

    if !comparable {
        host.err("What a directory that cannot be read holds is unknown, so no locale is compared with another.\n");
    }

    if let Some(source) = source.as_deref().filter(|_| comparable) {
        let key = locale_key(source);

        if !locales.iter().any(|locale| locale_key(locale) == key) {
            host.err(&format!(
                "No file given is written for the source locale `{source}`.\n"
            ));

            return 2;
        }
    }

    // Each message is linted with its locale, and each locale on its own; a
    // message is compared only where what both locales hold is known.
    let known = |id: &str| !under(&unknown, id);
    let comparing = if comparable {
        Comparing::Ids(&known)
    } else {
        Comparing::None
    };
    let entries_options = EntriesOptions {
        modifiers: &arguments.modifiers,
        intl: arguments.intl,
        source: source.as_deref(),
        locales: &locales,
    };
    // The lines of each file are found once, for all the findings in it.
    let mut positions: HashMap<usize, Position<'_>> = HashMap::new();

    for found in lint_entries_comparing(&entries, &entries_options, comparing, host.plurals()) {
        let (Some(source), Some(entry)) = (sources.get(found.entry), entries.get(found.entry))
        else {
            continue;
        };
        let Some(file) = read.get(source.file) else {
            continue;
        };
        let position = positions
            .entry(source.file)
            .or_insert_with(|| Position::new(&file.text));
        let (start, end) = span(&source.located, &found.finding);
        let rank = ranks.get(&file.shown).copied().unwrap_or_default();

        problems.push((
            rank,
            problem(
                &file.shown,
                position,
                start,
                end,
                &found.finding,
                Some(entry.locale.clone()),
                Some(entry.id.clone()),
            ),
        ));
    }

    problems.sort_by(|(a_rank, a), (b_rank, b)| {
        a_rank
            .cmp(b_rank)
            .then(a.line.cmp(&b.line))
            .then(a.column.cmp(&b.column))
    });

    let failed = problems
        .iter()
        .any(|(_, problem)| problem.severity == Severity::Error);
    let shown: Vec<&Problem> = problems
        .iter()
        .map(|(_, problem)| problem)
        .filter(|problem| !arguments.quiet || problem.severity == Severity::Error)
        .collect();

    if arguments.format == "json" {
        if shown.is_empty() {
            host.out("[]\n");
        } else {
            let listed: Vec<String> = shown.iter().map(|problem| problem.json()).collect();

            host.out(&format!("[\n{}\n]\n", listed.join(",\n")));
        }
    } else {
        for Problem {
            file,
            line,
            column,
            severity,
            message,
            code,
            ..
        } in shown.iter().copied()
        {
            host.out(&format!(
                "{file}:{line}:{column}  {}  {message}  {code}\n",
                severity.as_str()
            ));
        }

        let errors = shown
            .iter()
            .filter(|problem| problem.severity == Severity::Error)
            .count();
        let warnings = shown.len().saturating_sub(errors);
        let plural = |count: usize, one: &'static str, more: &'static str| {
            if count == 1 { one } else { more }
        };

        if !shown.is_empty() {
            host.out(&format!(
                "\n{} {} ({errors} {}, {warnings} {})\n",
                shown.len(),
                plural(shown.len(), "problem", "problems"),
                plural(errors, "error", "errors"),
                plural(warnings, "warning", "warnings")
            ));
        }
    }

    if unreadable {
        return 2;
    }

    i32::from(failed)
}

// Where a finding in a message stands in the file that holds it. A finding
// about a whole message points at the string that holds it.
fn span(located: &Located, found: &Finding) -> (usize, usize) {
    if found.start == 0 && found.end == 0 {
        (located.start, located.end)
    } else {
        (located.offset_of(found.start), located.offset_of(found.end))
    }
}

fn problem(
    file: &str,
    position: &Position<'_>,
    start: usize,
    end: usize,
    found: &Finding,
    locale: Option<String>,
    id: Option<String>,
) -> Problem {
    let (line, column) = position.at(start);
    let (end_line, end_column) = position.at(end);

    Problem {
        file: file.to_owned(),
        line,
        column,
        end_line,
        end_column,
        severity: found.severity,
        code: found.code.as_str(),
        message: found.message.clone(),
        locale,
        id,
    }
}
