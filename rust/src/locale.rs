use crate::tag::well_formed;

/// What a pattern reads off a path: the locale and the namespace.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub(crate) struct Placed {
    pub locale: Option<String>,
    pub namespace: Vec<String>,
}

/// How far a walk down a path has read it: the name of the pattern it reads
/// next, the names the namespace spans so far where it goes on past them,
/// and what the names before placed.
#[derive(Clone, Debug, Default)]
pub(crate) struct Reading {
    at: usize,
    span: Vec<String>,
    pub placed: Placed,
}

const LOCALE: &str = "{locale}";
const NAMESPACE: &str = "{namespace}";

/// A locale tag as a path or an option writes it, with `-` for `_`, where it
/// is one whose language has two or three letters. One of five to eight is
/// well-formed, but none is registered, and the words a project names its
/// files with — `common`, `package` — are such.
pub(crate) fn tag_of(text: &str) -> Option<String> {
    let tag = text.replace('_', "-");
    let language = well_formed(&tag)?.language.len();

    (2..=3).contains(&language).then_some(tag)
}

/// A name no placeholder reads, and no directory given as it is: a hidden
/// one, or a package's dependencies.
pub(crate) fn hidden(name: &str) -> bool {
    name.starts_with('.') || name == "node_modules"
}

// A name of a pattern: its text before, between and after the placeholders
// it holds.
#[derive(Clone, Debug, Default)]
struct Name {
    before: String,
    first: Option<&'static str>,
    between: String,
    second: Option<&'static str>,
    after: String,
}

fn name_of(text: &str) -> Name {
    let mut found: Vec<(usize, &'static str)> = [LOCALE, NAMESPACE]
        .into_iter()
        .filter_map(|placeholder| Some((text.find(placeholder)?, placeholder)))
        .collect();

    found.sort_unstable();

    let part = |from: usize, to: usize| text.get(from..to).unwrap_or_default().to_owned();
    let past = |(at, placeholder): (usize, &str)| at.saturating_add(placeholder.len());

    match found.as_slice() {
        [] => Name {
            before: text.to_owned(),
            ..Name::default()
        },
        [one] => Name {
            before: part(0, one.0),
            first: Some(one.1),
            after: part(past(*one), text.len()),
            ..Name::default()
        },
        [one, two, ..] => Name {
            before: part(0, one.0),
            first: Some(one.1),
            between: part(past(*one), two.0),
            second: Some(two.1),
            after: part(past(*two), text.len()),
        },
    }
}

// What a name of a pattern reads off the text a path holds there. Where the
// namespace goes on past the text, `open`, the text holds none of what the
// name writes after the namespace.
fn placed_of(name: &Name, text: &str, open: bool) -> Option<Placed> {
    let Some(first) = name.first else {
        return (text == name.before).then(Placed::default);
    };
    let after = if open { "" } else { name.after.as_str() };
    let second = if open && first == NAMESPACE {
        None
    } else {
        name.second
    };
    let inner = text
        .strip_prefix(name.before.as_str())?
        .strip_suffix(after)?;
    // No tag holds the text between two placeholders, so the locale ends
    // where that text stands nearest it.
    let at = match second {
        None => inner.len(),
        Some(_) if first == LOCALE => inner.find(name.between.as_str())?,
        Some(_) => inner.rfind(name.between.as_str())?,
    };
    let (one, rest) = inner.split_at_checked(at)?;
    let two = second.and_then(|_| rest.get(name.between.len()..));
    let value = |placeholder: &str| {
        if first == placeholder {
            Some(one)
        } else if second == Some(placeholder) {
            two
        } else {
            None
        }
    };
    let locale = match value(LOCALE) {
        Some(written) => Some(tag_of(written)?),
        None => None,
    };
    let namespace: Vec<String> = value(NAMESPACE)
        .map(|written| written.split('/').map(str::to_owned).collect())
        .unwrap_or_default();

    (!namespace.iter().any(String::is_empty)).then_some(Placed { locale, namespace })
}

// Whether a name of a pattern reads the text a path holds there. A hidden
// name or node_modules is read only where the pattern writes it: as a name
// of its own, or by the text before a placeholder, `.{locale}.json`. A name
// the namespace goes on to past its first is the placeholder's alone.
fn readable(name: &Name, text: &str, first: bool) -> bool {
    name.first.is_none() || !hidden(text) || (first && name.before.starts_with('.'))
}

// What a path places, with what one more name of it places: the locale,
// which one name holds, and the namespace, which goes on name after name.
fn merge(placed: &Placed, found: Placed) -> Placed {
    Placed {
        locale: found.locale.or_else(|| placed.locale.clone()),
        namespace: placed
            .namespace
            .iter()
            .cloned()
            .chain(found.namespace)
            .collect(),
    }
}

fn joined(span: &[String], name: &str) -> String {
    span.iter()
        .map(String::as_str)
        .chain([name])
        .collect::<Vec<_>>()
        .join("/")
}

/// A pattern such as `locales/{locale}/{namespace}.json`: `{locale}` stands
/// for a locale tag within one name, and `{namespace}` for one name or more,
/// the namespace the ids of a file sit under.
#[derive(Clone, Debug)]
pub(crate) struct Pattern {
    /// The directory before the first placeholder, written with `/`.
    pub base: String,
    /// Whether a path the pattern reads places the locale of its files.
    pub locates: bool,
    names: Vec<Name>,
    /// The name the namespace is written in, where the pattern holds one.
    spanning: Option<usize>,
}

/// Reads a pattern, or says what is wrong with it. `{locale}` and
/// `{namespace}` are each there once at most, and both share a name only
/// where a text no tag holds parts them.
pub(crate) fn read_pattern(pattern: &str) -> Result<Pattern, String> {
    let mut at = 0;

    while let Some(found) = pattern.get(at..).and_then(|rest| rest.find(['{', '}'])) {
        let brace = at.saturating_add(found);
        let rest = pattern.get(brace..).unwrap_or_default();
        let Some(placeholder) = [LOCALE, NAMESPACE]
            .into_iter()
            .find(|name| rest.starts_with(name))
        else {
            return Err("holds a brace that opens neither {locale} nor {namespace}.".to_owned());
        };

        at = brace.saturating_add(placeholder.len());

        if pattern
            .get(at..)
            .is_some_and(|rest| rest.contains(placeholder))
        {
            return Err(format!("holds {placeholder} twice."));
        }
    }

    let Some(first) = [LOCALE, NAMESPACE]
        .into_iter()
        .filter_map(|placeholder| pattern.find(placeholder))
        .min()
    else {
        return Err("holds neither {locale} nor {namespace}.".to_owned());
    };
    let split = pattern
        .get(..first)
        .and_then(|before| before.rfind(['/', '\\']))
        .map_or(0, |separator| separator.saturating_add(1));
    let (base, tail) = pattern.split_at_checked(split).unwrap_or(("", pattern));
    let texts: Vec<&str> = tail.split(['/', '\\']).collect();

    if texts.iter().any(|text| matches!(*text, "" | "." | "..")) {
        return Err("holds an empty name, `.` or `..` after its first placeholder.".to_owned());
    }

    if !texts.last().is_some_and(|text| text.ends_with(".json")) {
        return Err(
            "names no .json file: end it with .json, as in locales/{locale}/{namespace}.json."
                .to_owned(),
        );
    }

    let names: Vec<Name> = texts.into_iter().map(name_of).collect();
    let parted = |name: &Name| {
        name.second.is_none()
            || name
                .between
                .chars()
                .any(|char| !char.is_ascii_alphanumeric() && char != '_' && char != '-')
    };

    if !names.iter().all(parted) {
        return Err(
            "parts {locale} and {namespace} with nothing a locale cannot hold, such as `.`."
                .to_owned(),
        );
    }

    let spanning = names
        .iter()
        .position(|name| name.first == Some(NAMESPACE) || name.second == Some(NAMESPACE));
    let base = base.replace('\\', "/");

    Ok(Pattern {
        base: if base.is_empty() {
            ".".to_owned()
        } else {
            base
        },
        locates: pattern.contains(LOCALE),
        names,
        spanning,
    })
}

/// What a walk reads a path with, name by name: a pattern, or every `.json`
/// file below a path given as it is, placed nowhere.
#[derive(Clone, Copy)]
pub(crate) struct Reader<'a>(pub Option<&'a Pattern>);

