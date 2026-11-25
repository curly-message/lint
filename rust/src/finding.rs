use std::cmp::Ordering;

use crate::rules::{Code, Severity};

/// One problem in a message, located by bytes of its text.
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub struct Finding {
    pub code: Code,
    pub severity: Severity,
    /// What is wrong and what happens instead, in English.
    pub message: String,
    /// The section of the specification the rule rests on, where one does.
    pub section: Option<&'static str>,
    /// Where the finding starts and ends. A span of 0 to 0 is about the
    /// whole message.
    pub start: usize,
    pub end: usize,
}

impl Finding {
    pub(crate) fn new(
        code: Code,
        section: Option<&'static str>,
        mut message: String,
        (start, end): (usize, usize),
    ) -> Self {
        // A message is written with `format!`, which leaves room it never
        // fills, and a catalogue's findings are held until they are reported.
        message.shrink_to_fit();

        Self {
            code,
            severity: code.rule().severity,
            message,
            section,
            start,
            end,
        }
    }

    /// The order of findings: by where each starts, then where it ends, then
    /// its rule's place in `RULES`, then its text, by UTF-16 code units, the
    /// order every implementation of the linter answers in.
    pub(crate) fn by_place(&self, other: &Self) -> Ordering {
        self.start
            .cmp(&other.start)
            .then(self.end.cmp(&other.end))
            .then(self.code.cmp(&other.code))
            .then_with(|| by_units(&self.message, &other.message))
    }
}

/// The order of two texts by UTF-16 code units, which differs from the order
/// of their bytes past the Basic Multilingual Plane.
pub(crate) fn by_units(a: &str, b: &str) -> Ordering {
    a.encode_utf16().cmp(b.encode_utf16())
}

/// A finding in a catalogue, and the message it is in: `entry`, the index of
/// that message in the list the catalogue was read as.
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub struct CatalogueFinding {
    pub finding: Finding,
    pub entry: usize,
}
