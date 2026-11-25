//! Declares the most memory the module grows to, so that a call that runs
//! out of it does so at a stated bound.

use std::io::Write;

include!("src/memory.rs");

fn main() {
    if std::env::var("CARGO_CFG_TARGET_ARCH").as_deref() == Ok("wasm32") {
        // Cargo reads a build script's instructions off its standard output,
        // and one it cannot be told leaves nothing to build with.
        let _ = writeln!(
            std::io::stdout(),
            "cargo::rustc-cdylib-link-arg=--max-memory={MAX_MEMORY}"
        );
    }
}
