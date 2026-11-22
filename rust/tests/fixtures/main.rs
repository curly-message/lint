//! Runs the fixture set at the repository's root, which every implementation
//! of the linter runs: each case through the crate, with the plural rules
//! the case names in place of a host's.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::string_slice,
    clippy::arithmetic_side_effects
)]

mod schema;

use std::fs;
use std::path::{Path, PathBuf};

use curly_message_lint::{
    Category, EntriesOptions, Entry, Finding, Options, RULES, RuleType, Table, lint_entries,
    lint_message, read_catalogue, read_findings,
};
use libtest_mimic::{Arguments, Failed, Trial};
use serde_json::{Value, json};

use crate::schema::Schema;

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../fixtures")
}

fn read(path: &Path) -> Value {
    serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap()
}

struct File {
    name: String,
    kind: String,
    file: Value,
}

fn files() -> Vec<File> {
    let mut files = Vec::new();
    let mut kinds: Vec<_> = fs::read_dir(root())
        .unwrap()
        .map(|entry| entry.unwrap())
        .filter(|entry| entry.file_type().unwrap().is_dir())
        .map(|entry| entry.file_name().into_string().unwrap())
        .collect();

    kinds.sort();

    for kind in kinds {
        let mut names: Vec<_> = fs::read_dir(root().join(&kind))
            .unwrap()
            .map(|entry| entry.unwrap().file_name().into_string().unwrap())
            .filter(|name| name.ends_with(".json"))
            .collect();

        names.sort();

        for name in names {
            files.push(File {
                file: read(&root().join(&kind).join(&name)),
                name: format!("{kind}/{name}"),
                kind: kind.clone(),
            });
        }
    }

    files
}

