//! The built command on the files of this machine, as a project runs it.

#![cfg(feature = "cldr")]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::indexing_slicing,
    clippy::string_slice,
    clippy::arithmetic_side_effects
)]

use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};

const UNCLOSED: &str = "error  `{{` opens no placeholder: nothing closes it on its line, so it renders as text.  unclosed-placeholder";

// A directory of its own for a test, emptied of what an earlier run left.
fn tree(name: &str, files: &[(&str, &[u8])]) -> PathBuf {
    let root = Path::new(env!("CARGO_TARGET_TMPDIR"))
        .join("cli")
        .join(name);

    let _ = fs::remove_dir_all(&root);

    for (path, bytes) in files {
        let path = root.join(path);

        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, bytes).unwrap();
    }

    fs::create_dir_all(&root).unwrap();
    root
}

// Cargo's build of the command, or the one `CURLY_LINT_BIN` names, as a
// package that ships the command installs it.
fn program() -> PathBuf {
    match std::env::var_os("CURLY_LINT_BIN") {
        Some(path) => std::path::absolute(path).unwrap(),
        None => PathBuf::from(env!("CARGO_BIN_EXE_curly-lint")),
    }
}

fn command(cwd: &Path, argv: &[&str]) -> Command {
    let mut command = Command::new(program());

    command.current_dir(cwd).args(argv);
    command
}

fn run(cwd: &Path, argv: &[&str]) -> (Option<i32>, String, String) {
    let Output {
        status,
        stdout,
        stderr,
    } = command(cwd, argv).output().unwrap();

    (
        status.code(),
        String::from_utf8(stdout).unwrap(),
        String::from_utf8(stderr).unwrap(),
    )
}

#[test]
fn runs_as_the_library_does_and_exits_as_it_decides() {
    let root = tree(
        "runs",
        &[
            ("locales/en/common.json", b"{\n  \"hi\": \"Hello, {{name}}!\",\n  \"files\": \"{{n:plural; one:file; other:files;}}\"\n}\n"),
            ("locales/cs/common.json", b"{\n  \"hi\": \"Ahoj, {{name}\",\n  \"files\": \"{{n:plural; one:soubor; few:soubory; other:soubor\\u016f;}}\"\n}\n"),
            ("clean/en.json", b"{\"a\": \"A\"}"),
        ],
    );

    assert_eq!(
        run(&root, &["locales/{locale}/{namespace}.json"]),
        (
            Some(1),
            format!(
                "locales/cs/common.json:2:9  error  This message never reads `name`, which the `en` message reads.  parameter-mismatch\nlocales/cs/common.json:2:16  {UNCLOSED}\nlocales/cs/common.json:3:17  error  `cs` puts 0.5, 1.5 and 2.5 in `many`, and this selection has no `many` option, so those take the fallback chain.  missing-category\n\n3 problems (3 errors, 0 warnings)\n"
            ),
            String::new()
        )
    );
    assert_eq!(
        run(&root, &["clean/{locale}.json"]),
        (Some(0), String::new(), String::new())
    );
    assert_eq!(
        run(
            &root.join("clean"),
            &["../clean/en.json", "--locale", "en", "--format", "json"]
        ),
        (Some(0), "[]\n".to_owned(), String::new())
    );

    let (code, out, err) = run(&root, &["missing"]);

    assert_eq!((code, out.as_str()), (Some(2), ""));
    assert!(
        err.starts_with("Cannot read missing: ") && err.ends_with('\n') && err.lines().count() == 1,
        "{err}"
    );
    assert_eq!(
        run(&root, &["--format", "xml", "."]),
        (
            Some(2),
            String::new(),
            "Unknown format \"xml\": expected text or json.\n".to_owned()
        )
    );
}

#[test]
fn reads_a_directory_in_the_order_of_its_names_and_a_path_from_the_root() {
    let root = tree(
        "order",
        &[
            ("a/x.json", b"{\"a\": \"{{\"}"),
            ("B/x.json", b"{\"b\": \"{{\"}"),
            ("a-b/x.json", b"{\"c\": \"{{\"}"),
            ("a_b/x.json", b"{\"d\": \"{{\"}"),
            ("a_b/notes.txt", b"{{"),
            ("a_b/.hidden/x.json", b"{\"d\": \"{{\"}"),
        ],
    );
    let files = |cwd: &Path, argv: &[&str]| -> Vec<String> {
        let (code, out, err) = run(cwd, argv);
        let found: Vec<String> = out
            .lines()
            .filter(|line| line.contains("  "))
            .map(|line| line.split(":1:").next().unwrap().to_owned())
            .collect();

        assert_eq!(code, Some(1), "{out}{err}");
        assert!(
            err.starts_with(&format!("{} files have no locale", found.len()))
                && err.lines().count() == 1,
            "{err}"
        );
        found
    };

    assert_eq!(
        files(&root, &["."]),
        ["B/x.json", "a/x.json", "a-b/x.json", "a_b/x.json"]
    );
    assert_eq!(
        files(&root.join("a"), &[".."]),
        ["../B/x.json", "x.json", "../a-b/x.json", "../a_b/x.json"]
    );
    // A path is shown from the working directory, with `/`, however it is
    // given.
    assert_eq!(
        files(&root, &[root.join("a_b").to_str().unwrap(), "./B/../a"]),
        ["a_b/x.json", "a/x.json"]
    );
}

