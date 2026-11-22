//! Measures the rows of the benchmark that `bench/rows.mjs` lists, so that the
//! family's harness, which runs on Node, measures the linter's release build:
//!
//! ```text
//! curly-message-lint-bench list          one JSON object per row: {"name": ..., "kind": ...}
//! curly-message-lint-bench count <row>   the row's count
//! curly-message-lint-bench serve <row>   sets the row up and writes a line; then, for
//!                                        each byte read, runs one batch of the row and
//!                                        writes a line, until its input closes
//! ```
//!
//! A time row runs a batch of a fixed number of iterations, the same on both
//! sides of a comparison and named in the row, so the round trip over the pipe
//! is a constant both sides pay and a small fraction of what is measured.
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::arithmetic_side_effects
)]

use std::cell::Cell;
use std::collections::BTreeMap;
use std::hint::black_box;
use std::io::{self, Read, Write};
use std::process::ExitCode;

use curly_message_lint::command::{Fault, Host, Kind, Named, run as command};
use curly_message_lint::{
    Cldr, EntriesOptions, Entry, Options, Plurals, lint_entries, lint_message, read_catalogue,
};

// Messages as a catalogue holds them, each in English and in Czech, whose
// plural rules take four categories.
const MESSAGES: [[&str; 2]; 5] = [
    ["Hello, {{name}}!", "Ahoj, {{name}}!"],
    [
        "{{name}} has {{count:number}} new {{count:plural; one:message; other:messages}}.",
        "{{name}} m\u{e1} {{count:number}} {{count:plural; one:novou zpr\u{e1}vu; few:nov\u{e9} zpr\u{e1}vy; many:nov\u{e9} zpr\u{e1}vy; other:nov\u{fd}ch zpr\u{e1}v}}.",
    ],
    [
        "{{gender; male:He; female:She; default:They}} replied to {{thread}}.",
        "{{gender; male:Odpov\u{11b}d\u{11b}l; female:Odpov\u{11b}d\u{11b}la; default:Odpov\u{11b}d\u{11b}li}} na {{thread}}.",
    ],
    [
        "{{count:plural; one:{{count}} file; other:{{count}} files}} in {{folder; :the root; default:{{folder}}}}.",
        "{{count:plural; one:{{count}} soubor; few:{{count}} soubory; many:{{count}} souboru; other:{{count}} soubor\u{16f}}} v {{folder; :ko\u{159}eni; default:{{folder}}}}.",
    ],
    [
        "Total: {{amount:number}}, due {{due:date}}.",
        "Celkem: {{amount:number}}, splatn\u{e9} {{due:date}}.",
    ],
];

const LOCALES: [&str; 2] = ["en", "cs"];

// `count` messages in each of two locales, a hundred to a namespace.
fn entries(count: usize) -> Vec<Entry> {
    LOCALES
        .iter()
        .enumerate()
        .flat_map(|(side, locale)| {
            (0..count).map(move |index| Entry {
                locale: (*locale).to_owned(),
                id: format!("ns{}.m{index}", index / 100),
                message: MESSAGES[index % MESSAGES.len()][side].to_owned(),
            })
        })
        .collect()
}

// `count` messages under each of two spellings of one locale, no id under
// both.
fn spelled(count: usize) -> Vec<Entry> {
    ["en", "EN"]
        .iter()
        .enumerate()
        .flat_map(|(side, locale)| {
            (0..count).map(move |index| Entry {
                locale: (*locale).to_owned(),
                id: format!("ns{}.m{}", index / 100, side * count + index),
                message: MESSAGES[index % MESSAGES.len()][0].to_owned(),
            })
        })
        .collect()
}

// The text of a catalogue file of `count` messages, a hundred to a namespace.
fn file(count: usize) -> String {
    let namespaces: Vec<String> = (0..count.div_ceil(100))
        .map(|namespace| {
            let members: Vec<String> = (namespace * 100..count.min((namespace + 1) * 100))
                .map(|index| format!("\"m{index}\": \"{}\"", MESSAGES[index % MESSAGES.len()][0]))
                .collect();

            format!(
                "\"ns{namespace}\": {{\n    {}\n  }}",
                members.join(",\n    ")
            )
        })
        .collect();

    format!("{{\n  {}\n}}\n", namespaces.join(",\n  "))
}

fn linting(message: String) -> Box<dyn FnMut()> {
    Box::new(move || {
        black_box(lint_message(&message, &Options::default(), &Cldr));
    })
}

