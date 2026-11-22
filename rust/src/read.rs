use std::collections::HashMap;

use unicode_properties::{GeneralCategoryGroup, UnicodeGeneralCategory};

use crate::finding::Finding;
use crate::rules::Code;

/// A string a catalogue file holds, and where it stands in the file, in
/// bytes of its text.
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub struct Located {
    /// The path to the string: member names and array indices.
    pub path: Vec<String>,
    pub value: String,
    /// Where the string's opening quote stands, and where its closing quote
    /// ends.
    pub start: usize,
    pub end: usize,
    // Each escape sequence of the string: the byte of the value the
    // character it spells ends before, and the bytes the sequences up to it
    // are written with beyond those their characters take in the value.
    escapes: Vec<(usize, usize)>,
}

impl Located {
    /// Where the byte at `index` of the value is written in the file, past
    /// any escape sequence the file spells its character with; the value's
    /// length answers the closing quote.
    pub fn offset_of(&self, index: usize) -> usize {
        let index = index.min(self.value.len());
        let before = self.escapes.partition_point(|(ends, _)| *ends <= index);
        let extra = before
            .checked_sub(1)
            .and_then(|last| self.escapes.get(last))
            .map_or(0, |(_, extra)| *extra);

        self.start
            .saturating_add(1)
            .saturating_add(index)
            .saturating_add(extra)
    }
}

/// A member a later one of the same name replaces, so its value is never
/// read.
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub struct Replaced {
    pub path: Vec<String>,
    /// Where the member's name stands, quotes included.
    pub start: usize,
    pub end: usize,
}

/// Where a catalogue file stops being readable, and why.
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub struct Unreadable {
    pub message: String,
    pub offset: usize,
}

/// What reading a catalogue file yields.
#[derive(Clone, Debug, PartialEq, Eq)]
#[non_exhaustive]
pub struct Catalogue {
    /// Every string the file holds, in its order.
    pub strings: Vec<Located>,
    pub replaced: Vec<Replaced>,
}

/// How deep a catalogue's objects and arrays may nest.
const MAX_DEPTH: usize = 512;

/// A character as a report shows it: by its code point where it is
/// invisible, or would break the line the report is on.
pub(crate) fn shown(char: char) -> String {
    match char.general_category_group() {
        GeneralCategoryGroup::Other | GeneralCategoryGroup::Separator => {
            code_point(u32::from(char))
        }
        _ => format!("`{char}`"),
    }
}

fn code_point(value: u32) -> String {
    format!("U+{value:04X}")
}

struct Key {
    start: usize,
    end: usize,
    /// The strings the member's value holds: those from `from` up to `to`.
    from: usize,
    to: usize,
}

enum Frame {
    Object {
        keys: HashMap<String, Key>,
        /// The member being read.
        name: String,
        key: Key,
    },
    Array {
        index: usize,
    },
}

struct Text {
    value: String,
    start: usize,
    end: usize,
    escapes: Vec<(usize, usize)>,
}

struct Reader<'a> {
    text: &'a str,
    bytes: &'a [u8],
    at: usize,
}

