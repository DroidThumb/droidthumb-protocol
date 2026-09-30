# Protocol examples

One directory per **supported** `protocol_version` (`v1/`, `v2/`, …), plus `protocol-versions.json`
naming which versions exist and which the server must accept:

```json
{ "current": 1, "supported": [1] }
```

`droidthumb-server` reads `supported` as the set of `protocol_version`s it accepts, so this file is
the single source of truth for compatibility (policy: design doc §9.8 in `droidthumb-server`).

## File naming

`<message>.<valid|invalid>[.<label>].json`, where `<message>` is the schema's file name without
`.schema.json` (`hello`, `welcome`, `challenge-response`, …). Every supported version must carry at
least one valid and one invalid example of every message in `test/protocol-versions.test.ts`.

## Rules

- **Never edit or delete an example under a supported version to make a schema change pass.** The
  examples are what already-shipped apps actually send; a schema change that rejects one is a
  breaking change and needs a new `protocol_version` (and a CHANGELOG entry), not an edited example.
  Adding examples is always fine.
- `hello.valid.legacy.json` / `welcome.valid.legacy.json` are the shapes sent before
  `android_version`/`device_model` and the welcome update fields existed. They stay valid.
- When a version is retired (removed from `supported`), delete its directory in the same change.