/// Files held in memory under `/work`, the working directory, which count
/// what the command asks of them.
struct Counted {
    files: BTreeMap<String, &'static str>,
    calls: Cell<usize>,
}

fn missing() -> Fault {
    Fault::missing("no such file or directory")
}

impl Counted {
    // Three locales of three namespaces of three files, a hidden directory in
    // each locale, and a directory beside them that is no locale.
    fn tree() -> Self {
        let mut files = BTreeMap::new();

        for locale in ["en", "cs", "de"] {
            for namespace in ["a", "b", "c"] {
                for name in ["x", "y", "z"] {
                    files.insert(
                        format!("/work/locales/{locale}/{namespace}/{name}.json"),
                        "{\"hi\": \"Hi\"}",
                    );
                }
            }

            files.insert(
                format!("/work/locales/{locale}/.git/x.json"),
                "{\"hi\": \"Hi\"}",
            );
        }

        files.insert(
            "/work/locales/tools/a/x.json".to_owned(),
            "{\"hi\": \"Hi\"}",
        );

        Self {
            files,
            calls: Cell::new(0),
        }
    }

    fn called(&self) {
        self.calls.set(self.calls.get() + 1);
    }

    fn kind(&self, path: &str) -> Result<Kind, Fault> {
        if self.files.contains_key(path) {
            Ok(Kind::File)
        } else if path == "/"
            || self
                .files
                .keys()
                .any(|at| at.starts_with(&format!("{path}/")))
        {
            Ok(Kind::Directory)
        } else {
            Err(missing())
        }
    }

    fn count(argv: &[&str]) -> f64 {
        let mut host = Self::tree();
        let argv: Vec<String> = argv.iter().map(|argument| (*argument).to_owned()).collect();
        let status = command(&argv, &mut host);

        // Messages under one id in a locale are errors the tree holds; a path
        // that cannot be read would exit 2.
        assert!(status < 2, "the command exited {status}");
        assert!(host.calls.get() > 0, "the command counted no call");

        host.calls.get() as f64
    }
}

impl Host for Counted {
    fn separator(&self) -> char {
        '/'
    }

    fn resolve(&self, path: &str) -> String {
        let mut names: Vec<&str> = Vec::new();
        let from = if path.starts_with('/') { "" } else { "/work" };

        for name in from.split('/').chain(path.split('/')) {
            match name {
                "" | "." => {}
                ".." => {
                    names.pop();
                }
                name => names.push(name),
            }
        }

        format!("/{}", names.join("/"))
    }

    fn relative(&self, path: &str) -> String {
        match path.strip_prefix("/work/") {
            Some(under) => under.to_owned(),
            None => path.to_owned(),
        }
    }

    fn stat(&self, path: &str) -> Result<Kind, Fault> {
        self.called();
        self.kind(path)
    }

    fn lstat(&self, path: &str) -> Result<Kind, Fault> {
        self.called();
        self.kind(path)
    }

    fn realpath(&self, path: &str) -> Result<String, Fault> {
        self.called();
        self.kind(path).map(|_| path.to_owned())
    }

    fn read_dir(&self, path: &str) -> Result<Vec<Named>, Fault> {
        self.called();

        let under = format!("{}/", path.trim_end_matches('/'));
        let mut names: Vec<Named> = Vec::new();

        for at in self.files.keys() {
            if let Some(rest) = at.strip_prefix(&under) {
                let (name, kind) = match rest.split_once('/') {
                    Some((name, _)) => (name, Kind::Directory),
                    None => (rest, Kind::File),
                };

                if names.last().is_none_or(|last| last.name != name) {
                    names.push(Named::new(name, kind));
                }
            }
        }

        if names.is_empty() {
            self.kind(path)?;
        }

        Ok(names)
    }

    fn read(&self, path: &str) -> Result<String, Fault> {
        self.called();
        self.files
            .get(path)
            .map(|text| (*text).to_owned())
            .ok_or_else(missing)
    }

    fn plurals(&self) -> &dyn Plurals {
        &Cldr
    }

    fn out(&mut self, _: &str) {}

    fn err(&mut self, _: &str) {}
}

enum Measure {
    Count(fn() -> f64),
    Time {
        batch: usize,
        setup: fn() -> Box<dyn FnMut()>,
    },
}

struct Row {
    name: &'static str,
    measure: Measure,
}

impl Row {
    // A time row names its batch, which is what one sample of it runs.
    fn title(&self) -> String {
        match self.measure {
            Measure::Count(_) => self.name.to_owned(),
            Measure::Time { batch: 1, .. } => self.name.to_owned(),
            Measure::Time { batch, .. } => format!("{}, {batch} times", self.name),
        }
    }