impl Reader<'_> {
    fn byte(&self) -> Option<u8> {
        self.bytes.get(self.at).copied()
    }

    fn step(&mut self, bytes: usize) {
        self.at = self.at.saturating_add(bytes);
    }

    fn fail<T>(&self, what: &str) -> Result<T, Unreadable> {
        let found = self
            .text
            .get(self.at..)
            .and_then(|rest| rest.chars().next())
            .map_or_else(|| "the end of the file".to_owned(), shown);

        Err(Unreadable {
            message: format!("{what}, found {found}"),
            offset: self.at,
        })
    }

    fn space(&mut self) {
        while matches!(self.byte(), Some(b' ' | b'\t' | b'\n' | b'\r')) {
            self.step(1);
        }
    }

    fn takes(&mut self, byte: u8) -> bool {
        let found = self.byte() == Some(byte);

        if found {
            self.step(1);
        }

        found
    }

    // The four hexadecimal digits of a `\u` escape at `at`, as the code unit
    // they spell.
    fn unit(&self, at: usize) -> Option<u32> {
        let digits = self.bytes.get(at.checked_add(2)?..at.checked_add(6)?)?;

        digits.iter().try_fold(0_u32, |unit, digit| {
            unit.checked_mul(16)?
                .checked_add(char::from(*digit).to_digit(16)?)
        })
    }

    fn string(&mut self) -> Result<Text, Unreadable> {
        let start = self.at;
        let mut value = String::new();
        let mut escapes: Vec<(usize, usize)> = Vec::new();
        let mut extra = 0_usize;

        if !self.takes(b'"') {
            return self.fail("Expected a string");
        }

        loop {
            let Some(byte) = self.byte() else {
                return self.fail("Expected the string to close");
            };

            if byte == b'"' {
                break;
            }

            if byte < b' ' {
                return self.fail("Expected a control character to be escaped");
            }

            if byte != b'\\' {
                let Some(char) = self
                    .text
                    .get(self.at..)
                    .and_then(|rest| rest.chars().next())
                else {
                    return self.fail("Expected the string to close");
                };

                value.push(char);
                self.step(char.len_utf8());
                continue;
            }

            let from = self.at;
            let kind = self.bytes.get(from.saturating_add(1)).copied();
            let char = match kind {
                Some(b'u') => self.escaped(from)?,
                Some(b'"') => '"',
                Some(b'\\') => '\\',
                Some(b'/') => '/',
                Some(b'b') => '\u{8}',
                Some(b'f') => '\u{c}',
                Some(b'n') => '\n',
                Some(b'r') => '\r',
                Some(b't') => '\t',
                _ => {
                    self.step(1);

                    return self.fail("Expected an escape sequence");
                }
            };

            if kind != Some(b'u') {
                self.step(2);
            }

            value.push(char);
            extra = extra
                .saturating_add(self.at.saturating_sub(from))
                .saturating_sub(char.len_utf8());
            escapes.push((value.len(), extra));
        }

        self.step(1);

        Ok(Text {
            value,
            start,
            end: self.at,
            escapes,
        })
    }

    // The character a `\u` escape at `from` spells, alone or with the escape
    // after it, read past both. A surrogate that pairs with no other stops
    // the text where it is written, before any fault past it.
    fn escaped(&mut self, from: usize) -> Result<char, Unreadable> {
        self.at = from;

        let Some(unit) = self.unit(from) else {
            return self.fail("Expected four hexadecimal digits");
        };
        let unpaired = Err(Unreadable {
            message: format!(
                "Expected well-formed Unicode text, found the unpaired surrogate {}",
                code_point(unit)
            ),
            offset: from,
        });

        self.step(6);

        if let Some(char) = char::from_u32(unit) {
            return Ok(char);
        }

        let low = (self
            .bytes
            .get(self.at..)
            .is_some_and(|rest| rest.starts_with(b"\\u")))
        .then(|| self.unit(self.at))
        .flatten()
        .filter(|low| (0xdc00..=0xdfff).contains(low));

        match low {
            Some(low) if unit < 0xdc00 => {
                let pair = [u16::try_from(unit), u16::try_from(low)];
                let [Ok(high), Ok(low)] = pair else {
                    return unpaired;
                };
                let Some(Ok(char)) = char::decode_utf16([high, low]).next() else {
                    return unpaired;
                };

                self.step(6);

                Ok(char)
            }
            _ => unpaired,
        }
    }

    fn number(&mut self) -> bool {
        let start = self.at;
        let digits = |reader: &mut Self| {
            let from = reader.at;

            while reader.byte().is_some_and(|byte| byte.is_ascii_digit()) {
                reader.step(1);
            }

            reader.at > from
        };

        self.takes(b'-');

        if !self.takes(b'0') && !digits(self) {
            self.at = start;

            return false;
        }

        // A fraction or an exponent that is not whole is no part of the
        // number, which then ends before it.
        let whole = self.at;

        if self.takes(b'.') && !digits(self) {
            self.at = whole;
        }

        let whole = self.at;

        if self.takes(b'e') || self.takes(b'E') {
            if !self.takes(b'+') {
                self.takes(b'-');
            }

            if !digits(self) {
                self.at = whole;
            }
        }

        true
    }

    fn word(&mut self) -> bool {
        let rest = self.bytes.get(self.at..).unwrap_or_default();

        for word in ["true", "false", "null"] {
            if rest.starts_with(word.as_bytes()) {
                self.step(word.len());

                return true;
            }
        }

        false
    }
}

struct Document {
    strings: Vec<Located>,
    /// The ranges of `strings` a later member of the same name replaced.
    dropped: Vec<(usize, usize)>,
    replaced: Vec<Replaced>,
    path: Vec<String>,
    /// The objects and arrays being read, the innermost last: a stack of its
    /// own rather than the call stack, so that how deep a file nests is
    /// bounded by `MAX_DEPTH` alone.
    open: Vec<Frame>,
}

impl Document {
    // Reads the name of an object's next member and the colon after it, and
    // opens the member.
    fn member(
        &mut self,
        reader: &mut Reader<'_>,
        mut keys: HashMap<String, Key>,
    ) -> Result<(), Unreadable> {
        reader.space();

        let name = reader.string()?;

        reader.space();

        if !reader.takes(b':') {
            return reader.fail("Expected a colon");
        }

        self.path.push(name.value.clone());

        if let Some(earlier) = keys.remove(&name.value) {
            self.replaced.push(Replaced {
                path: self.path.clone(),
                start: earlier.start,
                end: earlier.end,
            });
            // What the earlier member held is no longer in the catalogue.
            self.dropped.push((earlier.from, earlier.to));
        }

        self.open.push(Frame::Object {
            keys,
            name: name.value,
            key: Key {
                start: name.start,
                end: name.end,
                from: self.strings.len(),
                to: 0,
            },
        });

        Ok(())
    }

