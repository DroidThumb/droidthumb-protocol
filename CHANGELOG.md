# Changelog

Every change to the wire protocol or flow-step schema, in enough detail that `droidthumb-android`
(M2) can implement against it without reading the diff. Not a general commit log — skip anything
that doesn't change a schema, a generated type, or a tool this package ships.

## 2.0.0

Protocol version 2 — the current and only supported protocol version
(`{"current": 2, "supported": [2]}`). Version 1 is retired: every schema, message and example now
describes and uses protocol version 2, and all version 1 examples are gone.

- **Account claiming and device replacement (`claim_account`/`claimed`/`claim_rejected`).**
  - `claim_account` (device → server) requires `install_hint` (Android's per-app device ID,
    ANDROID_ID; the server keeps only a keyed hash of it and uses it to recognise the same phone
    after a reinstall) and carries an optional `replace_device_id`. When given, this
    phone claims the account in place of the device with that id; that device is retired and, if
    connected, closed with the new WebSocket close code 4004 (`replaced`, exported as
    `CLOSE_REPLACED` from `src/close-codes.ts`).
  - `claim_rejected` (server → device) reasons are now `already_claimed`, `invalid_token`,
    `device_limit_reached` (with a required `devices` array listing the account's current devices:
    `device_id`, `name`, `model`, `last_seen`) and `unknown_device` (when `replace_device_id`
    doesn't name one of the account's phones).
- **AI connection management (new message pair).**
  - `list_ai_connections` (device → server) and `ai_connections_list` (server → device) list the
    claiming account's AI connections (`client_id`, `client_name`, `display_name`, `image_url`,
    `connected_at`, `last_used_at`).
  - `revoke_ai_connection` (device → server) and `ai_connection_revoked` (server → device) revoke
    one connection by `connection_id`.
  - Error branches carry `not_claimed` (no account has claimed the phone) or `not_found`
    (`connection_id` isn't one of the claiming account's connections).
- **Step changes.**
  - `type_text` params gain `append` (boolean, default false: the text replaces the field's
    content) and `submit` (boolean, default false: after typing, send the keyboard's own action,
    such as Search or Go). The previous `clear` option is gone.
  - `read_screen` results gain a required boolean `locked` (true when the phone is locked — a
    locked screen yields no usable tree, so the server can ask the user to unlock).
- **Error codes.** `schema/error.schema.json` documents `submit_unsupported` (the phone can't send
  the keyboard's own action that `type_text`'s `submit` asks for), `device_locked` (the phone is
  locked, so the action can't run), `not_claimed` (no account has claimed this phone) and
  `not_found` (the connection isn't one of the claiming account's connections).
- **The WebSocket subprotocol is now `droidthumb.v2`** (`SUBPROTOCOL`, exported from this package).
- **Examples.** Every supported version's examples live in `examples/v2/` — one valid and one
  invalid example per message, covering every new and changed shape: claim reasons (including
  `device_limit_reached` and `unknown_device`), AI connection list and revoke (including
  `not_claimed` and `not_found`), `type_text` with `append`/`submit`, `read_screen` with `locked`,
  and the new error codes.

## M5 — notification trigger endpoint (superseded above, kept for history)

- Added `schema/notification-event.schema.json` (`NotificationEvent` generated type) — device →
  server, but a plain HTTP POST outside the WebSocket handshake family, not a `hello`/`step`-style
  message (no `type` discriminator; it's the only shape its endpoint accepts). This is the wire
  shape for the design doc's Event Channel (D-20/§6.1) reaching `droidthumb-server`'s trigger
  endpoint. **The design doc names the Event Channel's existence but never specifies a payload
  shape for it** — this schema (`package` required; `device_id`, `sender`, `text`, `posted_at` all
  optional) is this repo's own addition, not a transcription of an existing spec. `sender` is the
  notification's title (contact/sender name in the common case); `text` is its body.

## M4 — flow document schema

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
