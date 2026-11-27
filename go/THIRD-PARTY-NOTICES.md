# Third-party notices

The `curly-lint` commands the Go module `github.com/curly-message/lint-go`
holds, one for each platform it names, are binaries of the Rust crate
[`curly-message-lint`](https://github.com/curly-message/lint/tree/main/rust),
which is this package's own, built with what is listed here, each with the
terms it is taken under. The launcher that runs them is this package's own
too, and requires no module: a project's go command builds it with the Go
standard library it carries.

| Component | In | Terms | Copyright |
|-----------|----|-------|-----------|
| The plural rules and language aliases of the [Unicode CLDR](https://cldr.unicode.org/), the crate's `cldr/` | every command | Unicode License v3 | Copyright © 2004-2025 Unicode, Inc. |
| [`curly-message-parser`](https://crates.io/crates/curly-message-parser) | every command | MIT | Copyright (c) 2026 G.A.W.Group, s.r.o. |
| [`unicode-properties`](https://crates.io/crates/unicode-properties) | every command | MIT, of MIT or Apache-2.0; its tables of character properties, generated from the Unicode Character Database, under the Unicode License v3 | Copyright (c) 2015 The Rust Project Developers; Copyright © 1991-2026 Unicode, Inc. |
| The Rust standard library (`core`, `alloc` and `std`), as the compiler that built the release carries it, with the crates it is built from but `compiler_builtins`, among them `hashbrown`, `gimli`, `addr2line`, `miniz_oxide` and `rustc-demangle` | every command | MIT, of the terms each offers beside it (Apache-2.0, and for `miniz_oxide` Zlib) | Copyrights in the Rust Standard Library are retained by their contributors; Copyright (c) 2016 Amanieu d'Antras; Copyright (c) 2015 The Rust Project Developers; Copyright (c) 2016-2018 The gimli Developers; Copyright (c) 2017 Frommi, Copyright 2013-2014 RAD Game Tools and Valve Software, Copyright 2010-2014 Rich Geldreich and Tenacious Software LLC; Copyright (c) 2014 Alex Crichton |
| [`compiler_builtins`](https://github.com/rust-lang/compiler-builtins), the crate of the standard library that ports LLVM's `compiler-rt` | every command | MIT AND Apache-2.0 WITH LLVM-exception | Copyright (c) The Rust Project Developers; Copyright (c) LLVM Project contributors |
| [LLVM's `libunwind`](https://github.com/llvm/llvm-project/tree/main/libunwind), the unwinder the binary is linked with | the commands for Linux | Apache-2.0 WITH LLVM-exception | Copyright (c) LLVM Project contributors |
| [musl](https://musl.libc.org/), the C library the binary is linked with statically | the commands for Linux | MIT | Copyright © 2005-2020 Rich Felker, et al.; in the command for ARM64, its AArch64 `memcpy` and `memset` (`src/string/aarch64/*`), Copyright © 1999-2019, Arm Limited |

The commands for macOS call the system's `libSystem`, linked dynamically,
and hold none of it. The commands for Windows hold Microsoft's C runtime,
linked statically so that a Windows without the Visual C++ redistributable
runs them: its `libcmt` and `libvcruntime`, under the terms of the Visual
C++ build tools, and the Universal C Runtime's `libucrt`, under the terms of
the Windows SDK.

## MIT License

For each component above taken under MIT, with its copyright notice:

```
Permission is hereby granted, free of charge, to any
person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the
Software without restriction, including without
limitation the rights to use, copy, modify, merge,
publish, distribute, sublicense, and/or sell copies of
the Software, and to permit persons to whom the Software
is furnished to do so, subject to the following
conditions:

The above copyright notice and this permission notice
shall be included in all copies or substantial portions
of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF
ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED
TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A
PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT
SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY
CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR
IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER
DEALINGS IN THE SOFTWARE.
```

## Apache License 2.0 with the LLVM exception

`compiler_builtins` and `libunwind` are compiled into the binary, and the
exception the LLVM Project adds to the Apache License 2.0 lets their
compiled form be redistributed embedded so without the notices of its
sections 4(a), 4(b) and 4(d). The license and the exception are at
<https://llvm.org/LICENSE.txt>.

## Unicode License v3

```
UNICODE LICENSE V3

COPYRIGHT AND PERMISSION NOTICE

Copyright © 1991-2026 Unicode, Inc.
Copyright © 2004-2025 Unicode, Inc.

NOTICE TO USER: Carefully read the following legal agreement. BY
DOWNLOADING, INSTALLING, COPYING OR OTHERWISE USING DATA FILES, AND/OR
SOFTWARE, YOU UNEQUIVOCALLY ACCEPT, AND AGREE TO BE BOUND BY, ALL OF THE
TERMS AND CONDITIONS OF THIS AGREEMENT. IF YOU DO NOT AGREE, DO NOT
DOWNLOAD, INSTALL, COPY, DISTRIBUTE OR USE THE DATA FILES OR SOFTWARE.

Permission is hereby granted, free of charge, to any person obtaining a
copy of data files and any associated documentation (the "Data Files") or
software and any associated documentation (the "Software") to deal in the
Data Files or Software without restriction, including without limitation
the rights to use, copy, modify, merge, publish, distribute, and/or sell
copies of the Data Files or Software, and to permit persons to whom the
Data Files or Software are furnished to do so, provided that either (a)
this copyright and permission notice appear with all copies of the Data
Files or Software, or (b) this copyright and permission notice appear in
associated Documentation.

THE DATA FILES AND SOFTWARE ARE PROVIDED "AS IS", WITHOUT WARRANTY OF ANY
KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT OF
THIRD PARTY RIGHTS.

IN NO EVENT SHALL THE COPYRIGHT HOLDER OR HOLDERS INCLUDED IN THIS NOTICE
BE LIABLE FOR ANY CLAIM, OR ANY SPECIAL INDIRECT OR CONSEQUENTIAL DAMAGES,
OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS OF USE, DATA OR PROFITS,
WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER TORTIOUS ACTION,
ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF THE DATA
FILES OR SOFTWARE.

Except as contained in this notice, the name of a copyright holder shall
not be used in advertising or otherwise to promote the sale, use or other
dealings in these Data Files or Software without prior written
authorization of the copyright holder.
```