    // Reads from a value's first character to where the value after it
    // starts, closing each object and array that ends there. Answers whether
    // a value follows.
    fn value(&mut self, reader: &mut Reader<'_>) -> Result<bool, Unreadable> {
        reader.space();

        match reader.byte() {
            Some(b'{' | b'[') if self.open.len() >= MAX_DEPTH => {
                return Err(Unreadable {
                    message: format!("The catalogue nests deeper than {MAX_DEPTH} levels"),
                    offset: reader.at,
                });
            }
            Some(b'{') => {
                reader.step(1);
                reader.space();

                if !reader.takes(b'}') {
                    self.member(reader, HashMap::new())?;

                    return Ok(true);
                }
            }
            Some(b'[') => {
                reader.step(1);
                reader.space();

                if !reader.takes(b']') {
                    self.path.push("0".to_owned());
                    self.open.push(Frame::Array { index: 0 });

                    return Ok(true);
                }
            }
            Some(b'"') => {
                let Text {
                    value,
                    start,
                    end,
                    escapes,
                } = reader.string()?;

                self.strings.push(Located {
                    path: self.path.clone(),
                    value,
                    start,
                    end,
                    escapes,
                });
            }
            _ => {
                if !reader.word() && !reader.number() {
                    return reader.fail("Expected a value");
                }
            }
        }

        while let Some(frame) = self.open.pop() {
            self.path.pop();
            reader.space();

            match frame {
                Frame::Object {
                    mut keys,
                    name,
                    mut key,
                } => {
                    key.to = self.strings.len();
                    keys.insert(name, key);

                    if reader.takes(b',') {
                        self.member(reader, keys)?;

                        return Ok(true);
                    }

                    if !reader.takes(b'}') {
                        return reader.fail("Expected a comma or a closing brace");
                    }
                }
                Frame::Array { index } => {
                    if reader.takes(b',') {
                        let index = index.saturating_add(1);

                        self.path.push(index.to_string());
                        self.open.push(Frame::Array { index });

                        return Ok(true);
                    }

                    if !reader.takes(b']') {
                        return reader.fail("Expected a comma or a closing bracket");
                    }
                }
            }
        }

        Ok(false)
    }

    // The strings no dropped range covers.
    fn kept(self) -> Catalogue {
        let mut covered: Vec<isize> = vec![0; self.strings.len().saturating_add(1)];

        for (from, to) in &self.dropped {
            if let Some(count) = covered.get_mut(*from) {
                *count = count.saturating_add(1);
            }

            if let Some(count) = covered.get_mut(*to) {
                *count = count.saturating_sub(1);
            }
        }

        let mut depth = 0_isize;
        let strings = self
            .strings
            .into_iter()
            .zip(covered)
            .filter(|(_, change)| {
                depth = depth.saturating_add(*change);

                depth == 0
            })
            .map(|(string, _)| string)
            .collect();

        Catalogue {
            strings,
            replaced: self.replaced,
        }
    }
}

/// Reads a JSON catalogue the way a host's JSON reader does — a later member
/// of the same name replaces an earlier one — past a byte order mark, and
/// says where each string stands, so a finding in a message can be pointed
/// at in the file. A catalogue nested deeper than 512 levels is not read,
/// nor one that spells a surrogate no other pairs with.
pub fn read_catalogue(text: &str) -> Result<Catalogue, Unreadable> {
    let mut reader = Reader {
        text,
        bytes: text.as_bytes(),
        // A byte order mark is no part of the document.
        at: if text.starts_with('\u{feff}') { 3 } else { 0 },
    };
    let mut document = Document {
        strings: Vec::new(),
        dropped: Vec::new(),
        replaced: Vec::new(),
        path: Vec::new(),
        open: Vec::new(),
    };

    while document.value(&mut reader)? {}

    reader.space();

    if reader.at < text.len() {
        return reader.fail("Expected the end of the file");
    }

    Ok(document.kept())
}

/// The findings reading a catalogue file yields, located by bytes of its
/// text: where the file stops being readable, or each member a later one of
/// the same name replaces.
pub fn read_findings(read: &Result<Catalogue, Unreadable>) -> Vec<Finding> {
    match read {
        Ok(catalogue) => {
            let mut findings: Vec<Finding> = catalogue
                .replaced
                .iter()
                .map(|replaced| {
                    Finding::new(
                        Code::DuplicateId,
                        None,
                        format!(
                            "`{}` is defined again later in this object, so this value is never read.",
                            replaced.path.last().map_or("", String::as_str)
                        ),
                        (replaced.start, replaced.end),
                    )
                })
                .collect();

            findings.sort_by(Finding::by_place);

            findings
        }
        Err(unreadable) => vec![Finding::new(
            Code::UnreadableCatalogue,
            None,
            format!("{}.", unreadable.message),
            (unreadable.offset, unreadable.offset),
        )],
    }
}
