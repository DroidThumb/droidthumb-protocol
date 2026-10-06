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

- **Never start new feature work while an earlier PR in this repo is still unmerged, unless the
  founder asks for it.** Finish and merge what's open first. If asked to work ahead anyway, say so
  explicitly rather than silently stacking.
- **No stacked PRs (a branch based on another open PR's branch) unless the founder asks.** A
  stacked PR has no base to merge into until the one below it merges, and CI workflows that trigger
  only on PRs to `main` won't even run for it — found live, 2026-10-06, in `droidthumb-server`,
  after a stacked PR's base branch got accidentally merged into instead of `main`.
- **Design-doc and decisions-log changes (both live in `droidthumb-server`) land in the same PR as
  the code they describe, not a separate PR** — splitting them risks the two drifting apart across
  branches that merge in a different order than planned.

## Protocol versions and examples

`examples/protocol-versions.json` is the single source of truth for which `protocol_version`s exist
and which the server accepts (`droidthumb-server` reads it; policy is design doc §9.8 there: N and
N−1 only). One `examples/v<N>/` directory per supported version, never edited to make a schema change
pass — see `examples/README.md`. A schema change an already-shipped app would fail on needs a new
`protocol_version`, not an edit. Any new schema for a wire message needs examples in every supported
version's directory (and an entry in the required list in `test/protocol-versions.test.ts`), and the
fake device (`tools/fake-device`) must be able to speak every supported version.
