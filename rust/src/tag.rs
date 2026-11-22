/// What tells a locale tag from another: its text without regard to case, as
/// BCP 47 reads a tag, with `-` for `_`. No alias is resolved, as each host
/// resolves them from locale data of its own age.
pub fn locale_key(tag: &str) -> String {
    tag.chars()
        .map(|char| match char {
            '_' => '-',
            _ => char.to_ascii_lowercase(),
        })
        .collect()
}

fn alpha(text: &str, lengths: std::ops::RangeInclusive<usize>) -> bool {
    lengths.contains(&text.len()) && text.bytes().all(|byte| byte.is_ascii_alphabetic())
}

fn digits(text: &str, length: usize) -> bool {
    text.len() == length && text.bytes().all(|byte| byte.is_ascii_digit())
}

fn alphanumeric(text: &str, lengths: std::ops::RangeInclusive<usize>) -> bool {
    lengths.contains(&text.len()) && text.bytes().all(|byte| byte.is_ascii_alphanumeric())
}

fn variant(text: &str) -> bool {
    alphanumeric(text, 5..=8)
        || (alphanumeric(text, 4..=4) && text.bytes().next().is_some_and(|b| b.is_ascii_digit()))
}

/// What a language identifier of a tag names, and how many subtags it takes.
// Without the plural rules the crate carries, a tag is only told from text
// that is none.
#[cfg_attr(not(feature = "cldr"), expect(dead_code))]
pub(crate) struct Language<'a> {
    pub language: &'a str,
    pub script: Option<&'a str>,
    pub region: Option<&'a str>,
    /// Its variants, in lower case.
    pub variants: Vec<String>,
    taken: usize,
}

/// Reads the `unicode_language_id` that `subtags` open with (UTS #35, section
/// 3.2), or nothing where they open with none or repeat a variant.
pub(crate) fn language<'a>(subtags: &[&'a str]) -> Option<Language<'a>> {
    let mut rest = subtags.iter().copied().peekable();
    let language = rest
        .next()
        .filter(|text| alpha(text, 2..=3) || alpha(text, 5..=8))?;
    let script = rest.next_if(|text| alpha(text, 4..=4));
    let region = rest.next_if(|text| alpha(text, 2..=2) || digits(text, 3));
    let mut variants: Vec<String> = Vec::new();

    while let Some(text) = rest.next_if(|text| variant(text)) {
        let lower = text.to_ascii_lowercase();

        if variants.contains(&lower) {
            return None;
        }

        variants.push(lower);
    }

    let taken = [script, region]
        .iter()
        .flatten()
        .count()
        .saturating_add(variants.len())
        .saturating_add(1);

    Some(Language {
        language,
        script,
        region,
        variants,
        taken,
    })
}

fn key(text: &str) -> bool {
    let mut bytes = text.bytes();

    text.len() == 2
        && bytes.next().is_some_and(|b| b.is_ascii_alphanumeric())
        && bytes.next().is_some_and(|b| b.is_ascii_alphabetic())
}

fn field_key(text: &str) -> bool {
    let mut bytes = text.bytes();

    text.len() == 2
        && bytes.next().is_some_and(|b| b.is_ascii_alphabetic())
        && bytes.next().is_some_and(|b| b.is_ascii_digit())
}

// The subtags of a `u` extension: attributes, then keywords, one of either
// at least.
fn unicode(subtags: &[&str]) -> bool {
    !subtags.is_empty()
        && subtags
            .iter()
            .all(|text| key(text) || alphanumeric(text, 3..=8))
}

// The subtags of a `t` extension: a language identifier, then fields, each a
// key and one value or more, one of either at least.
fn transformed(subtags: &[&str]) -> bool {
    let fields = match language(subtags) {
        Some(read) => subtags.get(read.taken..).unwrap_or_default(),
        None => subtags,
    };
    let mut valued = true;
    let mut keyed = false;

    for text in fields {
        if field_key(text) {
            if !valued {
                return false;
            }

            keyed = true;
            valued = false;
        } else if keyed && alphanumeric(text, 3..=8) {
            valued = true;
        } else {
            return false;
        }
    }

    valued && !subtags.is_empty()
}

/// Reads a tag that is a well-formed Unicode locale identifier, as a host's
/// `Intl` takes one (UTS #35, section 3.2; ECMA-402, section 6.2.1): a
/// language, an optional script and region, variants, extensions and private
/// use, with no variant and no extension singleton written twice.
pub(crate) fn well_formed(tag: &str) -> Option<Language<'_>> {
    let subtags: Vec<&str> = tag.split('-').collect();
    let read = language(&subtags)?;
    let mut rest = subtags.get(read.taken..).unwrap_or_default();
    let mut singletons: Vec<u8> = Vec::new();

    while let Some((singleton, after)) = rest.split_first() {
        let &[letter] = singleton.as_bytes() else {
            return None;
        };
        let letter = letter.to_ascii_lowercase();

        if !letter.is_ascii_alphanumeric() || singletons.contains(&letter) {
            return None;
        }

        singletons.push(letter);

        if letter == b'x' {
            return (!after.is_empty() && after.iter().all(|text| alphanumeric(text, 1..=8)))
                .then_some(read);
        }

        let length = after
            .iter()
            .position(|text| text.len() == 1)
            .unwrap_or(after.len());
        let (own, next) = after.split_at_checked(length)?;
        let valid = match letter {
            b'u' => unicode(own),
            b't' => transformed(own),
            _ => !own.is_empty() && own.iter().all(|text| alphanumeric(text, 2..=8)),
        };

        if !valid {
            return None;
        }

        rest = next;
    }

    Some(read)
}
