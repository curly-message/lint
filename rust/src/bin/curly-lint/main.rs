//! The `curly-lint` command on the files of this machine, with the plural
//! rules of the Unicode CLDR the crate carries.

mod host;

use std::io::Write;
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::process::ExitCode;

use curly_message_lint::command::run;

use crate::host::Native;

const FAULT: u8 = 2;

fn main() -> ExitCode {
    let argv: Vec<String> = std::env::args_os()
        .skip(1)
        .map(|argument| argument.to_string_lossy().into_owned())
        .collect();
    let mut host = Native::new();
    // A fault of the command itself is no finding of the lint: it exits as a
    // path that cannot be read does.
    let code = catch_unwind(AssertUnwindSafe(|| run(&argv, &mut host))).unwrap_or(i32::from(FAULT));

    if let Some(fault) = host.close() {
        // Nothing is left to say it through where this write fails too.
        let _ =
            std::io::stderr().write_all(format!("Cannot write the report: {fault}\n").as_bytes());

        return ExitCode::from(FAULT);
    }

    ExitCode::from(u8::try_from(code).unwrap_or(FAULT))
}
