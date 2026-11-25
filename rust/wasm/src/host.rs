//! The command's host: the files, the working directory and the two streams
//! of the runtime the module runs in, each asked through one import.

use curly_message_lint::Plurals;
use curly_message_lint::command::{Fault, Host, Kind, Named};

use crate::abi;
use crate::plurals::Hosted;

const RESOLVE: u32 = 0;
const RELATIVE: u32 = 1;
const STAT: u32 = 2;
const LSTAT: u32 = 3;
const REALPATH: u32 = 4;
const READ_DIR: u32 = 5;
const READ: u32 = 6;
const OUT: u32 = 7;
const ERR: u32 = 8;

/// What the runtime answered: past the eight bytes of its length and of how
/// it went, the bytes asked for, or what the runtime says of the path.
struct Answer(Box<[u8]>);

impl Answer {
    fn bytes(&self) -> &[u8] {
        self.0.get(8..).unwrap_or(&[])
    }

    fn text(&self) -> String {
        String::from_utf8_lossy(self.bytes()).into_owned()
    }

    fn fault(&self) -> Option<Fault> {
        match self.0.get(4) {
            Some(0) => None,
            Some(2) => Some(Fault::missing(self.text())),
            _ => Some(Fault::new(self.text())),
        }
    }
}

fn ask(op: u32, text: &str) -> Result<Answer, Fault> {
    let answer = Answer(abi::ask(op, text).unwrap_or_else(|| crate::fail()));

    answer.fault().map_or(Ok(answer), Err)
}

fn kind(byte: Option<&u8>) -> Kind {
    match byte {
        Some(b'f') => Kind::File,
        Some(b'd') => Kind::Directory,
        Some(b'l') => Kind::Link,
        _ => Kind::Other,
    }
}

pub struct Runtime {
    pub separator: char,
}

impl Host for Runtime {
    fn separator(&self) -> char {
        self.separator
    }

    fn resolve(&self, path: &str) -> String {
        ask(RESOLVE, path).map_or_else(|_| path.to_owned(), |answer| answer.text())
    }

    fn relative(&self, path: &str) -> String {
        ask(RELATIVE, path).map_or_else(|_| path.to_owned(), |answer| answer.text())
    }

    fn stat(&self, path: &str) -> Result<Kind, Fault> {
        ask(STAT, path).map(|answer| kind(answer.bytes().first()))
    }

    fn lstat(&self, path: &str) -> Result<Kind, Fault> {
        ask(LSTAT, path).map(|answer| kind(answer.bytes().first()))
    }

    fn realpath(&self, path: &str) -> Result<String, Fault> {
        ask(REALPATH, path).map(|answer| answer.text())
    }

    // Each name follows the byte of its kind and ends with a zero byte,
    // which no name holds.
    fn read_dir(&self, path: &str) -> Result<Vec<Named>, Fault> {
        ask(READ_DIR, path).map(|answer| {
            answer
                .bytes()
                .split_inclusive(|byte| *byte == 0)
                .filter_map(|named| named.split_last())
                .filter_map(|(_, named)| named.split_first())
                .map(|(of, name)| Named::new(String::from_utf8_lossy(name), kind(Some(of))))
                .collect()
        })
    }

    fn read(&self, path: &str) -> Result<String, Fault> {
        ask(READ, path).map(|answer| answer.text())
    }

    fn plurals(&self) -> &dyn Plurals {
        &Hosted
    }

    fn out(&mut self, text: &str) {
        let _ = ask(OUT, text);
    }

    fn err(&mut self, text: &str) {
        let _ = ask(ERR, text);
    }
}
