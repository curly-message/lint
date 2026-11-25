//! The plural rules of the Unicode CLDR, read from the data files the crate
//! carries: `cldr/plurals.json`, `cldr/ordinals.json` and, for the languages
//! a tag may name by another code, `cldr/aliases.json`.

use std::collections::HashMap;
use std::sync::OnceLock;

use crate::plural::{Category, KeptCategories, Plurals, RuleType, Rules};
use crate::read::read_catalogue;
use crate::tag::well_formed;

const PLURALS: &str = include_str!("../cldr/plurals.json");
const ORDINALS: &str = include_str!("../cldr/ordinals.json");
const ALIASES: &str = include_str!("../cldr/aliases.json");

/// What a rule reads of a number (UTS #35, part 3, section 5.1.1).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Operand {
    /// The number itself.
    N,
    /// Its integer digits.
    I,
    /// How many fraction digits it shows.
    V,
    /// The fraction digits it shows.
    F,
    /// A compact exponent, which no number is shown with here.
    E,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct Relation {
    operand: Operand,
    modulus: Option<u64>,
    within: bool,
    ranges: Vec<(u64, u64)>,
}

/// A rule: relations joined by `and`, those joined by `or`.
type Condition = Vec<Vec<Relation>>;

/// A number as it is shown.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct Shown {
    /// The integer digits, where a `u64` holds them.
    integer: Option<u64>,
    /// The integer digits, modulo `LOW`.
    low: u64,
    /// How many fraction digits are shown, and those digits.
    visible: u64,
    fraction: u64,
    /// The fraction digits without trailing zeros.
    significant: u64,
}

// What a modulus of a rule divides, so that the last digits of an integer
// answer for all of it.
const LOW: u64 = 1_000_000_000_000;

fn digits(text: &str) -> Option<u64> {
    if text.is_empty() {
        Some(0)
    } else {
        text.parse().ok()
    }
}

impl Shown {
    // A number written in decimal digits: `12`, `1.50`.
    fn of(text: &str) -> Option<Self> {
        let (integer, fraction) = text.split_once('.').unwrap_or((text, ""));
        let tail = integer.len().saturating_sub(12);

        Some(Self {
            integer: integer.parse().ok(),
            low: digits(integer.get(tail..)?)?,
            visible: u64::try_from(fraction.len()).ok()?,
            fraction: digits(fraction)?,
            significant: digits(fraction.trim_end_matches('0'))?,
        })
    }

    // A number as a host shows it with at most `places` fraction digits:
    // rounded half away from zero, with no trailing zero.
    fn rounded(number: f64, places: usize) -> Option<Self> {
        let whole = number.abs();

        // An integer a double holds exactly is shown as it is.
        if whole.fract() == 0.0 && whole < 9_007_199_254_740_992.0 {
            // No more than 2^53, so the cast keeps every digit.
            let integer = whole as u64;

            return Some(Self {
                integer: Some(integer),
                low: integer.checked_rem(LOW)?,
                visible: 0,
                fraction: 0,
                significant: 0,
            });
        }

        // The shortest digits that read back as the number, which is what a
        // host rounds: 1.005 is shown as 1.01, though the double is below it.
        let written = number.abs().to_string();
        let (integer, fraction) = written.split_once('.').unwrap_or((&written, ""));
        let (kept, rest) = fraction.split_at_checked(places).unwrap_or((fraction, ""));
        let mut shown: Vec<u8> = integer.bytes().chain(kept.bytes()).collect();

        if rest.bytes().next().is_some_and(|digit| digit >= b'5') {
            let mut carried = true;

            for digit in shown.iter_mut().rev() {
                if *digit == b'9' {
                    *digit = b'0';
                } else {
                    *digit = digit.saturating_add(1);
                    carried = false;
                    break;
                }
            }

            if carried {
                shown.insert(0, b'1');
            }
        }

        let (integer, fraction) = shown.split_at_checked(shown.len().checked_sub(kept.len())?)?;
        let fraction = std::str::from_utf8(fraction).ok()?.trim_end_matches('0');
        let integer = std::str::from_utf8(integer).ok()?;

        Self::of(&if fraction.is_empty() {
            integer.to_owned()
        } else {
            format!("{integer}.{fraction}")
        })
    }

    fn satisfies(&self, relation: &Relation) -> bool {
        let value = match relation.operand {
            Operand::N if self.significant != 0 => None,
            Operand::N | Operand::I => match relation.modulus {
                Some(modulus) if LOW.checked_rem(modulus) == Some(0) => {
                    self.low.checked_rem(modulus)
                }
                Some(modulus) => self
                    .integer
                    .and_then(|integer| integer.checked_rem(modulus)),
                None => self.integer,
            },
            Operand::V => Some(self.visible),
            Operand::F => Some(self.fraction),
            Operand::E => Some(0),
        };
        let value = match (value, relation.modulus, relation.operand) {
            (Some(value), Some(modulus), Operand::V | Operand::F | Operand::E) => {
                value.checked_rem(modulus)
            }
            (value, ..) => value,
        };
        let listed = value.is_some_and(|value| {
            relation
                .ranges
                .iter()
                .any(|(from, to)| (*from..=*to).contains(&value))
        });

        listed == relation.within
    }

