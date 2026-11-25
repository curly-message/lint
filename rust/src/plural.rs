use std::collections::{BTreeMap, HashMap};
use std::sync::{Arc, Mutex, PoisonError};

use crate::tag::{locale_key, well_formed};

/// A plural category of the Unicode CLDR, which section 11.5 keys by.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum Category {
    Zero,
    One,
    Two,
    Few,
    Many,
    Other,
}

impl Category {
    /// Every category, in the order a report lists them.
    pub const ALL: [Self; 6] = [
        Self::Zero,
        Self::One,
        Self::Two,
        Self::Few,
        Self::Many,
        Self::Other,
    ];

    /// The category as a message keys an option by it.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Zero => "zero",
            Self::One => "one",
            Self::Two => "two",
            Self::Few => "few",
            Self::Many => "many",
            Self::Other => "other",
        }
    }

    /// The category a key names, compared exactly as written.
    pub fn of(key: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|category| category.as_str() == key)
    }
}

/// Which rules a selection reads: `plural`'s or `ordinal`'s.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum RuleType {
    Cardinal,
    Ordinal,
}

impl RuleType {
    /// The type as a report spells it.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Cardinal => "cardinal",
            Self::Ordinal => "ordinal",
        }
    }
}

/// A locale's plural rules of one type.
pub trait Rules {
    /// The categories the rules answer.
    fn categories(&self) -> Vec<Category>;

    /// The category a number takes. A cardinal rule is asked as `plural`
    /// reads a number: shown with at most two fraction digits.
    fn select(&self, number: f64) -> Category;
}

/// The plural rules a host has.
pub trait Plurals {
    /// The rules for a locale, asked by its key ([`locale_key`]), and none
    /// where the host has no rules for it. A tag is asked only where it is a
    /// well-formed Unicode locale identifier, as ECMA-402's `Intl` takes one;
    /// a host has no rules for any other.
    fn rules(&self, tag: &str, kind: RuleType) -> Option<Box<dyn Rules + '_>>;

    /// Where what the rules answered for a locale is kept from one call to
    /// the next, so that a locale's rules are asked about the [`probes`]
    /// once, not once a call; none by default. Give one only where the rules
    /// of a tag answer the same for as long as `self` lives.
    fn kept(&self) -> Option<&KeptCategories> {
        None
    }
}

/// What a host answered for a locale and a type: the categories its rules
/// answer, or none where it has no rules for the locale.
type Answer = Option<Arc<Categories>>;

/// How many locales and types a [`KeptCategories`] holds, past which it
/// starts over.
const KEPT: usize = 64;

/// What a host's rules answered for each locale and type, kept across calls
/// by a [`Plurals`] that gives it from [`Plurals::kept`]: for at most 64
/// locales and types, each with the numbers among [`probes`] each category
/// takes, past which it lets go of them all and starts over.
#[derive(Debug, Default)]
pub struct KeptCategories {
    known: Mutex<BTreeMap<(bool, String), Answer>>,
}

impl KeptCategories {
    /// Holds nothing yet.
    pub const fn new() -> Self {
        Self {
            known: Mutex::new(BTreeMap::new()),
        }
    }

    // No lock is held while the host is asked, which may lint from inside
    // its rules.
    fn get(&self, kind: RuleType, tag: &str) -> Option<Answer> {
        let known = self.known.lock().unwrap_or_else(PoisonError::into_inner);

        known
            .get(&(kind == RuleType::Ordinal, tag.to_owned()))
            .cloned()
    }

    fn insert(&self, kind: RuleType, tag: &str, answer: Answer) {
        let mut known = self.known.lock().unwrap_or_else(PoisonError::into_inner);

        if known.len() >= KEPT {
            known.clear();
        }

        known.insert((kind == RuleType::Ordinal, tag.to_owned()), answer);
    }
}

/// A host with no plural rules, which the rules that read a locale's then
/// find nothing by.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoPlurals;

impl Plurals for NoPlurals {
    fn rules(&self, _: &str, _: RuleType) -> Option<Box<dyn Rules + '_>> {
        None
    }
}

/// Plural rules stated as data: for a locale and a type, the categories the
/// rules answer and the numbers each takes among those the linter asks
/// about ([`probes`]). A number listed under no category takes `other`.
///
/// It is how a host whose rules live outside the linter hands them in, and
/// how the fixture set states the rules a case is read with.
#[derive(Clone, Debug, Default)]
pub struct Table {
    rules: HashMap<(String, RuleType), TableRules>,
}

#[derive(Clone, Debug, Default)]
struct TableRules {
    categories: Vec<Category>,
    taken: HashMap<u64, Category>,
}

