import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function loadValidator() {
  const schema = JSON.parse(
    await readFile(path.join(__dirname, "..", "schema", "notification-event.schema.json"), "utf-8"),
  );
  const ajv = new Ajv2020({ strict: true });
  addFormats(ajv);
  return ajv.compile(schema);
}

test("notification-event: a well-formed example passes", async () => {
  const validate = await loadValidator();
  const ok = validate({
    device_id: "d-1",
    package: "com.whatsapp",
    sender: "Alex",
    text: "WinWise",
    posted_at: "2026-09-25T12:00:00Z",
  });
  assert.equal(ok, true, `expected a valid notification event: ${JSON.stringify(validate.errors)}`);
});

test("notification-event: package alone is sufficient (everything else optional)", async () => {
  const validate = await loadValidator();
  const ok = validate({ package: "com.whatsapp" });
  assert.equal(ok, true);
});

test("notification-event: missing package fails", async () => {
  const validate = await loadValidator();
  const ok = validate({ sender: "Alex", text: "hi" });
  assert.equal(ok, false);
});
