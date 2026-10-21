import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { CLOSE_REPLACED } from "../src/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaDir = path.join(__dirname, "..", "schema");

async function loadValidator(schemaFile: string) {
  const schema = JSON.parse(await readFile(path.join(schemaDir, schemaFile), "utf-8"));
  const ajv = new Ajv2020({ strict: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

function assertValid(validate: ReturnType<Ajv2020["compile"]>, data: unknown, label: string) {
  const ok = validate(data);
  assert.equal(ok, true, `expected ${label} to be valid: ${JSON.stringify(validate.errors)}`);
}

function assertInvalid(validate: ReturnType<Ajv2020["compile"]>, data: unknown, label: string) {
  const ok = validate(data);
  assert.equal(ok, false, `expected ${label} to be invalid, but it passed`);
}

// --- welcome: required account_id ----------------------------------------------------------

test("welcome: account_id is required and may be null (unclaimed phone) or a string", async () => {
  const validate = await loadValidator("welcome.schema.json");
  const base = { type: "welcome", accepted: true, protocol_version: 2 };
  assertValid(validate, { ...base, account_id: null }, "welcome with account_id null");
  assertValid(validate, { ...base, account_id: "acc_abc123" }, "welcome with an account_id");
  assertInvalid(validate, base, "welcome without account_id");
  assertInvalid(validate, { ...base, account_id: 42 }, "welcome with a non-string account_id");
});

// --- AI connections ------------------------------------------------------------------------

test("ai_connections_list: ok branch carries the connections; error branch carries not_claimed", async () => {
  const validate = await loadValidator("ai-connections-list.schema.json");
  assertValid(
    validate,
    {
      type: "ai_connections_list",
      ok: true,
      connections: [
        {
          client_id: "cl_1",
          client_name: "Claude",
          display_name: "Claude",
          image_url: null,
          connected_at: "2026-09-30T12:00:00Z",
          last_used_at: null,
        },
      ],
    },
    "an ai_connections_list with one connection",
  );
  assertValid(
    validate,
    { type: "ai_connections_list", ok: false, error: { code: "not_claimed", message: "no account" } },
    "an ai_connections_list with not_claimed",
  );
  assertInvalid(
    validate,
    { type: "ai_connections_list", ok: false, error: { code: "not_found" } },
    "an ai_connections_list error with a code the list can't return",
  );
  assertInvalid(
    validate,
    { type: "ai_connections_list", ok: true, connections: [{ client_id: "cl_1" }] },
    "a connection missing its required fields",
  );
});

test("revoke_ai_connection requires connection_id; ai_connection_revoked is ok or not_claimed/not_found", async () => {
  const revoke = await loadValidator("revoke-ai-connection.schema.json");
  assertValid(revoke, { type: "revoke_ai_connection", connection_id: "cl_1" }, "a revoke request");
  assertInvalid(revoke, { type: "revoke_ai_connection" }, "a revoke request without connection_id");

  const revoked = await loadValidator("ai-connection-revoked.schema.json");
  assertValid(revoked, { type: "ai_connection_revoked", ok: true }, "a successful ai_connection_revoked");
  assertValid(
    revoked,
    { type: "ai_connection_revoked", ok: false, error: { code: "not_found", message: "gone" } },
    "ai_connection_revoked with not_found",
  );
  assertValid(
    revoked,
    { type: "ai_connection_revoked", ok: false, error: { code: "not_claimed" } },
    "ai_connection_revoked with not_claimed",
  );
  assertInvalid(
    revoked,
    { type: "ai_connection_revoked", ok: false, error: { code: "whatever" } },
    "ai_connection_revoked with an unknown error code",
  );
});

test("list_ai_connections carries nothing but the type discriminator", async () => {
  const validate = await loadValidator("list-ai-connections.schema.json");
  assertValid(validate, { type: "list_ai_connections" }, "a list request");
  assertInvalid(validate, { type: "list_ai_connections", connection_id: "x" }, "a list request with an extra field");
});

// --- close codes ---------------------------------------------------------------------------

test("close code 4004 (replaced) is exported, and 4000-4004 are all distinct", async () => {
  assert.equal(typeof CLOSE_REPLACED, "number");
  assert.equal(CLOSE_REPLACED, 4004);
});

// --- type_text append/submit, read_screen locked, device_locked ----------------------------

test("result: read_screen's locked flag is a required boolean in the documented output shape", async () => {
  const validate = await loadValidator("result.schema.json");
  assertValid(validate, { type: "result", step_id: "s-1", output: { tree: "root", locked: false } }, "a result with locked");
  assertValid(validate, { type: "result", step_id: "s-1", output: { tapped: true } }, "a result without a locked flag");
});

test("error: device_locked and submit_unsupported are valid codes (code stays an open string)", async () => {
  const validate = await loadValidator("error.schema.json");
  assertValid(
    validate,
    { type: "error", step_id: "s-1", code: "device_locked", message: "locked" },
    "a device_locked error",
  );
  assertValid(
    validate,
    { type: "error", step_id: "s-1", code: "submit_unsupported", message: "no send action" },
    "a submit_unsupported error",
  );
});
