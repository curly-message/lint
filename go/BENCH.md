## Benchmark of github.com/curly-message/lint-go

Node v24.22.3, linux x64. A time is per run: the median of 20 samples, and the range of the samples without their fastest and slowest quarter.

| Row | Kind | 1.0.1 | |
|---|---|--:|---|
| the module zip | size | 2,772,711 B |  |
| curly-lint: the launcher, installed | size | 3,949,691 B |  |
| modules the launcher is built from | count | 1 |  |
| curly-lint: --help, the command kept already | time | 3.99 ms (3.93 ms–4.02 ms) |  |
| curly-lint: a report of 20 000 findings, written to a regular file | time | 62.3 ms (62.1 ms–62.9 ms) |  |
| curly-lint: 5 000 messages in two locales, beside a file of a third that is not JSON | time | 109 ms (108 ms–111 ms) |  |

Passed; nothing was compared.
