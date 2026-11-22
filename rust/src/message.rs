use std::collections::{HashMap, HashSet};

use curly_message_parser::{MAX_NESTING, modifier_input, numeric_conversion, string_conversion};

use crate::finding::Finding;
use crate::plural::{Asked, Category, Plurals, RuleType, bits};
use crate::rules::Code;
use crate::tree::{Named, Placeholder, Tree, read};

/// The modifiers section 11 defines, which a host may replace by name.
const BUILT_IN: [&str; 12] = [
    "eq", "ne", "lt", "gt", "lte", "gte", "number", "date", "ago", "currency", "plural", "ordinal",
];

/// Those the Intl level defines, which a host that satisfies Core alone
/// lacks (section 2).
const INTL: [&str; 6] = ["number", "date", "ago", "currency", "plural", "ordinal"];

const SELECTIONS: [&str; 8] = ["eq", "ne", "lt", "gt", "lte", "gte", "plural", "ordinal"];

pub(crate) const FORMATTING: [&str; 4] = ["number", "date", "ago", "currency"];

/// What a host gives the rules of a message: [`Options::default`], with what
/// differs from it set.
#[derive(Clone, Copy, Debug)]
#[non_exhaustive]
pub struct Options<'a> {
    /// The names of the modifiers a host registers (section 11.3). A name
    /// the format defines is then the host's, and is read as the host's
    /// modifier.
    pub modifiers: &'a [String],
    /// Whether the host satisfies the Intl level (section 2). A host that
    /// satisfies Core alone lacks the six modifiers Intl defines, and reads
    /// each as an unknown modifier unless it registers one of that name.
    pub intl: bool,
    /// The locale the message is written for, which the plural rules read.
    pub locale: Option<&'a str>,
}

impl Default for Options<'_> {
    fn default() -> Self {
        Self {
            modifiers: &[],
            intl: true,
            locale: None,
        }
    }
}

impl<'a> Options<'a> {
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

    /// The options with the locale the message is written for.
    #[must_use]
    pub const fn locale(mut self, locale: &'a str) -> Self {
        self.locale = Some(locale);
        self
    }
}

/// How the rules read a placeholder's modifier: whether the host has the
/// Intl level's, and the modifiers it registers.
#[derive(Clone, Copy)]
pub(crate) struct Modifiers<'a> {
    pub intl: bool,
    pub hosted: &'a [String],
}

impl Modifiers<'_> {
    fn defined(&self, name: &str) -> bool {
        BUILT_IN.contains(&name) && (self.intl || !INTL.contains(&name))
    }

    fn hosted(&self, name: &str) -> bool {
        self.hosted.iter().any(|hosted| hosted == name)
    }

    /// The modifier that answers to a placeholder, where it is the format's
    /// own: no modifier and no options is a plain substitution, and options
    /// alone are `eq`'s (section 9.5).
    pub fn own<'p>(&self, placeholder: &'p Placeholder) -> Option<&'p str> {
        let name = match &placeholder.modifier {
            Some(modifier) => modifier.name.as_str(),
            None if placeholder.choices().next().is_some() => "eq",
            None => return None,
        };

        (self.defined(name) && !self.hosted(name)).then_some(name)
    }
}

/// The placeholders written no deeper than resolution goes (section 13).
pub(crate) fn resolvable(tree: &Tree) -> impl Iterator<Item = &Placeholder> {
    tree.placeholders
        .iter()
        .filter(|placeholder| placeholder.depth <= MAX_NESTING)
}

fn list(items: &[String]) -> String {
    match items.split_last() {
        Some((last, rest)) if !rest.is_empty() => format!("{} and {last}", rest.join(", ")),
        _ => items.concat(),
    }
}

// What an option key selects for under a modifier: two keys alike select
// alike, so the later one is never reached (sections 11.1 and 11.5). A key
// that compares with nothing has none.
fn identity(modifier: &str, key: &str) -> Option<String> {
    match modifier {
        "lt" | "gt" => {
            let number = numeric_conversion(key);

            (!number.is_nan()).then(|| string_conversion(number))
        }
        "plural" | "ordinal" => match Category::of(key) {
            Some(category) => Some(category.as_str().to_owned()),
            None => modifier_input(key).map(string_conversion),
        },
        _ => Some(key.to_lowercase()),
    }
}

