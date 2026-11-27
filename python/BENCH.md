## Benchmark of curly-message-lint

Node v24.22.3, linux x64. A time is per run: the median of 20 samples, and the range of the samples without their fastest and slowest quarter.

| Row | Kind | 1.0.0rc0 | |
|---|---|--:|---|
| the wheel | size | 486,495 B |  |
| the sdist | size | 77,452 B |  |
| curly-lint: the command, installed | size | 1,176,064 B |  |
| files in the wheel | count | 7 |  |
| curly-lint: a report of 20 000 findings, written to a regular file | time | 43.6 ms (40.4 ms–47.6 ms) |  |
| curly-lint: 5 000 messages in two locales, beside a file of a third that is not JSON | time | 71.2 ms (71 ms–71.4 ms) |  |

Passed; nothing was compared.