#[test]
fn reads_a_file_that_is_no_utf_8_with_what_cannot_be_read_replaced() {
    let root = tree(
        "bytes",
        &[
            ("en.json", b"{\"a\": \"\xff{{\", \"b\": \"\xc3\x28 {{\"}"),
            ("bom.json", b"\xef\xbb\xbf{\"a\": \"{{v:zz}}\"}"),
            ("crlf.json", b"{\r\n\"a\": \"x\",\r\"b\": \"{{\"\n}"),
        ],
    );

    assert_eq!(
        run(&root, &["en.json", "--locale", "en"]).1,
        format!(
            "en.json:1:9  {UNCLOSED}\nen.json:1:23  {UNCLOSED}\n\n2 problems (2 errors, 0 warnings)\n"
        )
    );
    assert!(
        run(&root, &["bom.json"])
            .1
            .starts_with("bom.json:1:12  error")
    );
    assert!(
        run(&root, &["crlf.json"])
            .1
            .starts_with("crlf.json:3:7  error")
    );
}

#[cfg(unix)]
#[test]
fn follows_a_link_to_a_file_and_none_to_a_directory_that_holds_it() {
    use std::os::unix::fs::symlink;

    let root = tree(
        "links",
        &[
            ("locales/en/common.json", b"{\"hi\": \"{{\"}"),
            ("locales/cs/common.json", b"{\"hi\": \"Ahoj\"}"),
        ],
    );

    symlink(root.join("locales"), root.join("locales/en/loop")).unwrap();
    symlink(root.join("locales/en"), root.join("locales/aa")).unwrap();
    symlink(root.join("nowhere"), root.join("locales/en/broken.json")).unwrap();
    symlink(
        root.join("locales/cs/common.json"),
        root.join("locales/en/linked.json"),
    )
    .unwrap();
    symlink(root.join("around"), root.join("around")).unwrap();

    let (code, out, err) = run(&root, &["locales"]);

    // The file a link leads to is read once, where it stands.
    assert_eq!(code, Some(1));
    assert!(err.starts_with("2 files have no locale"), "{err}");
    assert_eq!(
        out,
        format!("locales/en/common.json:1:9  {UNCLOSED}\n\n1 problem (1 error, 0 warnings)\n")
    );

    let (code, out, _) = run(&root, &["locales/{locale}/{namespace}.json", "--quiet"]);

    assert_eq!(code, Some(1));
    assert_eq!(
        out,
        format!(
            "locales/aa/common.json:1:9  {UNCLOSED}\nlocales/en/common.json:1:9  {UNCLOSED}\n\n2 problems (2 errors, 0 warnings)\n"
        )
    );

    // A link given as it is that leads nowhere is a file that cannot be
    // read, and a loop of links is a path that is not there.
    for path in ["locales/en/broken.json", "around"] {
        let (code, out, err) = run(&root, &[path]);

        assert_eq!((code, out.as_str()), (Some(2), ""), "{path}");
        assert!(err.starts_with(&format!("Cannot read {path}: ")), "{err}");
    }
}

#[cfg(unix)]
#[test]
fn reads_a_name_that_is_no_utf_8_as_one_it_cannot_read() {
    use std::ffi::OsStr;
    use std::os::unix::ffi::OsStrExt;

    let root = tree("names", &[("en.json", b"{\"a\": \"{{\"}")]);

    // Where the file system takes such a name at all.
    if fs::write(root.join(OsStr::from_bytes(b"\xff.json")), b"{}").is_err() {
        return;
    }

    let (code, out, err) = run(&root, &["."]);

    assert_eq!(code, Some(2));
    assert!(out.starts_with("en.json:1:8  error"), "{out}");
    assert!(err.starts_with("Cannot read \u{fffd}.json: "), "{err}");
}

#[test]
fn exits_as_the_lint_decided_where_its_reader_is_gone_and_prints_no_trace() {
    let members: Vec<String> = (0..20_000)
        .map(|index| format!("\"k{index}\": \"{{{{\""))
        .collect();
    let root = tree(
        "gone",
        &[("en.json", format!("{{{}}}", members.join(",\n")).as_bytes())],
    );
    let mut child = command(&root, &["{locale}.json"])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();

    // More than a pipe holds is written to one nobody reads.
    drop(child.stdout.take());

    let output = child.wait_with_output().unwrap();

    assert_eq!(
        (
            output.status.code(),
            String::from_utf8(output.stderr).unwrap().as_str()
        ),
        (Some(1), "")
    );
}

#[test]
fn writes_its_report_to_a_regular_file() {
    let root = tree("file", &[("en.json", b"{\"a\": \"{{\"}")]);
    let report = fs::File::create(root.join("report.txt")).unwrap();
    let status = command(&root, &["en.json"])
        .stdout(report)
        .status()
        .unwrap();

    assert_eq!(status.code(), Some(1));
    assert_eq!(
        fs::read_to_string(root.join("report.txt")).unwrap(),
        format!("en.json:1:8  {UNCLOSED}\n\n1 problem (1 error, 0 warnings)\n")
    );
}

#[cfg(target_os = "linux")]
#[test]
fn says_where_the_report_cannot_be_written_and_exits_2() {
    let root = tree("full", &[("en.json", b"{\"a\": \"{{\"}")]);
    let full = fs::OpenOptions::new()
        .write(true)
        .open("/dev/full")
        .unwrap();
    let output = command(&root, &["{locale}.json"])
        .stdout(full)
        .output()
        .unwrap();
    let err = String::from_utf8(output.stderr).unwrap();

    assert_eq!(output.status.code(), Some(2));
    assert!(
        err.starts_with("Cannot write the report: ") && err.lines().count() == 1,
        "{err}"
    );
}
