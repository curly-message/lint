//! What the fixture set cannot state: the plural rules the crate carries,
//! inputs too large or too many for a fixture, and the table of rules.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::string_slice,
    clippy::arithmetic_side_effects
)]

use std::cell::RefCell;

use curly_message_lint::{
    Category, Code, EntriesOptions, Entry, Located, NoPlurals, Options, Plurals, RULES, RuleType,
    Rules, Scope, Table, lint_entries, lint_message, locale_key, probes, read_catalogue,
    read_findings,
};

// A sequence that is the same on every run.
struct Sequence(u32);

impl Sequence {
    fn next(&mut self, below: usize) -> usize {
        self.0 = self.0.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);

        (self.0 >> 8) as usize % below
    }

    fn text(&mut self, pieces: &[&str], most: usize) -> String {
        (0..self.next(most))
            .map(|_| pieces[self.next(pieces.len())])
            .collect()
    }
}

#[test]
fn lists_each_rule_once_with_its_code_in_its_place() {
    for (index, rule) in RULES.iter().enumerate() {
        assert_eq!(rule.code as usize, index);
        assert_eq!(rule.code.rule().code, rule.code);
        assert!(!rule.description.is_empty() && !rule.name.is_empty());
        // A rule about a message names the section it rests on.
        assert!(
            rule.section.is_some() || rule.scope == Scope::Catalogue,
            "{}",
            rule.code.as_str()
        );
    }

    assert_eq!(RULES.len(), 22);
    assert_eq!(Code::UnclosedPlaceholder.as_str(), "unclosed-placeholder");
}

#[test]
fn the_readme_lists_every_rule_as_the_table_states_it() {
    let rows: Vec<&str> = include_str!("../README.md")
        .lines()
        .skip_while(|line| *line != "## Rules")
        .filter(|line| line.starts_with("| `"))
        .collect();
    let stated: Vec<String> = RULES
        .iter()
        .map(|rule| {
            format!(
                "| `{}` | {} | {} | {} |",
                rule.name,
                rule.severity.as_str(),
                rule.section.unwrap_or(""),
                rule.description
            )
        })
        .collect();

    assert_eq!(rows, stated);
}

#[test]
fn the_readme_names_the_version_of_unicode_the_lockfile_resolves() {
    let (major, minor, _) = unicode_properties::UNICODE_VERSION;

    assert!(include_str!("../README.md").contains(&format!(
        "  Unicode {major}.{minor} as the crate's lockfile resolves it"
    )));
}

#[test]
fn asks_a_host_about_the_numbers_the_fixture_set_names() {
    let probes = probes();

    assert_eq!(probes.len(), 1 + 2 * (200 + 4 + 21) + 2 * 21);
    assert_eq!(probes[..3], [0.0, 1.0, 2.0]);
    assert_eq!(
        probes[201..206],
        [1000.0, 10000.0, 100_000.0, 1_000_000.0, 0.5]
    );
    assert_eq!(probes[226], -1.0);
    assert_eq!(probes[probes.len() - 42], 0.001);
    assert_eq!(probes[probes.len() - 1], -20.001);
}

#[test]
fn tells_a_locale_from_another_by_its_key() {
    assert_eq!(locale_key("pt_BR"), "pt-br");
    assert_eq!(locale_key("EN-us"), "en-us");
    // No letter outside A-Z is lowered, as BCP 47 reads a tag.
    assert_eq!(locale_key("\u{130}\u{c9}"), "\u{130}\u{c9}");
}

#[test]
fn a_table_answers_for_a_locale_however_its_tag_is_written() {
    let mut table = Table::new();

    table.insert(
        "pt_PT",
        RuleType::Cardinal,
        &[Category::One, Category::Many, Category::Other],
        &[(Category::One, &[1.0]), (Category::Many, &[1_000_000.0])],
    );

    for locale in ["pt-PT", "pt_pt", "PT-pt"] {
        let found = lint_message(
            "{{n:plural; one:a; other:b;}}",
            &Options::default().locale(locale),
            &table,
        );

        assert_eq!(
            found.iter().map(|found| found.code).collect::<Vec<_>>(),
            [Code::MissingCategory],
            "{locale}"
        );
    }

    // Another locale's rules are not this one's.
    assert!(
        lint_message(
            "{{n:plural; one:a; other:b;}}",
            &Options::default().locale("pt-BR"),
            &table
        )
        .is_empty()
    );
}

