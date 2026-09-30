# droidthumb-protocol

Public, MIT-licensed. This repo is the wire protocol (device ↔ server WebSocket messages) and
flow-step schema for DroidThumb, defined as JSON Schema (2020-12) with generated TypeScript types.
It has no runtime logic of its own — just schemas, codegen, and (later) a fake device for
`droidthumb-server` to test against.

## Where the spec lives

This repo doesn't restate the spec — read it in the sibling `droidthumb-server` repo:

- `droidthumb-server/docs/droidthumb-design-doc.md` — the design doc. §4.1 (message schemas),
  §7.2 (step vocabulary), §7.3 (selectors), §7.4 (wire protocol) are the sections that matter here.
- `droidthumb-server/docs/plans/` — dated build plans. Each plan states which design-doc revision
  and milestones it covers; check that against the current plan before assuming a doc detail is
  still current.

## Conventions

- Commit messages use conventional-commit prefixes (`feat:`, `fix:`, `test:`, `docs:`, `chore:`,
  `refactor:`). No AI-attribution lines (co-author trailers, tool names, session links) in commit
  messages or code comments — this applies to commits made by AI agents working in this repo too.
- New or changed schema needs a test: the schema validates against the JSON Schema 2020-12
  meta-schema, and at least one valid and one invalid example round-trip through it as expected.
- `src/generated/` is codegen output (`npm run generate`) and is gitignored — never hand-edit it,
  never commit it.
- `schema/*.schema.json` is the source of truth; `src/generated/` and any Kotlin types elsewhere
  are derived from it, not the other way round.
- Keep this package buildable as a `file:` dependency: don't add anything to `dependencies` that
  isn't needed at runtime by a consumer, and don't assume a monorepo tool is available.
- Every schema/protocol change needs a `CHANGELOG.md` entry (see that file's own header).

## Deploy/review workflow (`droidthumb-server` plan 03 milestone 1 onward)

One PR, never merged by whoever opened it — the founder reviews and merges. This repo's own CI has
no staging/APK step (it's a schema/codegen package, nothing to deploy) — `droidthumb-server`'s CI
checks out this repo's `main` as a sibling for its own staging/production builds, so a
`droidthumb-server` PR that depends on an unmerged protocol PR won't reflect it until the protocol
PR is merged first. Merge order matters when a change spans both repos.
