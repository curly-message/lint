## Benchmark of curly-message-lint

Node v24.22.3, linux x64. A time is per run: the median of 20 samples, and the range of the samples without their fastest and slowest quarter.

| Row | Kind | 1.0.0 | |
|---|---|--:|---|
| curly-message-lint.crate | size | 71,824 B |  |
| curly-lint: the command, stripped | size | 1,153,320 B |  |
| curly-lint, gzipped | size | 463,032 B |  |
| crates: the linter's dependency tree | count | 3 |  |
| crates: the linter's dependency tree without cldr | count | 3 |  |
| curly-lint: a report of 20 000 findings, written to a regular file | time | 38.3 ms (37.3 ms–39.3 ms) |  |
| curly-lint: 5 000 messages in two locales, beside a file of a third that is not JSON | time | 55.9 ms (55.7 ms–56.1 ms) |  |
| command: host calls, a pattern over three locales of three namespaces of three files | count | 42 |  |
| command: host calls, a directory given as it is, over the same tree | count | 46 |  |
| lint_message: five catalogue messages, with their locale, 1000 times | time | 15.3 ms (15.2 ms–15.4 ms) |  |
| lint_message: 20 000 unclosed placeholders | time | 4.14 ms (4.13 ms–4.14 ms) |  |
| lint_message: a selection of 20 000 options | time | 5.67 ms (5.59 ms–5.81 ms) |  |
| lint_message: nested 250 levels, 10 times | time | 1.8 ms (1.78 ms–1.81 ms) |  |
| lint_entries: 1 000 messages in two locales | time | 8.19 ms (8.17 ms–8.21 ms) |  |
| lint_entries: 5 000 messages under each of two spellings of one locale | time | 34.2 ms (33.9 ms–34.3 ms) |  |
| read_catalogue: a file of 1 000 messages, 10 times | time | 4.56 ms (4.53 ms–4.87 ms) |  |

Passed; nothing was compared.