#[test]
fn asks_a_host_only_for_a_tag_that_is_well_formed() {
    struct Asking(RefCell<Vec<String>>);

    impl Plurals for Asking {
        fn rules(&self, tag: &str, _: RuleType) -> Option<Box<dyn Rules + '_>> {
            self.0.borrow_mut().push(tag.to_owned());
            None
        }
    }

    let host = Asking(RefCell::default());
    let tags = [
        "en_US",
        "sl-rozaj-biske-1994",
        "en-u-ca-gregory-x-a",
        "art-lojban",
        "not a locale",
        "abcd",
        "en--us",
        "i-klingon",
        "x-private",
        "en-u",
        "de-1996-1996",
        "en-a-bbb-a-ccc",
    ];

    for tag in tags {
        lint_message(
            "{{n:plural; one:a; other:b;}}",
            &Options::default().locale(tag),
            &host,
        );
    }

    assert_eq!(
        host.0.into_inner(),
        [
            "en-us",
            "sl-rozaj-biske-1994",
            "en-u-ca-gregory-x-a",
            "art-lojban"
        ]
    );
}

#[test]
fn reads_any_text_as_a_message_or_a_catalogue() {
    let pieces = [
        "{{",
        "}}",
        "{",
        "}",
        ":",
        ";",
        "\\",
        "#",
        " ",
        "\n",
        "\r",
        "\u{2028}",
        "a",
        "n",
        "plural",
        "ordinal",
        "eq",
        "number",
        "one",
        "other",
        "few",
        "default",
        "0",
        "1",
        "1.5",
        "-",
        "e",
        "\u{e9}",
        "\u{1f600}",
        "\u{feff}",
        "\t",
        "=",
        "\u{0}",
    ];
    let json = [
        "{",
        "}",
        "[",
        "]",
        "\"",
        ":",
        ",",
        "\\",
        "\\u",
        "d83d",
        "de00",
        "u",
        "a",
        "1",
        "e",
        "-",
        ".",
        " ",
        "\n",
        "true",
        "null",
        "\u{e9}",
        "\u{1f600}",
        "\u{1}",
    ];
    let mut sequence = Sequence(7);
    let options = Options::default().locale("cs");

    for _ in 0..20_000 {
        let message = sequence.text(&pieces, 24);

        for found in lint_message(&message, &options, &NoPlurals) {
            assert!(
                found.start <= found.end
                    && message.is_char_boundary(found.start)
                    && message.is_char_boundary(found.end),
                "{message:?}"
            );
        }

        let text = sequence.text(&json, 24);
        let read = read_catalogue(&text);

        for found in read_findings(&read) {
            assert!(
                text.is_char_boundary(found.start) && text.is_char_boundary(found.end),
                "{text:?}"
            );
        }

        for string in read.map(|read| read.strings).unwrap_or_default() {
            assert_eq!(
                text.get(string.start..=string.start),
                Some("\""),
                "{text:?}"
            );
            assert_eq!(
                string.offset_of(string.value.len()),
                string.end - 1,
                "{text:?}"
            );

            // Each escape spells the character it stands for where the
            // value's bytes are located, in the order the file writes them.
            let mut after = string.start;

            for escape in string.escapes() {
                let char = string.value[escape.index..].chars().next().unwrap();

                assert!(escape.start > after && escape.end < string.end, "{text:?}");
                assert_eq!(
                    text.get(escape.start..=escape.start),
                    Some("\\"),
                    "{text:?}"
                );
                assert_eq!(string.offset_of(escape.index), escape.start, "{text:?}");
                assert_eq!(
                    string.offset_of(escape.index + char.len_utf8()),
                    escape.end,
                    "{text:?}"
                );
                after = escape.end - 1;
            }
        }
    }
}

