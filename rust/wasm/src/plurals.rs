//! The plural rules of the host the module runs in, asked through its two
//! imports and kept, so that a locale and a number are each asked once.

use std::cell::RefCell;
use std::collections::HashMap;

use curly_message_lint::{Category, Plurals, RuleType, Rules};

use crate::abi;

/// How many bits of an answer name the categories.
const CATEGORIES: u32 = 6;

/// A locale's rules of one type: the host's handle to them, and the
/// categories they answer, a bit each.
#[derive(Clone, Copy)]
struct Handle {
    rules: u32,
    categories: u32,
}

thread_local! {
    // By tag, and whether the rules are the ordinal ones.
    static KNOWN: RefCell<HashMap<(String, bool), Option<Handle>>> = RefCell::default();
    static SELECTED: RefCell<HashMap<(u32, u64), Category>> = RefCell::default();
}

/// The host's plural rules.
pub struct Hosted;

// No borrow is held across a call of the host, which may call the module
// again from inside it.
impl Plurals for Hosted {
    fn rules(&self, tag: &str, kind: RuleType) -> Option<Box<dyn Rules + '_>> {
        let ordinal = kind == RuleType::Ordinal;
        let key = (tag.to_owned(), ordinal);
        let known = KNOWN.with_borrow(|known| known.get(&key).copied());
        let handle = known.unwrap_or_else(|| {
            let answer = abi::rules_of(tag, ordinal);
            let answer = match u32::try_from(answer) {
                Ok(answer) => Some(Handle {
                    rules: answer.checked_shr(CATEGORIES).unwrap_or(0),
                    categories: answer & 0b11_1111,
                }),
                Err(_) if answer == -1 => None,
                Err(_) => crate::fail(),
            };

            KNOWN.with_borrow_mut(|known| known.insert(key, answer));
            answer
        })?;

        Some(Box::new(handle))
    }
}

impl Rules for Handle {
    fn categories(&self) -> Vec<Category> {
        Category::ALL
            .into_iter()
            .zip(0_u32..)
            .filter(|(_, bit)| self.categories.checked_shr(*bit).unwrap_or(0) & 1 == 1)
            .map(|(category, _)| category)
            .collect()
    }

    fn select(&self, number: f64) -> Category {
        // Zero and its negative are one number to every rule.
        let key = (self.rules, if number == 0.0 { 0 } else { number.to_bits() });

        SELECTED
            .with_borrow(|selected| selected.get(&key).copied())
            .unwrap_or_else(|| {
                let category = usize::try_from(abi::select(self.rules, number))
                    .ok()
                    .and_then(|index| Category::ALL.get(index).copied())
                    .unwrap_or_else(|| crate::fail());

                SELECTED.with_borrow_mut(|selected| selected.insert(key, category));
                category
            })
    }
}