    fn kind(&self) -> &'static str {
        match self.measure {
            Measure::Count(_) => "count",
            Measure::Time { .. } => "time",
        }
    }
}

const ROWS: &[Row] = &[
    Row {
        name: "command: host calls, a pattern over three locales of three namespaces of three files",
        measure: Measure::Count(|| Counted::count(&["locales/{locale}/{namespace}.json"])),
    },
    Row {
        name: "command: host calls, a directory given as it is, over the same tree",
        measure: Measure::Count(|| Counted::count(&["--locale", "en", "."])),
    },
    Row {
        name: "lint_message: five catalogue messages, with their locale",
        measure: Measure::Time {
            batch: 1_000,
            setup: || {
                Box::new(|| {
                    let options = Options::default().locale("cs");

                    for [_, message] in MESSAGES {
                        black_box(lint_message(message, &options, &Cldr));
                    }
                })
            },
        },
    },
    Row {
        name: "lint_message: 20 000 unclosed placeholders",
        measure: Measure::Time {
            batch: 1,
            setup: || linting("{{\n".repeat(20_000)),
        },
    },
    Row {
        name: "lint_message: a selection of 20 000 options",
        measure: Measure::Time {
            batch: 1,
            setup: || {
                let options: Vec<String> = (0..20_000).map(|index| format!("k{index}:x")).collect();

                linting(format!("{{{{v; {}}}}}", options.join("; ")))
            },
        },
    },
    Row {
        name: "lint_message: nested 250 levels",
        measure: Measure::Time {
            batch: 10,
            setup: || linting(format!("{}x{}", "{{v; a:".repeat(250), "}}".repeat(250))),
        },
    },
    Row {
        name: "lint_entries: 1 000 messages in two locales",
        measure: Measure::Time {
            batch: 1,
            setup: || {
                let entries = entries(1_000);

                Box::new(move || {
                    black_box(lint_entries(&entries, &EntriesOptions::default(), &Cldr));
                })
            },
        },
    },
    Row {
        name: "lint_entries: 5 000 messages under each of two spellings of one locale",
        measure: Measure::Time {
            batch: 1,
            setup: || {
                let entries = spelled(5_000);

                Box::new(move || {
                    black_box(lint_entries(&entries, &EntriesOptions::default(), &Cldr));
                })
            },
        },
    },
    Row {
        name: "read_catalogue: a file of 1 000 messages",
        measure: Measure::Time {
            batch: 10,
            setup: || {
                let text = file(1_000);

                Box::new(move || {
                    black_box(read_catalogue(&text).is_ok());
                })
            },
        },
    },
];

fn serve(batch: usize, setup: fn() -> Box<dyn FnMut()>) -> io::Result<()> {
    let mut op = setup();
    let mut input = io::stdin().lock();
    let mut output = io::stdout().lock();
    let mut byte = [0u8];

    output.write_all(b"\n")?;
    output.flush()?;

    while input.read(&mut byte)? == 1 {
        for _ in 0..batch {
            op();
        }

        output.write_all(b"\n")?;
        output.flush()?;
    }

    Ok(())
}

fn run(args: &[String]) -> Result<(), String> {
    let mut output = io::stdout().lock();

    match args {
        [command] if command == "list" => {
            for row in ROWS {
                // Row names hold no character JSON escapes.
                writeln!(
                    output,
                    "{{\"name\":\"{}\",\"kind\":\"{}\"}}",
                    row.title(),
                    row.kind()
                )
                .map_err(|error| error.to_string())?;
            }

            Ok(())
        }
        [command, name] if command == "count" || command == "serve" => {
            let row = ROWS
                .iter()
                .find(|row| row.title() == *name)
                .ok_or_else(|| format!("no row is named {name:?}"))?;

            match (command.as_str(), &row.measure) {
                ("count", Measure::Count(count)) => {
                    writeln!(output, "{}", count()).map_err(|error| error.to_string())
                }
                ("serve", Measure::Time { batch, setup }) => {
                    drop(output);
                    serve(*batch, *setup).map_err(|error| error.to_string())
                }
                _ => Err(format!("the row {name:?} is no {command} row")),
            }
        }
        _ => Err("usage: curly-message-lint-bench list | count <row> | serve <row>".to_owned()),
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().skip(1).collect();

    match run(&args) {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            let _ = writeln!(io::stderr(), "curly-message-lint-bench: {error}");
            ExitCode::FAILURE
        }
    }
}
