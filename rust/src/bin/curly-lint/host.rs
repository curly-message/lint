use std::fs;
use std::io::{self, BufWriter, ErrorKind, Stdout, Write};
use std::path::MAIN_SEPARATOR;

use curly_message_lint::Cldr;
use curly_message_lint::Plurals;
use curly_message_lint::command::{Fault, Host, Kind, Named};

/// The files of this machine, the two standard streams and the plural rules
/// the crate carries.
pub struct Native {
    /// The working directory, where it can be told.
    cwd: Result<String, Fault>,
    out: Option<BufWriter<Stdout>>,
    /// Why the report could not be written, a reader gone aside.
    fault: Option<io::Error>,
    plurals: Cldr,
}

// A loop of links, which `ErrorKind` has no stable name for.
#[cfg(any(target_os = "linux", target_os = "android"))]
const LOOP: Option<i32> = Some(40);
#[cfg(any(target_os = "macos", target_os = "ios", target_os = "freebsd"))]
const LOOP: Option<i32> = Some(62);
#[cfg(not(any(
    target_os = "linux",
    target_os = "android",
    target_os = "macos",
    target_os = "ios",
    target_os = "freebsd"
)))]
const LOOP: Option<i32> = None;

fn fault(error: &io::Error) -> Fault {
    let missing = matches!(error.kind(), ErrorKind::NotFound | ErrorKind::NotADirectory)
        || (LOOP.is_some() && error.raw_os_error() == LOOP);

    if missing {
        Fault::missing(error.to_string())
    } else {
        Fault::new(error.to_string())
    }
}

fn kind(of: fs::FileType) -> Kind {
    if of.is_symlink() {
        Kind::Link
    } else if of.is_dir() {
        Kind::Directory
    } else if of.is_file() {
        Kind::File
    } else {
        Kind::Other
    }
}

// The names of a path from its root, `.` dropped and `..` taken with the
// name before it.
fn names(path: &str) -> Vec<&str> {
    let mut names = Vec::new();

    for name in path.split(MAIN_SEPARATOR) {
        match name {
            "" | "." => {}
            ".." => {
                names.pop();
            }
            name => names.push(name),
        }
    }

    names
}

fn same(a: &str, b: &str) -> bool {
    if cfg!(windows) {
        a.to_lowercase() == b.to_lowercase()
    } else {
        a == b
    }
}

impl Native {
    pub fn new() -> Self {
        Self {
            cwd: std::env::current_dir()
                .map(|cwd| cwd.to_string_lossy().into_owned())
                .map_err(|error| fault(&error)),
            out: Some(BufWriter::new(io::stdout())),
            fault: None,
            plurals: Cldr,
        }
    }

    // A reader gone, as `head` leaves a pipe, ends the report and is no
    // fault; anything else is one. Nothing is written after either.
    fn failed(&mut self, error: io::Error) {
        // Dropping the writer would write what it holds once more.
        if let Some(out) = self.out.take() {
            let _ = out.into_parts();
        }

        if !matches!(
            error.kind(),
            ErrorKind::BrokenPipe | ErrorKind::ConnectionReset
        ) {
            self.fault = Some(error);
        }
    }

    /// Writes what the report still holds, and gives why it could not be
    /// written, here or earlier.
    pub fn close(&mut self) -> Option<io::Error> {
        if let Some(Err(error)) = self.out.as_mut().map(Write::flush) {
            self.failed(error);
        }

        self.fault.take()
    }
}

impl Host for Native {
    fn separator(&self) -> char {
        MAIN_SEPARATOR
    }

    #[cfg(not(windows))]
    fn resolve(&self, path: &str) -> String {
        let from = match &self.cwd {
            Ok(cwd) if !path.starts_with(MAIN_SEPARATOR) => cwd.as_str(),
            _ => "",
        };

        format!("/{}", names(&format!("{from}/{path}")).join("/"))
    }

    // The system's own reading of a path, which knows what a drive, a share
    // and a device name are.
    #[cfg(windows)]
    fn resolve(&self, path: &str) -> String {
        let resolved = std::path::absolute(if path.is_empty() { "." } else { path }).map_or_else(
            |_| path.to_owned(),
            |resolved| resolved.to_string_lossy().into_owned(),
        );
        let trimmed = resolved.trim_end_matches(MAIN_SEPARATOR);

        if trimmed.ends_with(':') || trimmed.is_empty() {
            resolved
        } else {
            trimmed.to_owned()
        }
    }

    fn relative(&self, path: &str) -> String {
        let Ok(cwd) = &self.cwd else {
            return path.to_owned();
        };
        let (from, to) = (names(cwd), names(path));
        let shared = from.iter().zip(&to).take_while(|(a, b)| same(a, b)).count();

        // Another drive is reached from no directory of this one.
        if cfg!(windows) && shared == 0 {
            return path.to_owned();
        }

        from.iter()
            .skip(shared)
            .map(|_| "..")
            .chain(to.iter().skip(shared).copied())
            .collect::<Vec<&str>>()
            .join(MAIN_SEPARATOR.encode_utf8(&mut [0; 4]))
    }

    fn stat(&self, path: &str) -> Result<Kind, Fault> {
        fs::metadata(path)
            .map(|found| kind(found.file_type()))
            .map_err(|error| fault(&error))
    }

    fn lstat(&self, path: &str) -> Result<Kind, Fault> {
        fs::symlink_metadata(path)
            .map(|found| kind(found.file_type()))
            .map_err(|error| fault(&error))
    }

    fn realpath(&self, path: &str) -> Result<String, Fault> {
        let real = fs::canonicalize(path).map_err(|error| fault(&error))?;
        let real = real.to_string_lossy();

        // The form Windows gives a canonical path, which names the same file
        // as the path without it.
        Ok(match real.strip_prefix(r"\\?\") {
            Some(rest) if !rest.starts_with("UNC") => rest.to_owned(),
            _ => real.into_owned(),
        })
    }

    fn read_dir(&self, path: &str) -> Result<Vec<Named>, Fault> {
        let mut named = Vec::new();

        for entry in fs::read_dir(path).map_err(|error| fault(&error))? {
            let entry = entry.map_err(|error| fault(&error))?;

            named.push(Named::new(
                entry.file_name().to_string_lossy(),
                entry.file_type().map_or(Kind::Other, kind),
            ));
        }

        Ok(named)
    }

    fn read(&self, path: &str) -> Result<String, Fault> {
        fs::read(path)
            .map(|bytes| match String::from_utf8(bytes) {
                Ok(text) => text,
                Err(error) => String::from_utf8_lossy(error.as_bytes()).into_owned(),
            })
            .map_err(|error| fault(&error))
    }

    fn plurals(&self) -> &dyn Plurals {
        &self.plurals
    }

    fn out(&mut self, text: &str) {
        if let Some(Err(error)) = self.out.as_mut().map(|out| out.write_all(text.as_bytes())) {
            self.failed(error);
        }
    }

    fn err(&mut self, text: &str) {
        // Standard error gone leaves nowhere to say so.
        let _ = io::stderr().write_all(text.as_bytes());
    }
}
