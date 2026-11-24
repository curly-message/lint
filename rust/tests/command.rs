//! The command over files held in memory, which a test can refuse to read
//! and link as it likes on every system.

#![cfg(feature = "cldr")]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::string_slice,
    clippy::arithmetic_side_effects
)]

use std::cell::Cell;
use std::collections::{BTreeMap, BTreeSet};

use curly_message_lint::command::{Fault, Host, Kind, Named, USAGE, run};
use curly_message_lint::{Cldr, Plurals};

#[derive(Clone)]
enum Node {
    File(Vec<u8>),
    Directory,
    Link(String),
}

#[derive(Default)]
struct Calls {
    read_dir: Cell<usize>,
    realpath: Cell<usize>,
    stat: Cell<usize>,
}

/// Files under `/work`, the working directory.
struct Memory {
    cwd: String,
    nodes: BTreeMap<String, Node>,
    /// The ends of the paths that cannot be listed or opened, and of those
    /// that cannot be reached.
    refused: BTreeSet<&'static str>,
    unreachable: BTreeSet<&'static str>,
    calls: Calls,
    out: String,
    err: String,
}

const DENIED: &str = "permission denied";

fn missing() -> Fault {
    Fault::missing("no such file or directory")
}

fn denied() -> Fault {
    Fault::new(DENIED)
}

