# Changelog

Every change to the wire protocol or flow-step schema, in enough detail that `droidthumb-android`
(M2) can implement against it without reading the diff. Not a general commit log — skip anything
that doesn't change a schema, a generated type, or a tool this package ships.

## Unreleased

- Added `tools/fake-device`: a scriptable stand-in device for `droidthumb-server`'s tests. Not a
  protocol change — internal to this repo's test story — but recorded here since it's the
  reference implementation of client-side handshake behaviour (`hello` → awaits `welcome`, closes
  on rejection) other clients (eventually `droidthumb-android`) should match.

## 0.1.0 — M0 protocol skeleton

- Six wire-message schemas added under `schema/`: `hello`, `welcome`, `step`, `result`, `error`,
  `file-reference`. Every wire message (`hello`, `welcome`, `step`, `result`, `error`) carries a
  `type` const discriminator; `file-reference` is a reusable sub-shape, not a top-level message.
- `welcome` is new relative to the design doc's illustrative wire protocol (§7.4): server → device,
  replies to `hello` once a connection is accepted. `accepted` is always `true` — a rejection never
  sends `welcome` at all, the connection is closed with a WS close code instead (see
  `droidthumb-server`'s handshake: 4000 = expected `hello` first, 4001 = unsupported
  `protocol_version`).
- `step.op` is an open string, not an enum, for M0/M1 — it's one of the small subset of op names
  the current server milestone exposes on its MCP surface, not the full closed step vocabulary
  (design doc §7.2) and not a raw Android handler name.
- `file-reference` carries both the `inline` (base64) and `url` forms from v0, per D-21 — only
  `inline` is implemented anywhere yet.
- TypeScript types generated from the schemas via `npm run generate`, exported from the package
  root; no `any` anywhere in generated output.