    fn meets(&self, condition: &Condition) -> bool {
        condition
            .iter()
            .any(|relations| relations.iter().all(|relation| self.satisfies(relation)))
    }
}

// A rule's condition, read from its text up to the samples after `@`. A
// rule written in what this reader does not know is none, and its locale
// then has no rules.
fn condition(rule: &str) -> Option<Condition> {
    let text = rule.split('@').next().unwrap_or_default();
    let mut condition = Condition::new();

    for alternative in text.split(" or ") {
        let mut relations = Vec::new();

        for written in alternative.split(" and ") {
            let (within, (left, right)) = match written.split_once("!=") {
                Some(sides) => (false, sides),
                None => (true, written.split_once('=')?),
            };
            let (operand, modulus) = match left.split_once('%') {
                Some((operand, modulus)) => (operand, Some(modulus.trim().parse().ok()?)),
                None => (left, None),
            };
            let operand = match operand.trim() {
                "n" => Operand::N,
                "i" => Operand::I,
                "v" | "w" => Operand::V,
                "f" | "t" => Operand::F,
                "e" | "c" => Operand::E,
                _ => return None,
            };
            let ranges = right
                .split(',')
                .map(|range| {
                    let (from, to) = range.split_once("..").unwrap_or((range, range));

                    Some((from.trim().parse().ok()?, to.trim().parse().ok()?))
                })
                .collect::<Option<Vec<(u64, u64)>>>()?;

            relations.push(Relation {
                operand,
                modulus,
                within,
                ranges,
            });
        }

        condition.push(relations);
    }

    Some(condition)
}

/// The rules of one locale and type: each category's condition, `other`
/// taking what none does.
type Set = Vec<(Category, Condition)>;

struct Data {
    cardinal: HashMap<String, Set>,
    ordinal: HashMap<String, Set>,
    /// A language a tag may name, by the code it is read as, in lower case.
    aliases: HashMap<String, String>,
}

fn sets(text: &str) -> HashMap<String, Set> {
    let mut sets: HashMap<String, Set> = HashMap::new();
    let mut unread: Vec<String> = Vec::new();

    for string in read_catalogue(text)
        .map(|read| read.strings)
        .unwrap_or_default()
    {
        let [_, _, locale, count] = string.path.as_slice() else {
            continue;
        };
        let Some(category) = count
            .strip_prefix("pluralRule-count-")
            .and_then(Category::of)
        else {
            continue;
        };
        let locale = locale.to_ascii_lowercase();
        let set = sets.entry(locale.clone()).or_default();

        if category == Category::Other {
            continue;
        }

        match condition(&string.value) {
            Some(condition) => set.push((category, condition)),
            None => unread.push(locale),
        }
    }

    for locale in unread {
        sets.remove(&locale);
    }

    for set in sets.values_mut() {
        set.sort_by_key(|(category, _)| *category);
    }

    sets
}

fn aliases(text: &str) -> HashMap<String, String> {
    read_catalogue(text)
        .map(|read| read.strings)
        .unwrap_or_default()
        .into_iter()
        .filter_map(|string| {
            let [_, _, _, kind, language, member] = string.path.as_slice() else {
                return None;
            };

            (kind == "languageAlias" && member == "_replacement").then(|| {
                (
                    language.to_ascii_lowercase(),
                    string.value.to_ascii_lowercase(),
                )
            })
        })
        .collect()
}

fn data() -> &'static Data {
    static DATA: OnceLock<Data> = OnceLock::new();

    DATA.get_or_init(|| Data {
        cardinal: sets(PLURALS),
        ordinal: sets(ORDINALS),
        aliases: aliases(ALIASES),
    })
}

/// The plural rules of the Unicode CLDR the crate carries, for every locale
/// whose language they know.
#[derive(Clone, Copy, Debug, Default)]
pub struct Cldr;

struct Found {
    set: &'static [(Category, Condition)],
    places: usize,
}

impl Rules for Found {
    fn categories(&self) -> Vec<Category> {
        self.set
            .iter()
            .map(|(category, _)| *category)
            .chain([Category::Other])
            .collect()
    }

    fn select(&self, number: f64) -> Category {
        let Some(shown) = Shown::rounded(number, self.places).filter(|_| number.is_finite()) else {
            return Category::Other;
        };

        self.set
            .iter()
            .find(|(_, condition)| shown.meets(condition))
            .map_or(Category::Other, |(category, _)| *category)
    }
}

impl Plurals for Cldr {
    // The rules are the crate's, the same for every `Cldr`.
    fn kept(&self) -> Option<&KeptCategories> {
        static KEPT: KeptCategories = KeptCategories::new();

        Some(&KEPT)
    }