fn normal(path: &str) -> String {
    let mut names: Vec<&str> = Vec::new();

    for name in path.split('/') {
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

impl Memory {
    fn new(files: &[(&str, &str)]) -> Self {
        let mut memory = Self {
            cwd: "/work".to_owned(),
            nodes: BTreeMap::from([
                ("/".to_owned(), Node::Directory),
                ("/work".to_owned(), Node::Directory),
            ]),
            refused: BTreeSet::new(),
            unreachable: BTreeSet::new(),
            calls: Calls::default(),
            out: String::new(),
            err: String::new(),
        };

        memory.files(files);
        memory
    }

    fn put(&mut self, path: &str, node: Node) {
        let path = normal(&format!("/work/{path}"));
        let mut holder = String::new();

        for name in path.split('/').skip(1) {
            if !holder.is_empty() {
                self.nodes.entry(holder.clone()).or_insert(Node::Directory);
            }

            holder = format!("{holder}/{name}");
        }

        self.nodes.insert(path, node);
    }

    fn files(&mut self, files: &[(&str, &str)]) {
        for (path, text) in files {
            self.put(path, Node::File(text.as_bytes().to_vec()));
        }
    }

    fn link(&mut self, target: &str, path: &str) {
        self.put(path, Node::Link(normal(&format!("/work/{target}"))));
    }

    fn is(ends: &BTreeSet<&'static str>, path: &str) -> bool {
        ends.iter().any(|end| path.ends_with(&format!("/{end}")))
    }

    // Where a path stands, its last name followed or not.
    fn real(&self, path: &str, last: bool) -> Result<String, Fault> {
        let mut pending: Vec<String> = normal(path)
            .rsplit('/')
            .filter(|name| !name.is_empty())
            .map(str::to_owned)
            .collect();
        let mut at = String::new();
        let mut followed = 0;

        while let Some(name) = pending.pop() {
            if name.is_empty() {
                continue;
            }

            let next = format!("{at}/{name}");

            match self.nodes.get(&next) {
                None => return Err(missing()),
                Some(Node::Link(target)) if last || !pending.is_empty() => {
                    followed += 1;

                    if followed > 40 {
                        return Err(missing());
                    }

                    pending.extend(
                        target
                            .rsplit('/')
                            .filter(|name| !name.is_empty())
                            .map(str::to_owned),
                    );
                    at.clear();
                }
                Some(Node::File(_)) if !pending.is_empty() => return Err(missing()),
                Some(_) => at = next,
            }
        }

        Ok(if at.is_empty() { "/".to_owned() } else { at })
    }

    fn kind(&self, real: &str) -> Kind {
        match self.nodes.get(real) {
            Some(Node::File(_)) => Kind::File,
            Some(Node::Link(_)) => Kind::Link,
            _ => Kind::Directory,
        }
    }

    fn run(&mut self, argv: &[&str]) -> (i32, String, String) {
        let argv: Vec<String> = argv.iter().map(|argument| (*argument).to_owned()).collect();

        self.out.clear();
        self.err.clear();
        self.calls = Calls::default();

        (run(&argv, self), self.out.clone(), self.err.clone())
    }
}

impl Host for Memory {
    fn separator(&self) -> char {
        '/'
    }

    fn resolve(&self, path: &str) -> String {
        normal(&if path.starts_with('/') {
            path.to_owned()
        } else {
            format!("{}/{path}", self.cwd)
        })
    }

    fn relative(&self, path: &str) -> String {
        let (from, to): (Vec<&str>, Vec<&str>) = (
            self.cwd
                .split('/')
                .filter(|name| !name.is_empty())
                .collect(),
            path.split('/').filter(|name| !name.is_empty()).collect(),
        );
        let shared = from.iter().zip(&to).take_while(|(a, b)| a == b).count();

        from[shared..]
            .iter()
            .map(|_| "..")
            .chain(to[shared..].iter().copied())
            .collect::<Vec<_>>()
            .join("/")
    }

    fn stat(&self, path: &str) -> Result<Kind, Fault> {
        self.calls.stat.set(self.calls.stat.get() + 1);

        if Self::is(&self.unreachable, path) {
            return Err(denied());
        }

        self.real(path, true).map(|real| self.kind(&real))
    }

    fn lstat(&self, path: &str) -> Result<Kind, Fault> {
        self.real(path, false).map(|real| self.kind(&real))
    }

    fn realpath(&self, path: &str) -> Result<String, Fault> {
        self.calls.realpath.set(self.calls.realpath.get() + 1);
        self.real(path, true)
    }

    fn read_dir(&self, path: &str) -> Result<Vec<Named>, Fault> {
        self.calls.read_dir.set(self.calls.read_dir.get() + 1);

        if Self::is(&self.refused, path) {
            return Err(denied());
        }

        let real = self.real(path, true)?;
        let under = if real == "/" {
            real
        } else {
            format!("{real}/")
        };

        // Listed backwards, as no order is promised.
        Ok(self
            .nodes
            .keys()
            .rev()
            .filter_map(|at| {
                at.strip_prefix(&under)
                    .filter(|name| !name.is_empty() && !name.contains('/'))
            })
            .map(|name| Named::new(name, self.kind(&format!("{under}{name}"))))
            .collect())
    }

    fn read(&self, path: &str) -> Result<String, Fault> {
        if Self::is(&self.refused, path) {
            return Err(denied());
        }

        match self.nodes.get(&self.real(path, true)?) {
            Some(Node::File(bytes)) => Ok(String::from_utf8_lossy(bytes).into_owned()),
            _ => Err(denied()),
        }
    }

    fn plurals(&self) -> &dyn Plurals {
        &Cldr
    }

    fn out(&mut self, text: &str) {
        self.out.push_str(text);
    }

    fn err(&mut self, text: &str) {
        self.err.push_str(text);
    }
}

const PATTERN: &str = "locales/{locale}/{namespace}.json";
const UNCOMPARED: &str = "What a directory that cannot be read holds is unknown, so no locale is compared with another.\n";
const UNPLACED: &str = " no locale, so their messages are linted without one, and compared with no other locale's. Name it in a pattern, as in curly-lint \"locales/{locale}/{namespace}.json\".\n";
const UNCLOSED: &str = "error  `{{` opens no placeholder: nothing closes it on its line, so it renders as text.  unclosed-placeholder";

fn paths(out: &str) -> Vec<&str> {
    out.lines()
        .filter(|line| line.contains("  "))
        .map(|line| line.split(':').next().unwrap())
        .collect()
}

fn codes(out: &str) -> Vec<&str> {
    out.lines()
        .filter_map(|line| line.rsplit_once("  ").map(|(_, code)| code))
        .collect()
}

#[test]
fn reports_where_each_problem_stands_and_exits_1_on_an_error() {
    let mut host = Memory::new(&[
        (
            "locales/en/common.json",
            "{\n  \"hi\": \"Hello, {{name}}!\",\n  \"files\": \"{{n:plural; one:file; other:files;}}\"\n}\n",
        ),
        (
            "locales/cs/common.json",
            "{\n  \"hi\": \"Ahoj, {{name}\",\n  \"files\": \"{{n:plural; one:soubor; few:soubory; other:soubor\\u016f;}}\"\n}\n",
        ),
    ]);
    let (code, out, err) = host.run(&[PATTERN]);

    assert_eq!((code, err.as_str()), (1, ""));
    assert_eq!(
        out.split('\n').collect::<Vec<_>>(),
        [
            "locales/cs/common.json:2:9  error  This message never reads `name`, which the `en` message reads.  parameter-mismatch",
            "locales/cs/common.json:2:16  error  `{{` opens no placeholder: nothing closes it on its line, so it renders as text.  unclosed-placeholder",
            "locales/cs/common.json:3:17  error  `cs` puts 0.5, 1.5 and 2.5 in `many`, and this selection has no `many` option, so those take the fallback chain.  missing-category",
            "",
            "3 problems (3 errors, 0 warnings)",
            "",
        ]
    );
}

#[test]
fn lists_the_files_in_the_order_they_are_read_in() {
    let mut host = Memory::new(&[
        ("a/x.json", r#"{"a": "{{"}"#),
        ("B/x.json", r#"{"b": "{{"}"#),
        ("a-b/x.json", r#"{"c": "{{"}"#),
        ("a_b/x.json", r#"{"d": "{{"}"#),
        // Past the Basic Multilingual Plane, which sorts before U+FB01 by
        // code units and after it by code points.
        ("\u{1f600}/x.json", r#"{"e": "{{"}"#),
        ("\u{fb01}/x.json", r#"{"f": "{{"}"#),
    ]);

    assert_eq!(
        paths(&host.run(&["."]).1),
        [
            "B/x.json",
            "a/x.json",
            "a-b/x.json",
            "a_b/x.json",
            "\u{1f600}/x.json",
            "\u{fb01}/x.json"
        ]
    );
    assert_eq!(
        paths(&host.run(&["a_b", "B"]).1),
        ["a_b/x.json", "B/x.json"]
    );

    // Listed where it is read, not by the path it is shown at.
    host.files(&[("q/x.json", r#"{"e": "{{"}"#), ("x.json", r#"{"f": "{{"}"#)]);
    host.cwd = "/work/q".to_owned();
    assert_eq!(
        paths(&host.run(&[".."]).1),
        [
            "../B/x.json",
            "../a/x.json",
            "../a-b/x.json",
            "../a_b/x.json",
            "x.json",
            "../x.json",
            "../\u{1f600}/x.json",
            "../\u{fb01}/x.json"
        ]
    );
}

#[test]
fn reads_no_locale_off_a_path_no_pattern_places_one_in() {
    let mut host = Memory::new(&[
        (
            "packages/be/messages.json",
            r#"{"items": "{{n:plural; one:item; other:items;}}"}"#,
        ),
        (
            "messages/nds/strings.json",
            r#"{"items": "{{n:plural; one:item; other:items;}}"}"#,
        ),
    ]);

    assert_eq!(
        host.run(&["packages", "messages"]),
        (0, String::new(), format!("2 files have{UNPLACED}"))
    );
}

#[test]
fn reads_the_namespace_and_the_locale_where_a_pattern_places_them() {
    let mut host = Memory::new(&[
        ("locales/admin/en.json", r#"{"title": "Users"}"#),
        (
            "locales/admin/cs.json",
            r#"{"title": "U\u017eivatel\u00e9"}"#,
        ),
        ("locales/shop/en.json", r#"{"title": "Cart", "buy": "Buy"}"#),
        ("locales/shop/cs.json", r#"{"title": "Ko\u0161\u00edk"}"#),
        ("i18n/shop.en.json", r#"{"cart": "Cart"}"#),
        ("i18n/shop.pt_BR.json", "{}"),
        ("i18n/en.json", r#"{"x": "{{"}"#),
        (
            "l10n/en.app/admin/users.json",
            r#"{"hi": "Hi", "bye": "Bye"}"#,
        ),
        ("l10n/pt-BR.app/admin/users.json", r#"{"hi": "Oi"}"#),
        ("prefixed/ns-admin/users.json", r#"{"x": "{{"}"#),
    ]);

    host.link("l10n/pt-BR.app", "l10n/pt.app");

    assert_eq!(
        host.run(&["locales/{namespace}/{locale}.json"]),
        (0, "locales/shop/en.json:1:26  warning  `cs` has no message `shop.buy`.  missing-message\n\n1 problem (0 errors, 1 warning)\n".to_owned(), String::new())
    );
    assert_eq!(
        host.run(&["i18n/{namespace}.{locale}.json"]).1,
        "i18n/shop.en.json:1:10  warning  `pt-BR` has no message `shop.cart`.  missing-message\n\n1 problem (0 errors, 1 warning)\n"
    );
    assert_eq!(
        host.run(&["l10n/{locale}.{namespace}.json"]).1,
        "l10n/en.app/admin/users.json:1:21  warning  `pt-BR` has no message `app.admin.users.bye`.  missing-message\nl10n/en.app/admin/users.json:1:21  warning  `pt` has no message `app.admin.users.bye`.  missing-message\n\n2 problems (0 errors, 2 warnings)\n"
    );

    let (_, out, _) = host.run(&[
        "prefixed/ns-{namespace}.json",
        "--locale",
        "en",
        "--format",
        "json",
    ]);

    assert!(
        out.contains("\"file\": \"prefixed/ns-admin/users.json\""),
        "{out}"
    );
    assert!(
        out.contains("\"locale\": \"en\",\n    \"id\": \"admin.users.x\""),
        "{out}"
    );
}

#[test]
fn reads_only_the_files_whose_paths_the_pattern_places_a_locale_in() {
    let mut host = Memory::new(&[
        ("locales/en.json", r#"{"a": "A"}"#),
        ("locales/messages.en.json", r#"{"a": "{{"}"#),
        ("locales/glossary.json", r#"{"a": "{{"}"#),
        ("locales/package.json", r#"{"a": "{{"}"#),
        ("locales/e.json", r#"{"a": "{{"}"#),
        ("locales/en/common.json", r#"{"a": "{{"}"#),
        (
            "app/messages.cs.json",
            r#"{"a": "{{n:plural; one:a; other:b;}}"}"#,
        ),
        ("app/messages.json", r#"{"a": "{{"}"#),
        ("app/other.cs.json", r#"{"a": "{{"}"#),
    ]);

    assert_eq!(
        host.run(&["locales/{locale}.json"]),
        (0, String::new(), String::new())
    );

    let (code, out, err) = host.run(&["app/messages.{locale}.json"]);

    assert_eq!((code, err.as_str()), (1, ""));
    assert_eq!(
        paths(&out),
        ["app/messages.cs.json", "app/messages.cs.json"]
    );
    assert_eq!(codes(&out), ["missing-category", "missing-category"]);
}

#[test]
fn reads_no_directory_deeper_than_a_pattern_without_a_namespace_reaches() {
    let mut host = Memory::new(&[
        ("locales/en.json", r#"{"a": "A"}"#),
        ("locales/cs.json", "{}"),
        ("locales/archive/2019/q1/en.json", r#"{"a": "{{"}"#),
    ]);

    // A link the pattern reads nothing through is not followed to learn
    // what it is.
    host.link("locales/archive", "locales/old");

    let (code, _, err) = host.run(&["locales/{locale}.json"]);
    let calls = |host: &Memory| {
        (
            host.calls.read_dir.get(),
            host.calls.realpath.get(),
            host.calls.stat.get(),
        )
    };

    assert_eq!((code, err.as_str(), calls(&host)), (0, "", (1, 1, 1)));

    let (code, out, _) = host.run(&["locales/{namespace}/{locale}.json"]);

    assert_eq!((code, calls(&host)), (1, (4, 2, 2)));
    assert!(out.contains("locales/archive/2019/q1/en.json"), "{out}");
}

#[test]
fn reads_a_pattern_written_with_either_separator_or_from_the_root() {
    let mut host = Memory::new(&[(
        "locales/cs.json",
        r#"{"a": "{{n:plural; one:a; other:b;}}"}"#,
    )]);

    for pattern in ["locales\\{locale}.json", "/work/locales/{locale}.json"] {
        let (code, out, err) = host.run(&[pattern]);

        assert_eq!((code, err.as_str()), (1, ""));
        assert!(
            out.contains("locales/cs.json:1:12  error  `cs` puts"),
            "{out}"
        );
    }
}

#[test]
fn refuses_a_pattern_it_cannot_read_and_one_no_file_matches() {
    let mut host = Memory::new(&[("ns-x.json", "{}")]);

    assert_eq!(
        host.run(&["locales/{lng}.json"]),
        (2, String::new(), "The pattern locales/{lng}.json holds a brace that opens neither {locale} nor {namespace}.\n".to_owned())
    );

    for (pattern, said) in [
        ("{locale}/{locale}.json", "holds {locale} twice"),
        (
            "{namespace}-{locale}.json",
            "with nothing a locale cannot hold",
        ),
        ("locales/{locale}", "names no .json file"),
        ("locales/{locale}/../x.json", "`..`"),
        ("locales/{locale}//x.json", "an empty name"),
    ] {
        let (code, out, err) = host.run(&[pattern]);

        assert_eq!((code, out.as_str()), (2, ""), "{pattern}");
        assert!(err.contains(said), "{pattern}: {err}");
    }

    // The text around a placeholder leaves it something to stand for, and a
    // namespace no empty name.
    assert_eq!(
        host.run(&["ns-{namespace}-x.json"]),
        (
            2,
            String::new(),
            "No .json file matches the pattern ns-{namespace}-x.json.\n".to_owned()
        )
    );
    host.files(&[("i18n/ns-/x.json", "{}")]);
    assert_eq!(
        host.run(&["i18n/ns-{namespace}.json"]),
        (
            2,
            String::new(),
            "No .json file matches the pattern i18n/ns-{namespace}.json.\n".to_owned()
        )
    );
}

#[test]
fn reads_a_file_as_the_pattern_that_reaches_it_does() {
    let mut host = Memory::new(&[
        (
            "locales/en.json",
            r#"{"a": "{{n:plural; one:a; other:b;}}", "b": "B"}"#,
        ),
        (
            "locales/cs.json",
            r#"{"a": "{{n:plural; one:a; other:b;}}"}"#,
        ),
    ]);

    for argv in [
        ["locales", "locales/{locale}.json"],
        ["locales/{locale}.json", "locales"],
    ] {
        let (code, out, err) = host.run(&[argv[0], argv[1], "--locale", "de"]);

        assert_eq!((code, err.as_str()), (1, ""));
        assert_eq!(
            codes(&out),
            ["missing-category", "missing-category", "missing-message"]
        );
        assert!(
            out.ends_with("\n\n3 problems (2 errors, 1 warning)\n"),
            "{out}"
        );
    }

    // A pattern that places no locale reads its files in the one --locale
    // gives, and a directory given as it is reads none of them.
    for argv in [
        ["locales", "locales/{namespace}.json"],
        ["locales/{namespace}.json", "locales"],
    ] {
        let (code, out, err) = host.run(&[argv[0], argv[1], "--locale", "cs", "--quiet"]);

        assert_eq!((code, err.as_str()), (1, ""));
        assert_eq!(
            paths(&out),
            [
                "locales/cs.json",
                "locales/cs.json",
                "locales/en.json",
                "locales/en.json"
            ]
        );
    }
}

#[test]
fn says_once_that_a_file_has_no_locale() {
    let mut host = Memory::new(&[("messages.json", r#"{"a": "A"}"#)]);

    assert_eq!(
        host.run(&["messages.json", "--quiet", "--source", "en"]),
        (
            2,
            String::new(),
            "1 file has no locale, so its messages are linted without one, and compared with no other locale's. Name it in a pattern, as in curly-lint \"locales/{locale}/{namespace}.json\".\nNo file given is written for the source locale `en`.\n".to_owned()
        )
    );
}

#[test]
fn exits_0_where_only_warnings_are_found_and_quiet_shows_errors_alone() {
    let mut host = Memory::new(&[("en.json", r#"{"a": "C:\\d"}"#)]);
    let (code, out, _) = host.run(&["en.json"]);

    assert_eq!(code, 0);
    assert!(out.contains("inert-escape"), "{out}");
    assert_eq!(host.run(&["en.json", "--quiet"]).0, 0);
    assert_eq!(host.run(&["en.json", "--quiet"]).1, "");
}

#[test]
fn writes_json_with_format_json() {
    let mut host = Memory::new(&[(
        "en.json",
        "{\"a\": \"{{v:zz}}\",\n \"b\\n\": \"\\u00e9\u{1f600}{{\"}",
    )]);
    let (code, out, _) = host.run(&["--format", "json", "{locale}.json"]);

    assert_eq!(code, 1);
    assert!(
        out.starts_with("[\n  {\n    \"file\": \"en.json\",\n    \"line\": 1,\n    \"column\": 12,\n    \"endLine\": 1,\n    \"endColumn\": 14,\n    \"severity\": \"error\",\n    \"code\": \"unknown-modifier\",\n    \"message\": \""),
        "{out}"
    );
    // A column counts UTF-16 code units, and an escape the six it is
    // written in.
    assert!(
        out.ends_with("\",\n    \"locale\": \"en\",\n    \"id\": \"b\\n\"\n  }\n]\n")
            && out.contains(
                "\"line\": 2,\n    \"column\": 18,\n    \"endLine\": 2,\n    \"endColumn\": 20,"
            ),
        "{out}"
    );
    assert_eq!(
        Memory::new(&[("en.json", "{}")])
            .run(&["--format", "json", "en.json"])
            .1,
        "[]\n"
    );
}

#[test]
fn writes_each_line_terminator_control_character_and_bidirectional_control_of_a_text_report_by_its_code_point()
 {
    let mut host = Memory::new(&[
        (
            "d\u{2028}\u{85}/en.json",
            "{\"a\\nb\\u001b[31m\": \"x\",\n\"s t\\u00a0\\u200b\\ud83d\\ude00\\u061c\\u200e\\u200f\\u202a\\u202e\\u2066\\u2069\": \"y\"}",
        ),
        ("d\u{2028}\u{85}/cs.json", "{}"),
        ("e\n\u{1b}[2K.json", r#"{"x": "{{"}"#),
    ]);

    // A space, a no-break space, a format character outside the bidirectional
    // controls and an astral character are shown as themselves.
    assert_eq!(
        host.run(&["d\u{2028}\u{85}/{locale}.json"]),
        (0, "dU+2028U+0085/en.json:1:20  warning  `cs` has no message `aU+000AbU+001B[31m`.  missing-message\ndU+2028U+0085/en.json:2:74  warning  `cs` has no message `s t\u{a0}\u{200b}\u{1f600}U+061CU+200EU+200FU+202AU+202EU+2066U+2069`.  missing-message\n\n2 problems (0 errors, 2 warnings)\n".to_owned(), String::new())
    );
    assert_eq!(
        host.run(&["e\n\u{1b}[2K.json"]).1,
        "eU+000AU+001B[2K.json:1:8  error  `{{` opens no placeholder: nothing closes it on its line, so it renders as text.  unclosed-placeholder\n\n1 problem (1 error, 0 warnings)\n"
    );

    // JSON escapes them as its format does.
    let (_, out, _) = host.run(&["d\u{2028}\u{85}/{locale}.json", "--format", "json"]);

    assert!(
        out.contains(
            "\"file\": \"d\u{2028}\u{85}/en.json\",\n    \"line\": 1,\n    \"column\": 20,"
        ) && out.contains("\"message\": \"`cs` has no message `a\\nb\\u001b[31m`.\",")
            && out.contains("\"id\": \"a\\nb\\u001b[31m\"\n")
            && out.contains("\"id\": \"s t\u{a0}\u{200b}\u{1f600}\u{61c}\u{200e}\u{200f}\u{202a}\u{202e}\u{2066}\u{2069}\"\n"),
        "{out}"
    );
}

#[test]
fn names_a_file_it_cannot_read_on_one_line_its_path_written_as_a_text_report_writes_it() {
    let mut host = Memory::new(&[
        ("d/en.json", r#"{"x": "{{"}"#),
        ("d/x\nforged finding  unknown-modifier\u{1b}[8m.json", "{}"),
    ]);

    host.refused
        .insert("x\nforged finding  unknown-modifier\u{1b}[8m.json");

    let (_, _, err) = host.run(&["d"]);

    assert!(
        err.starts_with("Cannot read d/xU+000Aforged finding  unknown-modifierU+001B[8m.json: permission denied\n1 file has no locale"),
        "{err}"
    );
}

#[test]
fn reads_a_locale_given_for_every_file_and_modifiers_the_host_registers() {
    let mut host = Memory::new(&[(
        "messages.json",
        r#"{"a": "{{n:plural; one:a; other:b;}} {{v:upper}}"}"#,
    )]);

    assert_eq!(host.run(&["messages.json"]).0, 1);
    assert_eq!(host.run(&["messages.json", "--modifier", "upper"]).0, 0);
    assert!(
        host.run(&["messages.json", "--modifier=upper", "--locale", "cs"])
            .1
            .contains("missing-category")
    );
    assert!(
        host.run(&["messages.json", "--modifier", "upper", "--no-intl"])
            .1
            .contains("`plural` is a modifier of the Intl level")
    );
}

#[test]
fn reports_a_duplicate_member_and_a_file_that_is_not_json() {
    let mut host = Memory::new(&[
        ("en.json", r#"{"a": "x", "a": "y"}"#),
        ("cs.json", r#"{"a": }"#),
        ("de.json", "{\"a\": \"x\ny\"}"),
    ]);
    let (code, out, _) = host.run(&["."]);

    assert_eq!(code, 1);
    assert!(
        out.contains("cs.json:1:7  error  Expected a value, found `}`.  unreadable-catalogue"),
        "{out}"
    );
    assert!(out.contains("en.json:1:2  error  `a` is defined again later in this object, so this value is never read.  duplicate-id"), "{out}");
    // A control character is named by its code point, so a report stays on
    // one line.
    assert!(out.contains("de.json:1:9  error  Expected a control character to be escaped, found U+000A.  unreadable-catalogue"), "{out}");
}

#[test]
fn compares_nothing_under_the_namespace_of_a_file_that_is_not_json() {
    let mut host = Memory::new(&[
        ("locales/en/common.json", r#"{"hi": "Hello {{name}}",}"#),
        ("locales/en/other.json", r#"{"bye": "Bye", "yes": "Yes"}"#),
        ("locales/cs/common.json", r#"{"hi": "Ahoj {{jmeno}}"}"#),
        ("locales/cs/other.json", r#"{"bye": "Nashle"}"#),
    ]);

    assert_eq!(
        host.run(&["--source", "en", PATTERN]),
        (
            1,
            "locales/en/common.json:1:25  error  Expected a string, found `}`.  unreadable-catalogue\nlocales/en/other.json:1:23  warning  `cs` has no message `other.yes`.  missing-message\n\n2 problems (1 error, 1 warning)\n".to_owned(),
            String::new()
        )
    );

    let mut host = Memory::new(&[
        ("locales/en/common.json", r#"{"a.b": "x", "a": {"b": "y"}}"#),
        ("locales/cs/common.json", r#"{"a":"#),
    ]);

    assert!(host.run(&[PATTERN]).1.contains("locales/en/common.json:1:25  error  `common.a.b` is defined again in `en`, so one of the two messages is never read.  duplicate-id"));
}

#[test]
fn reads_a_file_two_arguments_reach_once_and_compares_a_locale_with_no_message() {
    let mut host = Memory::new(&[("locales/en.json", r#"{"hi": "Hello"}"#)]);

    assert_eq!(host.run(&["locales/en.json", "locales"]).1, "");

    let mut host = Memory::new(&[("en.json", r#"{"hi": "Hello"}"#), ("cs.json", "{}")]);
    let (code, out, _) = host.run(&["{locale}.json"]);

    assert_eq!(code, 0);
    assert!(
        out.contains("en.json:1:8  warning  `cs` has no message `hi`.  missing-message"),
        "{out}"
    );
}

#[test]
fn counts_no_column_for_a_byte_order_mark() {
    let mut host = Memory::new(&[
        ("en.json", "\u{feff}{\"a\": \"{{v:zz}}\"}"),
        ("cs.json", "\u{feff}"),
    ]);

    assert!(host.run(&["en.json"]).1.contains("en.json:1:12  error"));
    assert!(
        host.run(&["cs.json"])
            .1
            .starts_with("cs.json:1:1  error  Expected a value, found the end of the file.")
    );
}

#[test]
fn counts_a_column_in_utf_16_code_units_however_long_the_line_is() {
    let wide = "\u{1f600}\u{e9}a".repeat(2000);
    let mut host = Memory::new(&[(
        "en.json",
        &format!("{{\"a\": \"{wide}\",\r\n\"b\": \"{wide}{{{{\"}}"),
    )]);

    assert_eq!(
        host.run(&["en.json"]).1.lines().next().unwrap(),
        format!("en.json:2:{}  {UNCLOSED}", 7 + 4 * 2000)
    );
}

#[test]
fn reads_a_locale_written_with_either_mark_and_refuses_one_that_is_none() {
    let mut host = Memory::new(&[
        (
            "messages.json",
            r#"{"a": "{{n:plural; one:soubor; few:soubory; other:soubor\u016f;}}"}"#,
        ),
        ("en.json", r#"{"a": "A"}"#),
    ]);

    assert!(
        host.run(&["messages.json", "--locale", "cs_CZ"])
            .1
            .contains("missing-category")
    );
    assert_eq!(
        host.run(&["messages.json", "--locale", "not a tag"]),
        (
            2,
            String::new(),
            "--locale \"not a tag\" is no locale: expected a tag such as cs or en-US.\n".to_owned()
        )
    );
    // A language of five to eight letters is well-formed, and none is
    // registered.
    assert!(
        host.run(&["messages.json", "--locale", "common"])
            .2
            .contains("--locale \"common\" is no locale")
    );
    assert!(
        host.run(&["en.json", "--source", "bad tag!"])
            .2
            .contains("--source \"bad tag!\" is no locale")
    );

    let (code, _, err) = host.run(&["en.json", "--source", "fr"]);

    assert_eq!(code, 2);
    assert!(err.contains("`fr`"), "{err}");
}

#[test]
fn reads_a_directory_at_its_own_path_and_follows_no_link_to_one_that_holds_it() {
    let mut host = Memory::new(&[
        ("locales/en/common.json", r#"{"hi": "{{"}"#),
        ("locales/cs/common.json", r#"{"hi": "Ahoj"}"#),
    ]);

    host.link("locales/en", "locales/aa");
    host.link("locales", "locales/en/loop");
    host.link(".", "locales/up");
    host.link("nowhere", "locales/broken.json");

    let (code, out, err) = host.run(&["locales"]);

    assert_eq!((code, err), (1, format!("2 files have{UNPLACED}")));
    assert_eq!(paths(&out), ["locales/en/common.json"]);

    // A pattern reads a link to a directory as the locale its name gives.
    let (_, out, _) = host.run(&[PATTERN, "--format", "json"]);

    assert_eq!(
        out.matches("\"code\": \"unclosed-placeholder\"").count(),
        2,
        "{out}"
    );
    assert!(
        out.contains("\"file\": \"locales/aa/common.json\"") && out.contains("\"locale\": \"aa\""),
        "{out}"
    );
}

#[test]
fn reads_no_hidden_name_and_no_node_modules_but_where_a_pattern_writes_it() {
    let mut host = Memory::new(&[
        ("node_modules/x/en.json", r#"{"a": "{{"}"#),
        (".cache/en.json", r#"{"a": "{{"}"#),
        ("en.json", r#"{"a": "ok"}"#),
        ("packages/app/.i18n/en.json", r#"{"a": "{{"}"#),
        ("locales/en/common.json", r#"{"a": "A"}"#),
        ("locales/en/.draft.json", r#"{"a": "{{"}"#),
        ("locales/en/node_modules/x.json", r#"{"a": "{{"}"#),
        ("locales/en/admin/.git/x.json", r#"{"a": "{{"}"#),
        ("i18n/.en.json", r#"{"a": "{{"}"#),
    ]);

    assert_eq!(host.run(&["."]).1, "");
    assert_eq!(host.run(&[PATTERN]), (0, String::new(), String::new()));
    assert_eq!(
        host.run(&["packages/{namespace}/.i18n/{locale}.json"]),
        (
            1,
            format!(
                "packages/app/.i18n/en.json:1:8  {UNCLOSED}\n\n1 problem (1 error, 0 warnings)\n"
            ),
            String::new()
        )
    );
    assert_eq!(
        paths(&host.run(&["i18n/.{locale}.json"]).1),
        ["i18n/.en.json"]
    );
}

#[test]
fn reports_a_directory_it_cannot_read_and_compares_no_locale_with_another() {
    let mut host = Memory::new(&[
        (
            "locales/en/common.json",
            r#"{"hi": "Hi", "bye": "Bye", "a.b": "x", "a": {"b": "y"}}"#,
        ),
        (
            "locales/cs/common.json",
            r#"{"hi": "{{", "files": "{{n:plural; one:soubor; few:soubory; other:soubor\u016f;}}"}"#,
        ),
        ("locales/en/admin/users.json", r#"{"title": "Users"}"#),
        ("locales/cs/admin/users.json", r#"{"title": "Uzivatele"}"#),
    ]);
    let cannot = format!("Cannot read locales/cs/admin: {DENIED}\n");

    host.refused.insert("cs/admin");

    // What `cs` holds under `admin` is unknown, so what it lacks or holds
    // beside `en` is too. Each message is still linted with its locale, and
    // each locale on its own.
    assert_eq!(
        host.run(&[PATTERN]),
        (
            2,
            format!(
                "locales/cs/common.json:1:9  {UNCLOSED}\nlocales/cs/common.json:1:28  error  `cs` puts 0.5, 1.5 and 2.5 in `many`, and this selection has no `many` option, so those take the fallback chain.  missing-category\nlocales/en/common.json:1:51  error  `common.a.b` is defined again in `en`, so one of the two messages is never read.  duplicate-id\n\n3 problems (3 errors, 0 warnings)\n"
            ),
            format!("{cannot}{UNCOMPARED}")
        )
    );

    // Given as it is, its files would be read in no locale, and compared
    // with nothing.
    let (code, out, err) = host.run(&["locales"]);

    assert_eq!(code, 2);
    assert!(out.contains("locales/cs/common.json:1:9  error"), "{out}");
    assert!(
        err.starts_with(&cannot) && !err.contains(UNCOMPARED),
        "{err}"
    );

    // Named once, at the first argument's path to it, and compared by none
    // where any argument would read its files in a locale.
    let (code, out, err) = host.run(&["locales", PATTERN]);

    assert_eq!((code, err.matches("Cannot read").count()), (2, 1));
    assert!(
        !out.contains("orphan-message") && err.ends_with(UNCOMPARED),
        "{out}{err}"
    );

    // A base it cannot list, or cannot reach, is named, not a pattern that
    // names no file.
    host.refused.insert("locales");
    assert_eq!(
        host.run(&[PATTERN]),
        (
            2,
            String::new(),
            format!("Cannot read locales: {DENIED}\n{UNCOMPARED}")
        )
    );
    host.refused.remove("locales");
    host.unreachable.insert("locales");
    assert_eq!(
        host.run(&[PATTERN]),
        (
            2,
            String::new(),
            format!("Cannot read locales: {DENIED}\n{UNCOMPARED}")
        )
    );
}

#[test]
fn compares_nothing_a_locale_it_cannot_read_could_change() {
    let mut host = Memory::new(&[
        (
            "locales/en/common.json",
            r#"{"hi": "Hi {{name}}", "bye": "Bye"}"#,
        ),
        ("locales/de/common.json", r#"{"hi": "{{"}"#),
        ("locales/cs/common.json", r#"{"hi": "Ahoj"}"#),
    ]);
    let found = (
        2,
        format!("locales/de/common.json:1:9  {UNCLOSED}\n\n1 problem (1 error, 0 warnings)\n"),
        format!("Cannot read locales/cs: {DENIED}\n{UNCOMPARED}"),
    );

    host.refused.insert("locales/cs");
    assert_eq!(host.run(&[PATTERN]), found);

    // Any locale could be what it cannot read, the source named included.
    for source in ["cs", "pl"] {
        assert_eq!(host.run(&[PATTERN, "--source", source]), found);
    }
}

#[test]
fn compares_every_locale_where_a_directory_it_cannot_read_would_hold_files_of_none() {
    let mut host = Memory::new(&[
        ("locales/en/common.json", r#"{"hi": "Hi", "bye": "Bye"}"#),
        ("locales/cs/common.json", r#"{"hi": "Ahoj"}"#),
        (
            "locales/en/admin/users.json",
            r#"{"title": "Users", "x": "X"}"#,
        ),
        ("locales/cs/admin/users.json", r#"{"title": "Uzivatele"}"#),
        ("extra/admin/x.json", r#"{"x": "X"}"#),
    ]);
    let cannot = format!("Cannot read extra/admin: {DENIED}\n");

    host.refused.insert("extra/admin");

    for extra in ["extra/{namespace}.json", "extra"] {
        // Its files would have no locale, so they are compared with nothing.
        assert_eq!(
            host.run(&[PATTERN, extra]),
            (
                2,
                "locales/en/admin/users.json:1:25  warning  `cs` has no message `admin.users.x`.  missing-message\nlocales/en/common.json:1:21  warning  `cs` has no message `common.bye`.  missing-message\n\n2 problems (0 errors, 2 warnings)\n".to_owned(),
                cannot.clone()
            )
        );
        assert_eq!(
            host.run(&[PATTERN, extra, "--source", "pl"]),
            (
                2,
                String::new(),
                format!("{cannot}No file given is written for the source locale `pl`.\n")
            )
        );
        // With --locale, they would be in that locale.
        assert_eq!(
            host.run(&["--locale", "cs", "--source", "pl", PATTERN, extra]),
            (2, String::new(), format!("{cannot}{UNCOMPARED}"))
        );
    }
}

#[test]
fn reports_a_file_it_cannot_read_and_compares_nothing_under_its_namespace() {
    let mut host = Memory::new(&[
        ("locales/en/common.json", r#"{"hi": "Hi", "bye": "Bye"}"#),
        ("locales/en/admin.json", r#"{"title": "Users"}"#),
        ("locales/cs/common.json", r#"{"hi": "{{"}"#),
        ("locales/cs/admin.json", r#"{"title": "Uzivatele"}"#),
    ]);

    host.refused.insert("cs/admin.json");
    assert_eq!(
        host.run(&[PATTERN]),
        (
            2,
            format!(
                "locales/cs/common.json:1:9  {UNCLOSED}\nlocales/en/common.json:1:21  warning  `cs` has no message `common.bye`.  missing-message\n\n2 problems (1 error, 1 warning)\n"
            ),
            format!("Cannot read locales/cs/admin.json: {DENIED}\n")
        )
    );

    // A locale written for is one, whether or not its files can be read.
    host.refused.insert("cs/common.json");
    assert_eq!(
        host.run(&[PATTERN, "--source", "cs"]),
        (
            2,
            String::new(),
            format!(
                "Cannot read locales/cs/admin.json: {DENIED}\nCannot read locales/cs/common.json: {DENIED}\n"
            )
        )
    );

    // Named once, however many locales it is read in.
    let mut host = Memory::new(&[
        ("x/en.json", r#"{"hi": "Hi"}"#),
        ("x/de.json", r#"{"hi": "Hallo"}"#),
    ]);

    host.refused.insert("x/en.json");
    assert_eq!(
        host.run(&["x/{namespace}.json", "x/{locale}.json", "--locale", "cs"]),
        (
            2,
            String::new(),
            format!("Cannot read x/en.json: {DENIED}\n")
        )
    );
}

#[test]
fn exits_2_on_wrong_arguments_and_on_a_path_it_cannot_read() {
    let mut host = Memory::new(&[]);

    assert_eq!(host.run(&[]), (2, String::new(), format!("{USAGE}\n")));
    assert_eq!(
        host.run(&["--format", "xml", "."]),
        (
            2,
            String::new(),
            "Unknown format \"xml\": expected text or json.\n".to_owned()
        )
    );
    assert_eq!(
        host.run(&["missing"]),
        (
            2,
            String::new(),
            "Cannot read missing: no such file or directory\n".to_owned()
        )
    );
    assert_eq!(
        host.run(&["--help"]),
        (0, format!("{USAGE}\n"), String::new())
    );
    assert_eq!(host.run(&[".", "--help", "--nope"]).0, 2);

    for (argv, said) in [
        (
            &["--nope", "."][..],
            "Unknown option '--nope'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- \"--nope\"",
        ),
        (
            &["-q"],
            "Unknown option '-q'. To specify a positional argument starting with a '-', place it at the end of the command after '--', as in '-- \"-q\"",
        ),
        (
            &[".", "--locale"],
            "Option '--locale <value>' argument missing",
        ),
        (
            &["--locale", "--quiet", "."],
            "Option '--locale' argument is ambiguous.\nDid you forget to specify the option argument for '--locale'?\nTo specify an option argument starting with a dash use '--locale=-XYZ'.",
        ),
        (
            &["--quiet=1", "."],
            "Option '--quiet' does not take an argument",
        ),
    ] {
        assert_eq!(
            host.run(argv),
            (2, String::new(), format!("{said}\n\n{USAGE}\n")),
            "{argv:?}"
        );
    }

    // What follows `--` is a path, whatever it opens with.
    assert_eq!(
        host.run(&["--", "--quiet"]).2,
        "Cannot read --quiet: no such file or directory\n"
    );
}