// The first match of a search at or after an offset, for offsets that only
// grow: the search crosses the text once, however often it is asked.
struct Ahead<F> {
    find: F,
    found: Option<usize>,
}

impl<F: Fn(&str) -> Option<usize>> Ahead<F> {
    fn new(find: F) -> Self {
        Self { find, found: None }
    }

    fn at(&mut self, text: &str, from: usize) -> usize {
        match self.found {
            Some(found) if found >= from => found,
            _ => {
                let found = text
                    .get(from..)
                    .and_then(&self.find)
                    .map_or(usize::MAX, |index| index.saturating_add(from));

                self.found = Some(found);

                found
            }
        }
    }
}

fn spelled(message: &str, start: usize, end: usize) -> &str {
    message.get(start..end).unwrap_or_default()
}

/// Lints one message: everything its text decides, and, given its locale,
/// what the locale's plural rules decide as well.
pub fn lint_message(message: &str, options: &Options<'_>, plurals: &dyn Plurals) -> Vec<Finding> {
    lint_tree(message, &read(message), options, &mut Asked::new(plurals))
}

/// Lints a message `read` has read.
pub(crate) fn lint_tree(
    message: &str,
    tree: &Tree,
    options: &Options<'_>,
    asked: &mut Asked<'_>,
) -> Vec<Finding> {
    let modifiers = Modifiers {
        intl: options.intl,
        hosted: options.modifiers,
    };
    let mut findings: Vec<Finding> = Vec::new();
    let mut add = |code: Code, section: &'static str, text: String, at: (usize, usize)| {
        findings.push(Finding::new(code, Some(section), text, at));
    };

    let mut line_end = Ahead::new(|text: &str| text.find(['\n', '\r', '\u{2028}', '\u{2029}']));
    let mut close = Ahead::new(|text: &str| text.find("}}"));

    for text in &tree.texts {
        for (index, _) in spelled(message, text.start, text.end).match_indices("{{") {
            let at = text.start.saturating_add(index);
            let after = at.saturating_add(2);
            let why = if close.at(message, after) < line_end.at(message, after) {
                "what it encloses is not a placeholder"
            } else {
                "nothing closes it on its line"
            };

            add(
                Code::UnclosedPlaceholder,
                "6",
                format!("`{{{{` opens no placeholder: {why}, so it renders as text."),
                (at, after),
            );
        }
    }

    for escape in tree.escapes.iter().filter(|escape| !escape.cancels) {
        let written = spelled(message, escape.span.start, escape.span.end);
        let escaped = written.strip_prefix('\\').unwrap_or(written);

        add(
            Code::InertEscape,
            "7",
            format!(
                "`{written}` cancels nothing, so the backslash and `{escaped}` both render. Write `\\{written}` to keep both on purpose."
            ),
            (escape.span.start, escape.span.end),
        );
    }

    for placeholder in &tree.placeholders {
        if placeholder.depth.checked_sub(1) != Some(MAX_NESTING) {
            continue;
        }

        add(
            Code::NestingLimit,
            "13",
            format!(
                "This placeholder is written {} deep, past the {MAX_NESTING} levels resolution goes, so it takes its fallback chain.",
                placeholder.depth
            ),
            (placeholder.start, placeholder.end),
        );
    }

    // The keys the format's own `plural` selects on, for `bare-count`.
    let mut counted: HashSet<&str> = HashSet::new();

    // Resolution never reaches what is written deeper, so nothing there is
    // read.
    for placeholder in resolvable(tree) {
        if let Some(modifier) = &placeholder.modifier {
            let name = modifier.name.as_str();

            if !modifiers.defined(name) && !modifiers.hosted(name) {
                let what = if INTL.contains(&name) {
                    "is a modifier of the Intl level, which the host does not satisfy, and the host does not register it"
                } else {
                    "is no modifier the format defines or the host registers"
                };

                add(
                    Code::UnknownModifier,
                    "11.4",
                    format!("`{name}` {what}, so the placeholder takes its fallback chain."),
                    (modifier.start, modifier.end),
                );
                continue;
            }
        }

        let mut defaults = placeholder
            .segments
            .iter()
            .filter(|segment| segment.name == "default");
        let inline = defaults.next().is_some();

        for extra in defaults {
            add(
                Code::DuplicateOption,
                "9.3",
                "Only the first `default` is the inline default, so this one is never read."
                    .to_owned(),
                (extra.start, extra.end),
            );
        }

        // Beside an inline default, such an option is how `eq` selects for
        // the value `default`.
        for choice in placeholder.choices().filter(|_| !inline) {
            if choice.name.to_lowercase() == "default" {
                add(
                    Code::DefaultCase,
                    "9.3",
                    format!(
                        "`{}` is an option, not the inline default: only `default` in lower case is, and this placeholder has none.",
                        choice.name
                    ),
                    (choice.start, choice.end),
                );
            }
        }

        let Some(reading) = modifiers.own(placeholder) else {
            continue;
        };

        if placeholder.key.is_some()
            && placeholder.choices().next().is_none()
            && SELECTIONS.contains(&reading)
        {
            add(
                Code::MissingOptions,
                "9.5",
                format!(
                    "`{reading}` selects among options and this placeholder declares none, so it takes its fallback chain."
                ),
                placeholder.at(),
            );
        }

        if FORMATTING.contains(&reading) {
            for choice in placeholder.choices() {
                add(
                    Code::UnreachableOption,
                    "9.5",
                    format!("`{reading}` selects nothing, so this option is never read."),
                    (choice.start, choice.end),
                );
            }

            continue;
        }

        let plural = reading == "plural" || reading == "ordinal";
        let section = if plural { "11.5" } else { "11.1" };
        let mut first: HashMap<String, &Named> = HashMap::new();
        // The first two keys that select, for `ne`.
        let mut opening: Vec<&Named> = Vec::new();

        for choice in placeholder.choices() {
            let Some(id) = identity(reading, &choice.name) else {
                continue;
            };

            if let Some(earlier) = first.get(&id) {
                add(
                    Code::DuplicateOption,
                    section,
                    format!(
                        "`{}` selects where `{}` before it does, so this option is never selected.",
                        choice.name, earlier.name
                    ),
                    (choice.start, choice.end),
                );
            } else if let (true, [a, b]) = (reading == "ne", opening.as_slice()) {
                // A value differs from one of two keys, so `ne` selects one
                // of the first two options that differ, whatever the value.
                add(
                    Code::UnreachableOption,
                    "11.1",
                    format!(
                        "Every value differs from `{}` or `{}`, and `ne` selects the first option whose key differs, so this option is never selected.",
                        a.name, b.name
                    ),
                    (choice.start, choice.end),
                );
            } else {
                first.insert(id, choice);
                opening.push(choice);
            }
        }

        if reading == "lt" || reading == "gt" {
            let (bound, word) = if reading == "lt" {
                (f64::NEG_INFINITY, "less")
            } else {
                (f64::INFINITY, "greater")
            };

            for choice in placeholder.choices() {
                let number = numeric_conversion(&choice.name);

                if number.is_nan() {
                    add(
                        Code::UnreachableOption,
                        "11.1",
                        format!(
                            "`{}` is not a number, and `{reading}` compares numerically, so this option is never selected.",
                            choice.name
                        ),
                        (choice.start, choice.end),
                    );
                } else if number == bound {
                    add(
                        Code::UnreachableOption,
                        "11.1",
                        format!(
                            "No value is {word} than `{}`, so this option is never selected.",
                            choice.name
                        ),
                        (choice.start, choice.end),
                    );
                }
            }
        }

        if plural {
            if let (Some(key), "plural") = (&placeholder.key, reading) {
                counted.insert(&key.name);
            }

            selection(placeholder, reading, options.locale, asked, &mut add);
        }
    }

    for placeholder in resolvable(tree) {
        let Some(key) = &placeholder.key else {
            continue;
        };

        if placeholder.modifier.is_some()
            || placeholder.choices().next().is_some()
            || !counted.contains(key.name.as_str())
        {
            continue;
        }

        add(
            Code::BareCount,
            "11.5",
            format!(
                "`{}` shows the value as it is written, while `plural` selects by the number `number` would show, and the two part over `1.0` or `1.999`. Write the count with `:number`.",
                spelled(message, placeholder.start, placeholder.end)
            ),
            (placeholder.start, placeholder.end),
        );
    }

    findings.sort_by(Finding::by_place);

    findings
}

