## Benchmark of @curly-message/lint

Node v24.22.3, linux x64. A time is per run: the median of 20 samples, and the range of the samples without their fastest and slowest quarter.

| Row | Kind | 1.0.0 | |
|---|---|--:|---|
| dist/*.js | size | 522,339 B |  |
| dist/*.js, gzipped | size | 207,021 B |  |
| dist/index.js and the chunks it imports | size | 520,372 B |  |
| catalogue reads: linting 1 000 messages in two locales | count | 4,067 |  |
| curly-lint: file system calls, a pattern over a tree with links | count | 114 |  |
| curly-lint: file system calls, a directory given as it is, over the same tree | count | 105 |  |
| curly-lint: a report of 20 000 findings, written to a regular file | time | 217 ms (215 ms–220 ms) |  |
| curly-lint: 5 000 messages in two locales, beside a file of a third that is not JSON | time | 241 ms (239 ms–246 ms) |  |
| lintMessage: one message, in a process that loads the library for it | time | 42.7 ms (41.3 ms–44.2 ms) |  |
| lintMessage: five catalogue messages, with their locale | time | 55 µs (54.7 µs–55.8 µs) |  |
| lintMessage: 20 000 unclosed placeholders | time | 9.34 ms (9.22 ms–11.1 ms) |  |
| lintMessage: a selection of 20 000 options | time | 10.8 ms (10.7 ms–10.8 ms) |  |
| lintCatalogue: 20 000 placeholders and a plural of 40 000 keys, in two locales | time | 160 ms (158 ms–161 ms) |  |
| lintCatalogue: 1 000 messages in two locales | time | 18.8 ms (18.3 ms–19.7 ms) |  |
| lintCatalogue: 10 000 messages in two locales | time | 189 ms (186 ms–195 ms) |  |
| lintCatalogue: 5 000 messages under each of two spellings of one locale | time | 72.6 ms (72 ms–75.9 ms) |  |
| readCatalogue: 10 000 messages of JSON | time | 31.6 ms (30 ms–33.1 ms) |  |

Passed; nothing was compared.

The core was compiled by rustc 1.100.0 (0ef1bc386 2026-11-09).