    fn rules(&self, tag: &str, kind: RuleType) -> Option<Box<dyn Rules + '_>> {
        let data = data();
        let tag = tag.to_ascii_lowercase();
        let read = well_formed(&tag)?;
        // A language written by a code the CLDR reads as another, alone or
        // with a variant or a region, which may be one of a script or a
        // region: `iw` is `he`, `sh` is `sr-Latn`, `sgn-US` is `ase`.
        let alias = |with: &str| data.aliases.get(&format!("{}-{with}", read.language));
        let varied = read.variants.iter().find_map(|variant| alias(variant));
        let placed = read.region.and_then(alias).filter(|_| varied.is_none());
        let named = varied
            .or(placed)
            .or_else(|| data.aliases.get(read.language))
            .and_then(|alias| well_formed(alias));
        let language = named.as_ref().map_or(read.language, |named| named.language);
        let script = read
            .script
            .or(named.as_ref().and_then(|named| named.script));
        let region = read
            .region
            .filter(|_| placed.is_none())
            .or(named.as_ref().and_then(|named| named.region));

        if language == "und" || !data.cardinal.contains_key(language) {
            return None;
        }

        let (sets, places) = match kind {
            // `plural` shows at most two fraction digits by default, and
            // selects by what it shows (section 11.5).
            RuleType::Cardinal => (&data.cardinal, 2),
            RuleType::Ordinal => (&data.ordinal, 3),
        };
        let set = [
            script
                .zip(region)
                .map(|(script, region)| format!("{language}-{script}-{region}")),
            script.map(|script| format!("{language}-{script}")),
            region.map(|region| format!("{language}-{region}")),
            Some(language.to_owned()),
        ]
        .into_iter()
        .flatten()
        .find_map(|key| sets.get(&key))
        .map_or(&[][..], Vec::as_slice);

        Some(Box::new(Found { set, places }))
    }
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::arithmetic_side_effects,
    clippy::indexing_slicing
)]
mod tests {
    use super::*;

    // Every number a sample list names: `2~4` is 2, 3 and 4, and `0.0~1.5`
    // every tenth between the two. A sample in compact notation is none a
    // number is shown as here.
    fn samples(list: &str) -> Vec<String> {
        let mut numbers = Vec::new();

        for sample in list.split(',').map(str::trim) {
            if sample.is_empty() || sample == "\u{2026}" || sample.contains(['c', 'e']) {
                continue;
            }

            let (from, to) = sample.split_once('~').unwrap_or((sample, sample));
            let places = from
                .split_once('.')
                .map_or(0, |(_, fraction)| fraction.len());
            let scaled = |text: &str| text.replace('.', "").parse::<u64>().unwrap();

            for value in scaled(from)..=scaled(to) {
                let text = format!("{value:0>width$}", width = places + 1);
                let (integer, fraction) = text.split_at(text.len() - places);

                numbers.push(if places == 0 {
                    integer.to_owned()
                } else {
                    format!("{integer}.{fraction}")
                });
            }
        }

        numbers
    }

    #[test]
    fn every_rule_answers_its_samples() {
        let mut checked = 0;

        for text in [PLURALS, ORDINALS] {
            let sets = sets(text);

            for string in read_catalogue(text).unwrap().strings {
                let [_, _, locale, count] = string.path.as_slice() else {
                    continue;
                };
                let category =
                    Category::of(count.strip_prefix("pluralRule-count-").unwrap()).unwrap();
                let set = &sets[&locale.to_ascii_lowercase()];

                for list in string.value.split('@').skip(1) {
                    let list = list
                        .trim_start_matches("integer")
                        .trim_start_matches("decimal");

                    for sample in samples(list) {
                        let shown = Shown::of(&sample).unwrap();
                        let answered = set
                            .iter()
                            .find(|(_, condition)| shown.meets(condition))
                            .map_or(Category::Other, |(category, _)| *category);

                        assert_eq!(answered, category, "{locale} {count} {sample}");
                        checked += 1;
                    }
                }
            }
        }

        assert!(checked > 10_000, "{checked}");
    }

    #[test]
    fn a_number_is_shown_rounded_half_away_from_zero() {
        let shown = |number: f64, places| {
            let shown = Shown::rounded(number, places).unwrap();

            (shown.integer.unwrap(), shown.visible, shown.fraction)
        };

        assert_eq!(shown(1.0, 2), (1, 0, 0));
        assert_eq!(shown(1.5, 2), (1, 1, 5));
        assert_eq!(shown(0.125, 2), (0, 2, 13));
        assert_eq!(shown(-0.375, 2), (0, 2, 38));
        assert_eq!(shown(1.005, 2), (1, 2, 1));
        assert_eq!(shown(0.995, 2), (1, 0, 0));
        assert_eq!(shown(1.999, 2), (2, 0, 0));
        assert_eq!(shown(9.995, 2), (10, 0, 0));
        assert_eq!(shown(9.994, 2), (9, 2, 99));
        assert_eq!(shown(99.999, 2), (100, 0, 0));
        assert_eq!(shown(20.001, 2), (20, 0, 0));
        assert_eq!(Shown::rounded(1e300, 2).unwrap().integer, None);
        assert_eq!(Shown::rounded(1e300, 2).unwrap().low, 0);
    }
}
