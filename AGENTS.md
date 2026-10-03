# AGENTS.md

Behavioral guidelines for LLM coding assistants working on the
**curly-message lint** repository. Applies to anything that drives commits,
PRs, or file edits on this repo.

**Precedence:** These repo rules override individual LLM memory or personal
preference. If your own memory conflicts with this file, follow this file.

Everything this repository expects is in this file; it defers to nothing
outside it. The sections before the numbered ones are what is particular to
this repository; sections 1-14 are the working rules.

---

## The repository

A linter for the [Curly Message Format](https://github.com/curly-message/spec),
in two packages:

- **`lint/`** — `@curly-message/lint`: the rules, a library over them and the
  `curly-lint` command.
- **`eslint-plugin/`** — `@curly-message/eslint-plugin`: the rules a single
  message decides, as ESLint rules. It depends on `@curly-message/lint`.

They are **npm workspaces** of one root, because the plugin depends on the
library and both change together: one lockfile at the root, one install
(`npm ci`), each workspace with its own build, tests, README, CHANGELOG,
LICENSE and version line. Release tags are namespaced by workspace —
`lint-v1.0.0`, `eslint-plugin-v1.0.0` — and the publish workflow cuts them
(`.github/workflows/publish.yml`; the README's Releasing section says what it
does).

The lockfile is written with **npm 11** (`npx npm@11 install`). npm 10 fails to
resolve this workspace's peer dependencies, though it installs from the
lockfile (`npm ci`) as CI's Node 22 does.

## The format decides, not the linter

- **The specification is normative.** A rule about a message finds what the
  specification says renders other than its author meant, and names the
  section it rests on. A rule the specification does not back is a rule about
  taste, and does not belong here. The specification leaves catalogues to the
  host (section 1), so a rule about one finds what reading the catalogue loses
  — a message one locale has and another lacks, the one of two under an id
  that is never read — and names no section.
- **The linter agrees with the parser.** It reads a message through
  `@curly-message/parser`'s `cst`, so what it calls a placeholder is what
  resolution calls one. Where a rule needs a reading `cst` does not give — what
  `eq` compares, what `plural` takes for a number — it follows the parser's
  reading of the specification, and a disagreement is a bug in one of them:
  decide which and say so.
- **No payload.** Every rule is decidable from a message, its locale, or a
  catalogue. What a payload decides is the parser's to report while it
  resolves.

---

## 1. Think before coding

**Don't guess. Don't hide confusion. Surface tradeoffs.**

- State assumptions explicitly; if unsure, ask. Clarifying questions belong in
  chat **before** mistakes show up in the diff.
- If multiple interpretations exist, present them — don't pick silently.
- For non-trivial changes, propose the plan in chat **before** touching files.
- **Refetch before reasoning, don't recall.** In long sessions, fetch current
  state (PR/issue meta, branch state, file content, CI status) instead of
  trusting memory.

## 2. Simplicity first

Minimum code that solves the problem. No speculative features or abstractions.
A linter **never throws on a message**: any string is a message it can read,
and a file that is not JSON is a finding, not a crash.

## 3. Surgical changes

**Touch only what you must. Match existing style even if you'd write it
differently.**

- Don't "improve" adjacent code/formatting unrelated to the task.
- Remove only the imports/vars/types **your** change orphaned.
- Notice unrelated dead code or a bug? **Mention it in chat** — don't fix
  silently in the same PR.

## 4. Verify before committing

**Every commit's tip is green.**

- From the root, `npm test` builds, typechecks, lints and tests every
  workspace, and it is what CI runs. Report real output — never claim done
  without running it.
- Type/lint/build errors never reach a commit, not even WIP.

## 5. Commit on approval

**Local changes are the default. Committing is the user's call.**

- Respond to requests by editing **locally**; show the diff; ask "ok?".
- Commit only after explicit approval ("ok", "commit it", "create the commit",
  or a fixup request).
- **Approval is scoped to the named changes.**

## 6. Incremental commits & fixup hygiene

- **One concern per commit.** Each commit is self-contained and lands code in
  its **final form**.
- Refinement of something this branch already introduced →
  `git commit --fixup=<sha>` + `git rebase -i --autosquash`, not an "address
  review" commit.
- Commit messages: imperative mood, `type(scope): summary`. Scope the
  workspace when the change is inside one (`feat(lint): …`,
  `fix(eslint-plugin): …`); leave it off for root-level changes.

## 7. Branch & push discipline

- **Default branch is `main`.** Never commit straight to it; never force-push
  a shared branch.
- **`main` carries only finished product.**
- Branch from `main` with a descriptive prefix: `fix/<slug>`, `feat/<slug>`,
  `chore/<slug>`, `docs/<slug>`. Rebase on `main` before pushing; on
  conflicts, **stop and ask**.

## 8. PRs

- **Open a PR only when explicitly asked.** Keep it narrowly scoped; list
  out-of-scope follow-ups under `## Notes`.
- Title ≤ 70 chars. Body: a short summary + what was tested (real results),
  and the linked issue via closing keywords when one exists.
- **Keep PR meta in lockstep with the branch.**

## 9. Docs track code

Update docs in the same PR that invalidates them: this file, the root
`README.md`, and each workspace's `README.md` and `CHANGELOG.md`. Each
workspace's README lists every rule, and a test holds it to `RULES`. A new
rule is a row in `RULES`, a section in `lint/README.md`, and — where a single
message decides it — a row in `eslint-plugin/README.md`.

## 10. Coding conventions

- Formatting contract (the `@stylistic` block in `eslint.config.js`: 2-space
  indent, single quotes, semicolons, trailing commas on multiline, spaced
  object braces, no trailing whitespace, at most one consecutive blank line,
  newline at EOF). `npm run lint` reports what breaks it; `npm run lint:fix`
  handles it.
- In `lint/src/`: `rules.ts` is the table of rules, `tree.ts` reads a message
  off the parser's tree, `message.ts` and `catalogue.ts` are the rules,
  `read.ts` and `locale.ts` read files and paths, `run.ts` is the command and
  `cli.ts` only starts it.
- A finding's message is English, says what is wrong and what happens instead,
  and quotes what it is about in backticks.
- Write a character outside ASCII in a regular expression or a string as an
  escape, never as itself: a literal line separator is invisible to review and
  ends a JavaScript line.

## 11. Robustness posture

The linter reads catalogues a project does not control in full, and runs in
editors on every keystroke.

- **Bounded work.** What a rule does grows with the message, never with a
  value outside it. A rule that walks the tree walks it once, and a catalogue
  is read up to a million messages, however often it holds one object.
- **Prototype keys are names.** A catalogue's `__proto__` member is a member;
  read an object's own data members, or read onto a null prototype.
- **No host code.** The linter calls no function a catalogue holds, an
  accessor included.

## 12. Comments & language

- Default to **no** comment; code says *what*, comments say *why*. Never
  reference the current task, a fixed bug, or a PR number.
- **All committed/published artifacts in English.** Chat may stay in the
  user's preferred language; the moment it crosses into something on GitHub,
  switch to English.

## 13. Tests

- `lint/tests/` drives the rules through `lintMessage` and `lintCatalogue`,
  the reader through `readCatalogue`, and the command through `run` from
  `src/run.ts`. `eslint-plugin/tests/` drives the plugin through ESLint's own
  `Linter`.
- A rule's test shows what it finds and what it leaves alone: the near miss
  is the test.
- **Bug fixes are test-driven (red → green).** Confirm the test fails against
  the unfixed code, then fix.

## 14. Output style

- Terse. Lead with results.
- **No emojis** in code, commit messages, or PR descriptions unless requested.

---

**These guidelines are working if:** PRs review easily, commits read as a
single coherent story, and a rule never reports what the specification allows
or misses what it says renders wrong.
