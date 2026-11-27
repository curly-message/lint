## Benchmark of github.com/curly-message/lint-go

Node v24.22.3, linux x64. A time is per run: the median of 20 samples, and the range of the samples without their fastest and slowest quarter.

| Row | Kind | 1.0.0 | |
|---|---|--:|---|
| the module zip | size | 2,771,305 B |  |
| curly-lint: the launcher, installed | size | 3,948,564 B |  |
| modules the launcher is built from | count | 1 |  |
| curly-lint: --help, the command kept already | time | 3.33 ms (3.31 ms–3.4 ms) |  |
| curly-lint: a report of 20 000 findings, written to a regular file | time | 56.1 ms (54.3 ms–70.8 ms) |  |
| curly-lint: 5 000 messages in two locales, beside a file of a third that is not JSON | time | 87.6 ms (87 ms–88.6 ms) |  |

Passed; nothing was compared.
