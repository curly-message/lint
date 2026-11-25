//! A linter for the [Curly Message Format](https://github.com/curly-message/spec):
//! the rules of a message, of a message with its locale and of a catalogue,
//! a reader of JSON catalogue files that says where each string stands, and
//! the `curly-lint` command over them.
//!
//! Every offset counts bytes of the text it is an offset in, the unit a
//! `str` is indexed by.

mod catalogue;
#[cfg(feature = "cldr")]
mod cldr;
pub mod command;
mod finding;
mod locale;
mod message;
mod plural;
mod read;
mod rules;
mod tag;
mod tree;

pub use catalogue::{EntriesOptions, Entry, lint_entries, lint_entries_uncompared};
#[cfg(feature = "cldr")]
pub use cldr::Cldr;
pub use finding::{CatalogueFinding, Finding};
pub use message::{Options, lint_message};
pub use plural::{Category, KeptCategories, NoPlurals, Plurals, RuleType, Rules, Table, probes};
pub use read::{Catalogue, Escape, Located, Replaced, Unreadable, read_catalogue, read_findings};
pub use rules::{Code, RULES, Rule, Scope, Severity};
pub use tag::locale_key;

// The README's example reads the plural rules the crate carries.
#[cfg(all(doctest, feature = "cldr"))]
#[doc = include_str!("../README.md")]
pub struct ReadmeDoctests;
