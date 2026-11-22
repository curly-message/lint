/// What a finding is about. Each code is one rule, and every rule is
/// decidable from the text of a message, or of a catalogue, without a
/// payload.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
#[non_exhaustive]
pub enum Code {
    UnclosedPlaceholder,
    UnknownModifier,
    MissingOptions,
    NestingLimit,
    DefaultCase,
    DuplicateOption,
    UnreachableOption,
    UnknownCategory,
    InertEscape,
    BareCount,
    UnusedCategory,
    MissingCategory,
    KeyedCategory,
    UnreadableCatalogue,
    DuplicateId,
    DuplicateLocale,
    MissingSource,
    MissingMessage,
    OrphanMessage,
    ParameterMismatch,
    ModifierMismatch,
    MissingNumberKey,
}

impl Code {
    /// The code as a report spells it.
    pub fn as_str(self) -> &'static str {
        self.rule().name
    }

    /// The rule the code names, which says how severe a finding of it is.
    pub fn rule(self) -> &'static Rule {
        // `RULES` lists the codes in the order the enum declares them, which
        // a test holds it to.
        RULES.get(self as usize).unwrap_or(&UNLISTED)
    }
}

/// An error is text that renders other than its author meant, or a message
/// the format reports at resolution. A warning is text that renders as
/// written but is unreachable or easy to misread.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Severity {
    Error,
    Warning,
}

impl Severity {
    /// The severity as a report spells it.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Error => "error",
            Self::Warning => "warning",
        }
    }
}

/// Where a rule can be decided: a message alone, with its locale, or a
/// catalogue.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum Scope {
    Message,
    Locale,
    Catalogue,
}

/// One rule of the linter.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub struct Rule {
    pub code: Code,
    /// The code as a report spells it.
    pub name: &'static str,
    pub severity: Severity,
    pub scope: Scope,
    /// The section of the specification the rule rests on, where one does.
    pub section: Option<&'static str>,
    pub description: &'static str,
}

const fn rule(
    code: Code,
    name: &'static str,
    severity: Severity,
    scope: Scope,
    section: Option<&'static str>,
    description: &'static str,
) -> Rule {
    Rule {
        code,
        name,
        severity,
        scope,
        section,
        description,
    }
}

const UNLISTED: Rule = rule(
    Code::UnreadableCatalogue,
    "unreadable-catalogue",
    Severity::Error,
    Scope::Catalogue,
    None,
    "",
);

use Code as C;
use Scope::{Catalogue, Locale, Message};
use Severity::{Error, Warning};

/// Every rule, in the order the README lists them, which orders the findings
/// of one span.
#[rustfmt::skip]
pub const RULES: &[Rule] = &[
    rule(C::UnclosedPlaceholder, "unclosed-placeholder", Error, Message, Some("6"), "A `{{` that opens no placeholder, and renders as text."),
    rule(C::UnknownModifier, "unknown-modifier", Error, Message, Some("11.4"), "A modifier neither the format defines nor the host registers."),
    rule(C::MissingOptions, "missing-options", Error, Message, Some("9.5"), "A selection that declares no options."),
    rule(C::NestingLimit, "nesting-limit", Error, Message, Some("13"), "A placeholder written deeper than resolution goes."),
    rule(C::DefaultCase, "default-case", Error, Message, Some("9.3"), "An option keyed `default` in another case, which is no inline default."),
    rule(C::DuplicateOption, "duplicate-option", Warning, Message, Some("11.1"), "An option an earlier one selects in place of, or a second `default`."),
    rule(C::UnreachableOption, "unreachable-option", Warning, Message, Some("11.1"), "An option its modifier never selects."),
    rule(C::UnknownCategory, "unknown-category", Error, Message, Some("11.5"), "A key of a plural selection that is neither a category nor a number."),
    rule(C::InertEscape, "inert-escape", Warning, Message, Some("7"), "An escape sequence that cancels nothing."),
    rule(C::BareCount, "bare-count", Warning, Message, Some("11.5"), "A count shown as written beside a `plural` that selects by the number shown."),
    rule(C::UnusedCategory, "unused-category", Warning, Locale, Some("11.5"), "A plural category the locale never answers."),
    rule(C::MissingCategory, "missing-category", Error, Locale, Some("11.5"), "A plural category the locale answers and the selection has no option for."),
    rule(C::KeyedCategory, "keyed-category", Warning, Locale, Some("11.5"), "A plural category with no option, every count of which has a number key, so only negative numbers and fractions in it take the fallback chain."),
    rule(C::UnreadableCatalogue, "unreadable-catalogue", Error, Catalogue, None, "A catalogue read only up to where it is not JSON, is not well-formed Unicode text or nests past 512 levels."),
    rule(C::DuplicateId, "duplicate-id", Error, Catalogue, None, "An id defined twice in one locale."),
    rule(C::DuplicateLocale, "duplicate-locale", Warning, Catalogue, None, "A locale written two ways, its tags differing only in case or `_` for `-`."),
    rule(C::MissingSource, "missing-source", Error, Catalogue, None, "A source locale that is no locale of the catalogue, so no other locale is compared with it."),
    rule(C::MissingMessage, "missing-message", Warning, Catalogue, None, "A message the source locale has and another locale lacks."),
    rule(C::OrphanMessage, "orphan-message", Warning, Catalogue, None, "A message the source locale lacks."),
    rule(C::ParameterMismatch, "parameter-mismatch", Error, Catalogue, Some("9.2"), "A message that reads other parameters than the source locale's."),
    rule(C::ModifierMismatch, "modifier-mismatch", Warning, Catalogue, Some("11"), "A parameter shown with another modifier than in the source locale."),
    rule(C::MissingNumberKey, "missing-number-key", Warning, Catalogue, Some("11.5"), "A number key the source locale's selection has and another's lacks."),
];