// One key for a number and its negation of zero, which select alike.
pub(crate) fn bits(number: f64) -> u64 {
    if number == 0.0 { 0 } else { number.to_bits() }
}

impl Table {
    /// A table with no rules.
    pub fn new() -> Self {
        Self::default()
    }

    /// States the rules of one type for a locale, kept under the tag's key
    /// ([`locale_key`]), so however the tag is written, they answer for it.
    pub fn insert(
        &mut self,
        tag: &str,
        kind: RuleType,
        categories: &[Category],
        select: &[(Category, &[f64])],
    ) {
        let taken = select
            .iter()
            .flat_map(|(category, numbers)| numbers.iter().map(|number| (bits(*number), *category)))
            .collect();

        self.rules.insert(
            (locale_key(tag), kind),
            TableRules {
                categories: categories.to_vec(),
                taken,
            },
        );
    }
}

impl Rules for &TableRules {
    fn categories(&self) -> Vec<Category> {
        self.categories.clone()
    }

    fn select(&self, number: f64) -> Category {
        self.taken
            .get(&bits(number))
            .copied()
            .unwrap_or(Category::Other)
    }
}

impl Plurals for Table {
    fn rules(&self, tag: &str, kind: RuleType) -> Option<Box<dyn Rules + '_>> {
        let rules = self.rules.get(&(tag.to_owned(), kind))?;

        Some(Box::new(rules))
    }
}

/// The numbers a category is shown with, found by asking the host, in the
/// order a finding draws its examples from: 0; the integers 1 to 200; 1000,
/// 10000, 100000 and 1000000; numbers shown with a fraction, 0.5 to 20.5,
/// which only some categories take; the negation of each of those; then
/// numbers `plural` shows as an integer, 0.001 to 20.001, which a number key
/// equal to that integer does not select, and their negations.
pub fn probes() -> Vec<f64> {
    let shown: Vec<f64> = (1..=200_u32)
        .map(f64::from)
        .chain([1000.0, 10000.0, 100_000.0, 1_000_000.0])
        .chain((0..=20_u32).map(|index| f64::from(index) + 0.5))
        .collect();
    let rounded: Vec<f64> = (0..=20_u32).map(|index| f64::from(index) + 0.001).collect();

    std::iter::once(0.0)
        .chain(shown.iter().copied())
        .chain(shown.iter().map(|number| -number))
        .chain(rounded.iter().copied())
        .chain(rounded.iter().map(|number| -number))
        .collect()
}

/// The categories a locale's rules answer, each with the probes it takes.
pub(crate) type Categories = HashMap<Category, Vec<f64>>;

/// What a host answered for each locale and type asked so far, so that a
/// catalogue asks about each once.
pub(crate) struct Asked<'a> {
    plurals: &'a dyn Plurals,
    probes: Option<Vec<f64>>,
    known: HashMap<(RuleType, String), Answer>,
}

impl<'a> Asked<'a> {
    pub fn new(plurals: &'a dyn Plurals) -> Self {
        Self {
            plurals,
            probes: None,
            known: HashMap::new(),
        }
    }

    /// The categories a locale's rules answer, or nothing where the host has
    /// no rules for the locale. A locale may be written with `_`, as a path
    /// or a POSIX locale writes it, for `-`.
    pub fn categories(&mut self, locale: &str, kind: RuleType) -> Option<&Categories> {
        let Self {
            plurals,
            probes,
            known,
        } = self;
        let tag = locale_key(locale);

        known
            .entry((kind, tag))
            .or_insert_with_key(|(kind, tag)| {
                well_formed(tag)?;

                let kept = plurals.kept();

                if let Some(answer) = kept.and_then(|kept| kept.get(*kind, tag)) {
                    return answer;
                }

                let answer = asked(
                    *plurals,
                    tag,
                    *kind,
                    probes.get_or_insert_with(self::probes),
                );

                if let Some(kept) = kept {
                    kept.insert(*kind, tag, answer.clone());
                }

                answer
            })
            .as_deref()
    }
}

// The categories the host's rules for a locale answer, each with the probes
// it takes.
fn asked(
    plurals: &dyn Plurals,
    tag: &str,
    kind: RuleType,
    probes: &[f64],
) -> Option<Arc<Categories>> {
    let rules = plurals.rules(tag, kind)?;
    let mut answer: Categories = rules
        .categories()
        .into_iter()
        .map(|category| (category, Vec::new()))
        .collect();

    for probe in probes.iter().copied() {
        if kind == RuleType::Ordinal && probe.fract() != 0.0 {
            continue;
        }

        if let Some(taken) = answer.get_mut(&rules.select(probe)) {
            taken.push(probe);
        }
    }

    Some(Arc::new(answer))
}