fn selection(
    placeholder: &Placeholder,
    modifier: &str,
    locale: Option<&str>,
    asked: &mut Asked<'_>,
    add: &mut impl FnMut(Code, &'static str, String, (usize, usize)),
) {
    let kind = if modifier == "ordinal" {
        RuleType::Ordinal
    } else {
        RuleType::Cardinal
    };
    // A number key selects for the value it equals alone, so the numbers it
    // takes out of a category are no example of what the category leaves.
    let mut keyed: HashSet<u64> = HashSet::new();
    let mut named: HashSet<Category> = HashSet::new();

    for choice in placeholder.choices() {
        if let Some(category) = Category::of(&choice.name) {
            named.insert(category);
            continue;
        }

        match modifier_input(&choice.name) {
            None => {
                let lower = choice.name.to_lowercase();
                let meant = if Category::of(&lower).is_some() {
                    format!(" The category is `{lower}`, compared exactly as written.")
                } else {
                    String::new()
                };

                add(
                    Code::UnknownCategory,
                    "11.5",
                    format!(
                        "`{}` is neither a plural category nor a number, so this option is never selected.{meant}",
                        choice.name
                    ),
                    (choice.start, choice.end),
                );
            }
            Some(number) => {
                keyed.insert(bits(number));

                if kind == RuleType::Ordinal && number.fract() != 0.0 {
                    add(
                        Code::UnreachableOption,
                        "11.5",
                        format!(
                            "`ordinal` takes integers, so `{}` is never selected.",
                            choice.name
                        ),
                        (choice.start, choice.end),
                    );
                }
            }
        }
    }

    let Some(locale) = locale.filter(|locale| !locale.is_empty()) else {
        return;
    };
    let Some(categories) = asked.categories(locale, kind) else {
        return;
    };

    for choice in placeholder.choices() {
        let Some(category) = Category::of(&choice.name) else {
            continue;
        };

        if categories.contains_key(&category) {
            continue;
        }

        let zero = if category == Category::Zero {
            " Write `0:` to select for zero in every locale."
        } else {
            ""
        };

        add(
            Code::UnusedCategory,
            "11.5",
            format!(
                "`{locale}` has no `{}` among its {} categories, so this option is never selected.{zero}",
                choice.name,
                kind.as_str()
            ),
            (choice.start, choice.end),
        );
    }

    for category in Category::ALL {
        let Some(numbers) = categories.get(&category) else {
            continue;
        };
        let left: Vec<String> = numbers
            .iter()
            .filter(|number| !keyed.contains(&bits(**number)))
            .take(3)
            .map(|number| string_conversion(*number))
            .collect();

        if left.is_empty() || named.contains(&category) {
            continue;
        }

        let examples = list(&left);
        let category = category.as_str();
        let mut counts = numbers
            .iter()
            .filter(|number| **number >= 0.0 && number.fract() == 0.0)
            .peekable();

        // Where every count has a key, what is left is what a count is
        // seldom: negative, or a fraction.
        if counts.peek().is_some() && counts.all(|number| keyed.contains(&bits(*number))) {
            add(
                Code::KeyedCategory,
                "11.5",
                format!(
                    "Every count `{locale}` puts in `{category}` has a number key, but {examples} fall there too, and this selection has no `{category}` option, so those take the fallback chain."
                ),
                placeholder.at(),
            );
        } else {
            add(
                Code::MissingCategory,
                "11.5",
                format!(
                    "`{locale}` puts {examples} in `{category}`, and this selection has no `{category}` option, so those take the fallback chain."
                ),
                placeholder.at(),
            );
        }
    }
}