#[test]
fn says_where_each_escape_of_a_string_is_written() {
    let catalogue = read_catalogue(r#"{"a": "x\n\u00e9\ud83d\ude00\"y", "b": "\u00e9"}"#).unwrap();
    let escapes = |string: &Located| -> Vec<(usize, usize, usize)> {
        string
            .escapes()
            .map(|escape| (escape.index, escape.start, escape.end))
            .collect()
    };

    assert_eq!(catalogue.strings[0].value, "x\n\u{e9}\u{1f600}\"y");
    // A pair of `\u` sequences spells one character, and is one escape.
    assert_eq!(
        escapes(&catalogue.strings[0]),
        [(1, 8, 10), (2, 10, 16), (4, 16, 28), (8, 28, 30)]
    );
    assert_eq!(escapes(&catalogue.strings[1]), [(0, 40, 46)]);
    assert_eq!(
        escapes(&read_catalogue(r#""\u00e9 \u00e9""#).unwrap().strings[0]),
        [(0, 1, 7), (3, 8, 14)]
    );
    assert_eq!(
        escapes(&read_catalogue("\"\u{e9}\"").unwrap().strings[0]),
        []
    );
}

#[test]
fn reads_a_message_and_a_catalogue_far_larger_than_any_written() {
    let count = 100_000;

    assert_eq!(
        lint_message(&"{{".repeat(count), &Options::default(), &NoPlurals).len(),
        count
    );
    assert!(!lint_message(&"{{a; b:".repeat(count), &Options::default(), &NoPlurals).is_empty());
    assert!(
        lint_message(
            &format!("{}{}", "{{a; b:".repeat(count), ";}}".repeat(count)),
            &Options::default(),
            &NoPlurals
        )
        .iter()
        .any(|found| found.code == Code::NestingLimit)
    );
    assert_eq!(
        lint_message(&"\\x".repeat(count), &Options::default(), &NoPlurals).len(),
        count
    );

    assert_eq!(
        read_findings(&read_catalogue(&"[".repeat(count)))[0].message,
        "The catalogue nests deeper than 512 levels."
    );
    assert_eq!(
        read_catalogue(&"{\"a\":".repeat(count)).unwrap_err().offset,
        512 * 5
    );

    let members: Vec<String> = (0..count)
        .map(|index| format!("\"k{index}\": \"v\", \"k{index}\": \"w\""))
        .collect();
    let read = read_catalogue(&format!("{{{}}}", members.join(","))).unwrap();

    assert_eq!((read.strings.len(), read.replaced.len()), (count, count));

    let entries: Vec<Entry> = (0..count)
        .map(|index| Entry {
            locale: if index % 2 == 0 { "en" } else { "cs" }.to_owned(),
            id: format!("k{}", index / 3),
            message: "{{n}}".to_owned(),
        })
        .collect();
    let options = EntriesOptions::default();

    assert!(!lint_entries(&entries, &options, &NoPlurals).is_empty());
}

#[test]
fn holds_no_room_a_finding_does_not_fill() {
    let entries: Vec<Entry> = ["{{a:zz}} {{", "{{n:plural; one:a;}}", "{{x}}"]
        .iter()
        .enumerate()
        .map(|(index, message)| Entry {
            locale: if index == 1 { "cs" } else { "en" }.to_owned(),
            id: format!("k{index}"),
            message: (*message).to_owned(),
        })
        .collect();
    let found = lint_entries(&entries, &EntriesOptions::default(), &NoPlurals);

    assert!(found.len() >= 3);
    assert!(
        found
            .iter()
            .all(|found| found.finding.message.capacity() == found.finding.message.len())
    );
}

#[cfg(feature = "cldr")]
mod cldr {
    use curly_message_lint::{Category, Cldr, Code, Options, Plurals, RuleType, lint_message};
    use sha2::{Digest, Sha256};

    // The files of `cldr-core` 48.0.0 as its package holds them.
    const PINNED: [(&str, &str); 3] = [
        (
            "plurals.json",
            "6c0a48e9bcfc25856f90202f703c2c7f89c105d6868f7712a943a6ed2dcbe8f4",
        ),
        (
            "ordinals.json",
            "8a945afc483a4f677fb5641f08a2ccc62948ee05f316d21996be6561c2f83155",
        ),
        (
            "aliases.json",
            "b7011c866f27502ed6f160ca83f2a83fa42bce9fdc2176e60e2c6630961d877c",
        ),
    ];

    type Select = Box<dyn Fn(f64) -> &'static str>;

    fn rules(tag: &str, kind: RuleType) -> Option<(Vec<&'static str>, Select)> {
        let categories = Cldr
            .rules(tag, kind)?
            .categories()
            .into_iter()
            .map(Category::as_str)
            .collect();
        let tag = tag.to_owned();

        Some((
            categories,
            Box::new(move |number| Cldr.rules(&tag, kind).unwrap().select(number).as_str()),
        ))
    }

    #[test]
    fn carries_the_data_files_as_the_cldr_published_them() {
        for (name, pinned) in PINNED {
            let bytes = std::fs::read(
                std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                    .join("cldr")
                    .join(name),
            )
            .unwrap();
            let digest: String = Sha256::digest(&bytes)
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect();

            assert_eq!(digest, pinned, "{name}");
            assert!(
                String::from_utf8(bytes)
                    .unwrap()
                    .contains("\"_cldrVersion\": \"48\""),
                "{name}"
            );
        }
    }

    #[test]
    fn answers_the_categories_of_a_locale_and_the_one_a_number_takes() {
        let (categories, select) = rules("cs", RuleType::Cardinal).unwrap();

        assert_eq!(categories, ["one", "few", "many", "other"]);
        assert_eq!(
            [1.0, 3.0, 1.5, 5.0, -1.0, 0.0].map(&select),
            ["one", "few", "many", "other", "one", "other"]
        );

        let (categories, select) = rules("ar", RuleType::Cardinal).unwrap();

        assert_eq!(categories, ["zero", "one", "two", "few", "many", "other"]);
        assert_eq!(
            [0.0, 1.0, 2.0, 3.0, 11.0, 100.0, 103.0].map(&select),
            ["zero", "one", "two", "few", "many", "other", "few"]
        );

        let (categories, select) = rules("en", RuleType::Ordinal).unwrap();

        assert_eq!(categories, ["one", "two", "few", "other"]);
        assert_eq!(
            [1.0, 2.0, 3.0, 4.0, 11.0, 12.0, 13.0, 21.0, 112.0].map(&select),
            [
                "one", "two", "few", "other", "other", "other", "other", "one", "other"
            ]
        );

        // A locale the CLDR lists no ordinal rule for has the one category.
        assert_eq!(rules("cs", RuleType::Ordinal).unwrap().0, ["other"]);
    }

    #[test]
    fn selects_by_the_number_as_plural_shows_it() {
        let (_, select) = rules("en", RuleType::Cardinal).unwrap();

        // At most two fraction digits, rounded half away from zero, and no
        // trailing zero: 1.001 is shown as 1.
        assert_eq!(
            [1.0, 1.001, 1.004, 1.005, 0.999, 0.995, 1.5, -1.0].map(&select),
            ["one", "one", "one", "other", "one", "one", "other", "one"]
        );
        assert_eq!(
            [
                f64::NAN,
                f64::INFINITY,
                f64::NEG_INFINITY,
                1e300,
                1e-300,
                f64::MAX,
                5e-324
            ]
            .map(&select),
            ["other"; 7]
        );

        let (_, select) = rules("ru", RuleType::Cardinal).unwrap();

        assert_eq!(
            [21.0, 22.0, 25.0, 111.0, 1e21 + 1.0, 1.0e15 + 1.0].map(&select),
            ["one", "few", "many", "many", "many", "one"]
        );
    }

    #[test]
    fn reads_a_tag_as_the_cldr_reads_its_language() {
        let categories =
            |tag: &str| rules(tag, RuleType::Cardinal).map(|(categories, _)| categories);

        assert_eq!(categories("pt"), categories("pt-br"));
        assert_ne!(categories("pt-pt"), None);
        assert_eq!(categories("en-us"), categories("en"));
        assert_eq!(
            categories("en-latn-us-posix-u-nu-latn-x-private"),
            categories("en")
        );
        // A language by another code, alone or with a variant or a region.
        assert_eq!(categories("iw"), categories("he"));
        assert_eq!(categories("sh"), categories("sr"));
        assert_eq!(categories("no-bokmal"), categories("nb"));
        assert_eq!(categories("aa-saaho"), categories("ssy"));
        assert_eq!(categories("zh-hakka"), None);
        assert_eq!(categories("sgn-us"), None);

        for none in [
            "",
            "und",
            "und-us",
            "xx",
            "common",
            "e",
            "en-",
            "en--us",
            "en-us-us",
            "en-fonipa-fonipa",
            "en-u",
            "en-a-bbb-a-ccc",
            "i-klingon",
            "not a tag",
        ] {
            assert_eq!(categories(none), None, "{none}");
        }
    }

    #[test]
    fn names_the_numbers_a_locale_puts_in_a_category_a_selection_lacks() {
        let options = Options::default().locale("cs");
        let found = lint_message("{{n:plural; one:a; other:b;}}", &options, &Cldr);

        assert_eq!(
            found.iter().map(|found| found.code).collect::<Vec<_>>(),
            [Code::MissingCategory, Code::MissingCategory]
        );
        assert_eq!(
            found[0].message,
            "`cs` puts 0.5, 1.5 and 2.5 in `many`, and this selection has no `many` option, so those take the fallback chain."
        );
        assert_eq!(
            found[1].message,
            "`cs` puts 2, 3 and 4 in `few`, and this selection has no `few` option, so those take the fallback chain."
        );
    }
}