impl Reader<'_> {
    /// The readings a directory gives, none where nothing below it is read.
    pub fn enter(&self, reading: &Reading, name: &str) -> Vec<Reading> {
        let Some(pattern) = self.0 else {
            return if hidden(name) {
                Vec::new()
            } else {
                vec![reading.clone()]
            };
        };
        let Reading { at, span, placed } = reading;
        let last = pattern.names.len().saturating_sub(1);
        let Some(named) = pattern.names.get(*at) else {
            return Vec::new();
        };

        if Some(*at) != pattern.spanning {
            let found = (*at < last && readable(named, name, true))
                .then(|| placed_of(named, name, false))
                .flatten();

            return found
                .map(|found| Reading {
                    at: at.saturating_add(1),
                    span: span.clone(),
                    placed: merge(placed, found),
                })
                .into_iter()
                .collect();
        }

        // The namespace goes on past the name, or ends at it. Its first name
        // is read as it opens, and a locale written there placed, so what a
        // directory below holds turns on no name but the last.
        if !readable(named, name, span.is_empty()) {
            return Vec::new();
        }

        let opened = if span.is_empty() {
            placed_of(named, name, true)
        } else {
            Some(placed.clone())
        };
        let ended = (*at < last)
            .then(|| placed_of(named, &joined(span, name), false))
            .flatten();
        let goes_on = opened.map(|opened| Reading {
            at: *at,
            span: span.iter().cloned().chain([name.to_owned()]).collect(),
            placed: merge(
                placed,
                Placed {
                    locale: opened.locale,
                    namespace: Vec::new(),
                },
            ),
        });
        let ends = ended.map(|ended| Reading {
            at: at.saturating_add(1),
            span: Vec::new(),
            placed: merge(placed, ended),
        });

        goes_on.into_iter().chain(ends).collect()
    }

    /// The locale and namespace a file is read under, where it is read.
    pub fn place(&self, reading: &Reading, name: &str) -> Option<Placed> {
        let Some(pattern) = self.0 else {
            return (name.ends_with(".json") && !hidden(name)).then(|| reading.placed.clone());
        };
        let Reading { at, span, placed } = reading;
        let named = pattern.names.get(*at)?;
        let last = pattern.names.len().saturating_sub(1);
        let first = Some(*at) != pattern.spanning || span.is_empty();

        if *at != last || !readable(named, name, first) {
            return None;
        }

        Some(merge(placed, placed_of(named, &joined(span, name), false)?))
    }

    /// One text for the readings that read the same files below a
    /// directory, in the same locale, though under namespaces that may
    /// differ.
    pub fn key(&self, reading: &Reading) -> String {
        match self.0 {
            None => String::new(),
            Some(_) => format!(
                "{}{} {}",
                reading.at,
                if reading.span.is_empty() { "" } else { "+" },
                reading.placed.locale.as_deref().unwrap_or_default()
            ),
        }
    }
}
