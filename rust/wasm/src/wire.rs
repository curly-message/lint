//! How a request and an answer are written: a table of numbers, each four
//! bytes with the lowest first, then one text, which the numbers cut.

use std::borrow::Cow;

/// A request: how many numbers, the numbers, then UTF-8 text, which the
/// numbers cut whole, so what its buffer holds past the last text is not
/// read. A text is cut by its length in UTF-16 code units, which is what
/// the host knows of a string before it is encoded. Text that is not UTF-8
/// is read as `String::from_utf8_lossy` reads it.
pub struct Request<'a> {
    numbers: std::slice::Iter<'a, [u8; 4]>,
    text: Cow<'a, str>,
    /// Whether a code unit of the text is a byte of it.
    ascii: bool,
    at: usize,
}

impl<'a> Request<'a> {
    pub fn new(bytes: &'a [u8]) -> Self {
        let (count, rest) = bytes.split_at_checked(4).unwrap_or((&[], &[]));
        let count = usize::try_from(number(count)).unwrap_or(usize::MAX);
        let (numbers, text) = rest
            .split_at_checked(count.saturating_mul(4))
            .unwrap_or((&[], &[]));

        Self {
            numbers: numbers.as_chunks::<4>().0.iter(),
            text: String::from_utf8_lossy(text),
            ascii: text.is_ascii(),
            at: 0,
        }
    }

    /// The next number, and zero past the last.
    pub fn number(&mut self) -> usize {
        usize::try_from(self.numbers.next().copied().map_or(0, u32::from_le_bytes))
            .unwrap_or(usize::MAX)
    }

    /// The next text, as long in code units as the next number says.
    pub fn text(&mut self) -> &str {
        let units = self.number();
        let from = self.at;
        let rest = self.text.get(from..).unwrap_or("");
        let len = if self.ascii {
            units.min(rest.len())
        } else {
            let mut left = units;

            rest.char_indices()
                .find(|(_, char)| {
                    let within = left >= char.len_utf16();

                    left = left.saturating_sub(char.len_utf16());
                    !within
                })
                .map_or(rest.len(), |(at, _)| at)
        };

        self.at = from.saturating_add(len);
        self.text.get(from..self.at).unwrap_or("")
    }

    /// As many texts as the next number says.
    pub fn texts(&mut self) -> Vec<String> {
        (0..self.number()).map(|_| self.text().to_owned()).collect()
    }
}

fn number(bytes: &[u8]) -> u32 {
    bytes.try_into().map_or(0, u32::from_le_bytes)
}

/// The most bytes of text a page of an answer holds, but where one text is
/// longer: a page is read as one string, and a host holds a string only up
/// to a length, V8 one of 2^29 code units.
const PAGE: usize = 1 << 26;

/// An answer: a table of numbers, each four bytes with the lowest first, and
/// UTF-8 text, which the numbers cut, each its own buffer so that neither is
/// copied into the other. A text is cut by its length in UTF-16 code units,
/// which is what the host slices a string by, and lies on one page of the
/// text: `pages` holds where each page but the last ends, in bytes.
#[derive(Default)]
pub struct Answer {
    pub numbers: Vec<u8>,
    pub text: String,
    pub pages: Vec<u8>,
    page: usize,
}

impl Answer {
    /// How many bytes the answer holds.
    pub fn size(&self) -> usize {
        self.numbers.len().saturating_add(self.text.len())
    }

    pub fn number(&mut self, number: usize) {
        self.numbers
            .extend(u32::try_from(number).unwrap_or(u32::MAX).to_le_bytes());
    }

    pub fn text(&mut self, text: &str) {
        if self
            .text
            .len()
            .saturating_sub(self.page)
            .saturating_add(text.len())
            > PAGE
            && self.text.len() > self.page
        {
            self.page = self.text.len();
            self.pages
                .extend(u32::try_from(self.page).unwrap_or(u32::MAX).to_le_bytes());
        }

        self.number(units(text));
        self.text.push_str(text);
    }
}

/// How many UTF-16 code units a text takes.
pub fn units(text: &str) -> usize {
    if text.is_ascii() {
        text.len()
    } else {
        text.chars().map(char::len_utf16).sum()
    }
}

/// Rewrites each offset, a count of bytes into `text`, as the count of
/// UTF-16 code units before it, reading the text once.
pub fn in_units<'a>(text: &str, offsets: impl IntoIterator<Item = &'a mut usize>) {
    if text.is_ascii() {
        return;
    }

    let mut offsets: Vec<&mut usize> = offsets.into_iter().collect();

    offsets.sort_unstable_by_key(|offset| **offset);

    let mut chars = text.char_indices().peekable();
    let mut units = 0_usize;

    for offset in offsets {
        while let Some((_, char)) = chars.next_if(|(at, _)| *at < *offset) {
            units = units.saturating_add(char.len_utf16());
        }

        *offset = units;
    }
}
