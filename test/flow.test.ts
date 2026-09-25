import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadValidator() {
  const schema = JSON.parse(await readFile(path.join(__dirname, "..", "schema", "flow.schema.json"), "utf-8"));
  const ajv = new Ajv2020({ strict: true });
  return ajv.compile(schema);
}

test("flow: a well-formed example passes", async () => {
  const validate = await loadValidator();
  const ok = validate({
    schema_version: 1,
    id: "flow_01J8Q7K2X9",
    name: "whatsapp.reply_in_open_chat",
    version: 1,
    target: { package: "com.whatsapp" },
    params: [{ name: "message", type: "string", secret: false, required: true }],
    steps: [
      { id: "s1", op: "launch_app", params: { package: "com.whatsapp" } },
      { id: "s2", op: "wait_until", params: { selector: { text: "Chats" }, timeout_ms: 5000 } },
      { id: "s3", op: "tap", params: { selector: { resource_id: "com.whatsapp:id/entry" } } },
      { id: "s4", op: "type_text", params: { selector: { resource_id: "com.whatsapp:id/entry" }, text: "{{message}}" } },
    ],
  });
  assert.equal(ok, true, `expected a valid flow: ${JSON.stringify(validate.errors)}`);
});

test("flow: a step op outside the 7-op closed set fails", async () => {
  const validate = await loadValidator();
  const ok = validate({
    schema_version: 1,
    id: "flow_1",
    name: "n",
    version: 1,
    params: [],
    steps: [{ id: "s1", op: "assert", params: { selector: { text: "x" } } }],
  });
  assert.equal(ok, false, "expected an unsupported op to fail validation");
});

test("flow: missing required top-level field fails", async () => {
  const validate = await loadValidator();
  const ok = validate({
    schema_version: 1,
    id: "flow_1",
    name: "n",
    // version missing
    params: [],
    steps: [{ id: "s1", op: "tap", params: {} }],
  });
  assert.equal(ok, false);
});
