## Benchmark of curly-message/lint

Node v24.22.3, linux x64. A time is per run: the median of 20 samples, and the range of the samples without their fastest and slowest quarter.

| Row | Kind | 1.0.0 | |
|---|---|--:|---|
| the archive Composer downloads | size | 2,248,857 B |  |
| curly-lint: the launcher | size | 2,529 B |  |
| packages a project installs with it | count | 1 |  |
| curly-lint: --help, through vendor/bin | time | 51.2 ms (50.2 ms–52.2 ms) |  |
| curly-lint: a report of 20 000 findings, written to a regular file | time | 109 ms (109 ms–110 ms) |  |
| curly-lint: 5 000 messages in two locales, beside a file of a third that is not JSON | time | 155 ms (154 ms–156 ms) |  |

Passed; nothing was compared.
