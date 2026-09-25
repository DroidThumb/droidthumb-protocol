# Changelog

Every change to the wire protocol or flow-step schema, in enough detail that `droidthumb-android`
(M2) can implement against it without reading the diff. Not a general commit log — skip anything
that doesn't change a schema, a generated type, or a tool this package ships.

## Unreleased

- Added `schema/flow.schema.json` (`Flow`, `Param`, `FlowStep` generated types) — a saved,
  replayable sequence of steps (design doc §7.1), trimmed for the MVP: `FlowStep.op` is a closed
  enum of the 7 ops `droidthumb-server`'s M1 MCP surface exposes (`read_screen`, `tap`,
  `type_text`, `scroll_find`, `key`, `launch_app`, `wait_until`) rather than the full §7.2
  vocabulary — no branching, `call_flow`, `request_draft`, or signing yet. `params` declares named
  variables (`name`, `type`, `required`, `secret`); a step's own `params` object may reference one
  by an exact whole-string `"{{name}}"` value (not general string interpolation — see
  `droidthumb-server`'s decisions log for why). `droidthumb-server`'s `save_flow` produces these;
  `run_flow` replays them server-side, one step at a time, against the device — there is no
  on-device flow cache or executor yet (that's the design doc's device-side plan for later; MVP
  explicitly allows server-driven replay instead).

## M1 — fake device

- Added `tools/fake-device`: a scriptable stand-in device for `droidthumb-server`'s tests. Not a
  protocol change — internal to this repo's test story — but recorded here since it's the
  reference implementation of client-side handshake behaviour (`hello` → awaits `welcome`, closes
  on rejection) other clients (eventually `droidthumb-android`) should match.

## M0 — protocol skeleton

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