fn cases(file: &Value) -> &[Value] {
    file["cases"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
}

fn codes() -> Vec<String> {
    strings(&read(&root().join("schema.json"))["$defs"]["code"]["enum"])
}

fn strings(value: &Value) -> Vec<String> {
    value
        .as_array()
        .into_iter()
        .flatten()
        .map(|item| item.as_str().unwrap().to_owned())
        .collect()
}

// The fixtures count UTF-16 code units, and the crate bytes.
fn units(text: &str, offset: usize) -> usize {
    text[..offset].encode_utf16().count()
}

// A finding as a fixture states one.
fn stated(found: &Finding, text: &str, entry: Option<usize>) -> Value {
    let mut stated = json!({
        "code": found.code.as_str(),
        "severity": found.severity.as_str(),
        "message": found.message,
        "start": units(text, found.start),
        "end": units(text, found.end),
    });

    if let Some(section) = found.section {
        stated["section"] = json!(section);
    }

    if let Some(entry) = entry {
        stated["entry"] = json!(entry);
    }

    stated
}

// The host the case names: the rules of each locale and type it lists, and
// none for any other.
fn host(table: Option<&Value>) -> Table {
    let mut host = Table::new();

    for (tag, types) in table.and_then(Value::as_object).into_iter().flatten() {
        for (kind, rules) in types.as_object().unwrap() {
            let kind = if kind == "cardinal" {
                RuleType::Cardinal
            } else {
                RuleType::Ordinal
            };
            let categories: Vec<Category> = strings(&rules["categories"])
                .iter()
                .map(|category| Category::of(category).unwrap())
                .collect();
            let select: Vec<(Category, Vec<f64>)> = rules["select"]
                .as_object()
                .unwrap()
                .iter()
                .map(|(category, numbers)| {
                    (
                        Category::of(category).unwrap(),
                        numbers
                            .as_array()
                            .unwrap()
                            .iter()
                            .map(|number| number.as_f64().unwrap())
                            .collect(),
                    )
                })
                .collect();
            let select: Vec<(Category, &[f64])> = select
                .iter()
                .map(|(category, numbers)| (*category, numbers.as_slice()))
                .collect();

            host.insert(tag, kind, &categories, &select);
        }
    }

    host
}

fn same(found: &Value, expected: &Value, what: &str) -> Result<(), Failed> {
    if found == expected {
        return Ok(());
    }

    Err(format!(
        "{what}\n   found: {}\nexpected: {}",
        serde_json::to_string_pretty(found).unwrap(),
        serde_json::to_string_pretty(expected).unwrap()
    )
    .into())
}

fn message_case(case: &Value) -> Result<(), Failed> {
    let message = case["message"].as_str().unwrap();
    let options = &case["options"];
    let modifiers = strings(&options["modifiers"]);
    let mut given = Options::default()
        .modifiers(&modifiers)
        .intl(options["intl"].as_bool().unwrap_or(true));

    given.locale = options["locale"].as_str();

    let found = lint_message(message, &given, &host(case.get("plurals")));

    same(
        &found
            .iter()
            .map(|found| stated(found, message, None))
            .collect(),
        &case["findings"],
        "the findings",
    )
}

fn entries_case(case: &Value) -> Result<(), Failed> {
    let entries: Vec<Entry> = case["entries"]
        .as_array()
        .unwrap()
        .iter()
        .map(|entry| Entry {
            locale: entry["locale"].as_str().unwrap().to_owned(),
            id: entry["id"].as_str().unwrap().to_owned(),
            message: entry["message"].as_str().unwrap().to_owned(),
        })
        .collect();
    let options = &case["options"];
    let (modifiers, locales) = (strings(&options["modifiers"]), strings(&options["locales"]));
    let mut given = EntriesOptions::default()
        .modifiers(&modifiers)
        .intl(options["intl"].as_bool().unwrap_or(true))
        .locales(&locales);

    given.source = options["source"].as_str();

    let found = lint_entries(&entries, &given, &host(case.get("plurals")));

    same(
        &found
            .iter()
            .map(|found| {
                stated(
                    &found.finding,
                    &entries[found.entry].message,
                    Some(found.entry),
                )
            })
            .collect(),
        &case["findings"],
        "the findings",
    )
}

fn read_case(case: &Value) -> Result<(), Failed> {
    let text = case["text"].as_str().unwrap();
    let result = read_catalogue(text);
    let located = result
        .as_ref()
        .map(|read| read.strings.as_slice())
        .unwrap_or_default();
    let found: Value = located
        .iter()
        .map(|string| {
            json!({
                "path": string.path,
                "value": string.value,
                "start": units(text, string.start),
                "end": units(text, string.end),
            })
        })
        .collect();
    let expected: Value = case["strings"]
        .as_array()
        .unwrap()
        .iter()
        .map(|string| {
            json!({
                "path": string["path"],
                "value": string["value"],
                "start": string["start"],
                "end": string["end"],
            })
        })
        .collect();

    same(&found, &expected, "the strings")?;

    for (string, expected) in located.iter().zip(case["strings"].as_array().unwrap()) {
        let Some(offsets) = expected.get("offsets") else {
            continue;
        };
        let mut found = Vec::new();

        // Each code unit of the value, by the byte its character starts at;
        // the second unit of a pair is written past the first, which an
        // escape spells in six units and the character itself in one.
        for (index, char) in string.value.char_indices() {
            let at = string.offset_of(index);

            found.push(units(text, at));

            if char.len_utf16() == 2 {
                found.push(units(text, at) + if text[at..].starts_with('\\') { 6 } else { 1 });
            }
        }

        found.push(units(text, string.offset_of(string.value.len())));
        same(&json!(found), offsets, "the offsets")?;
    }

    same(
        &read_findings(&result)
            .iter()
            .map(|found| stated(found, text, None))
            .collect(),
        &case["findings"],
        "the findings",
    )
}

fn check(name: &str, check: impl FnOnce() -> Result<(), String> + Send + 'static) -> Trial {
    Trial::test(format!("the fixture set: {name}"), move || {
        check().map_err(Failed::from)
    })
}

fn none(broken: Vec<String>) -> Result<(), String> {
    if broken.is_empty() {
        Ok(())
    } else {
        Err(broken.join("\n"))
    }
}

fn set() -> Vec<Trial> {
    vec![
        check(
            "holds a file of each kind, each in the directory of its kind",
            || {
                let files = files();
                let mut kinds: Vec<&str> = files.iter().map(|file| file.kind.as_str()).collect();

                kinds.dedup();

                if kinds != ["entries", "message", "read"] {
                    return Err(format!("the kinds are {kinds:?}"));
                }

                none(
                    files
                        .iter()
                        .filter(|file| file.file["kind"] != json!(file.kind))
                        .map(|file| file.name.clone())
                        .collect(),
                )
            },
        ),
        check("lists the codes in the order of `RULES`", || {
            let rules: Vec<&str> = RULES.iter().map(|rule| rule.code.as_str()).collect();

            if codes() == rules {
                Ok(())
            } else {
                Err(format!("{:?} against {rules:?}", codes()))
            }
        }),
        check("validates against its schema", || {
            let schema = read(&root().join("schema.json"));
            let mut errors = Vec::new();

            for file in files() {
                Schema(&schema).check(&schema, &file.file, &file.name, &mut errors)?;
            }

            none(errors)
        }),
        check(
            "has a schema that turns down what it does not describe",
            || {
                let schema = read(&root().join("schema.json"));
                let file =
                    |case: Value| json!({ "kind": "message", "description": "x", "cases": [case] });
                let finding = json!({ "code": "bare-count", "severity": "error", "message": "x", "start": 0, "end": 0 });
                let broken = [
                    json!({ "kind": "message", "description": "x", "cases": [] }),
                    json!({ "kind": "other", "description": "x", "cases": [{ "name": "x", "message": "", "findings": [] }] }),
                    file(json!({ "name": "x", "findings": [] })),
                    file(json!({ "name": "", "message": "", "findings": [] })),
                    file(json!({ "name": "x", "message": "", "findings": [], "more": 1 })),
                    file(
                        json!({ "name": "x", "message": "", "findings": [{ "code": "none", "severity": "error", "message": "x", "start": 0, "end": 0 }] }),
                    ),
                    file(
                        json!({ "name": "x", "message": "", "findings": [{ "code": "bare-count", "severity": "error", "message": "x", "start": -1, "end": 0 }] }),
                    ),
                    file(
                        json!({ "name": "x", "message": "", "findings": [{ "code": "bare-count", "severity": "error", "message": "x", "start": 0, "end": 0, "entry": 0 }] }),
                    ),
                    file(
                        json!({ "name": "x", "message": "", "findings": [{ "code": "bare-count", "severity": "error", "message": "x", "start": 0, "end": 0, "section": "11.x" }] }),
                    ),
                    file(
                        json!({ "name": "x", "message": "", "findings": [], "plurals": { "EN": { "cardinal": { "categories": ["other"], "select": {} } } } }),
                    ),
                    file(
                        json!({ "name": "x", "message": "", "findings": [], "plurals": { "en": { "cardinal": { "categories": ["one"], "select": {} } } } }),
                    ),
                    file(
                        json!({ "name": "x", "message": "", "findings": [], "plurals": { "en": { "cardinal": { "categories": ["other"], "select": { "other": [1] } } } } }),
                    ),
                    file(
                        json!({ "name": "x", "message": "", "findings": [], "plurals": { "en": {} } }),
                    ),
                ];
                let mut taken = Vec::new();

                for (index, file) in broken.iter().enumerate() {
                    let mut errors = Vec::new();

                    Schema(&schema).check(&schema, file, "", &mut errors)?;

                    if errors.is_empty() {
                        taken.push(format!("the broken file {index} is taken"));
                    }
                }

                let mut errors = Vec::new();

                Schema(&schema).check(
                    &schema,
                    &file(json!({ "name": "x", "message": "", "findings": [finding] })),
                    "",
                    &mut errors,
                )?;
                taken.extend(errors);

                none(taken)
            },
        ),
        check("states each set of plural rules one way only", || {
            let mut broken = Vec::new();

            for file in files() {
                for case in cases(&file.file) {
                    for (tag, types) in case
                        .get("plurals")
                        .and_then(Value::as_object)
                        .into_iter()
                        .flatten()
                    {
                        for (kind, rules) in types.as_object().into_iter().flatten() {
                            let categories = strings(&rules["categories"]);
                            let select = rules["select"].as_object().unwrap();
                            let listed: Vec<&Value> = select
                                .values()
                                .flat_map(|numbers| numbers.as_array().unwrap())
                                .collect();
                            let twice = listed
                                .iter()
                                .enumerate()
                                .any(|(index, number)| listed[..index].contains(number));

                            if twice || select.keys().any(|category| !categories.contains(category))
                            {
                                broken
                                    .push(format!("{}, {}, {tag} {kind}", file.name, case["name"]));
                            }
                        }
                    }
                }
            }

            none(broken)
        }),
        check(
            "lists the findings of each case in the order every implementation answers them in",
            || {
                let codes = codes();
                let key = |finding: &Value| {
                    (
                        finding["entry"].as_u64().unwrap_or(0),
                        finding["start"].as_u64().unwrap(),
                        finding["end"].as_u64().unwrap(),
                        codes
                            .iter()
                            .position(|code| finding["code"] == json!(code))
                            .unwrap(),
                        finding["message"]
                            .as_str()
                            .unwrap()
                            .encode_utf16()
                            .collect::<Vec<u16>>(),
                    )
                };
                let mut broken = Vec::new();

                for file in files() {
                    for case in cases(&file.file) {
                        let keys: Vec<_> = case["findings"]
                            .as_array()
                            .unwrap()
                            .iter()
                            .map(key)
                            .collect();

                        if !keys.is_sorted() {
                            broken.push(format!("{}, {}", file.name, case["name"]));
                        }
                    }
                }

                none(broken)
            },
        ),
        check("names each case once within its file", || {
            let mut broken = Vec::new();

            for file in files() {
                let names: Vec<&Value> =
                    cases(&file.file).iter().map(|case| &case["name"]).collect();

                for (index, name) in names.iter().enumerate() {
                    if names[..index].contains(name) {
                        broken.push(format!("{}, {name}", file.name));
                    }
                }
            }

            none(broken)
        }),
    ]
}

fn main() {
    let mut trials = set();

    for file in files() {
        for case in cases(&file.file) {
            let (kind, case) = (file.kind.clone(), case.clone());
            let name = format!(
                "{}: {}",
                file.name,
                case["name"].as_str().unwrap_or_default()
            );

            trials.push(Trial::test(name, move || match kind.as_str() {
                "message" if case.get("message").is_some() => message_case(&case),
                "entries" if case.get("entries").is_some() => entries_case(&case),
                "read" if case.get("text").is_some() => read_case(&case),
                _ => Err(format!("A case of a {kind} file reads as another kind.").into()),
            }));
        }
    }

    libtest_mimic::run(&Arguments::from_args(), trials).exit();
}
