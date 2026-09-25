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

function wellFormedEvent() {
  return {
    type: "notification",
    timestamp: "2026-09-25T12:00:00Z",
    data: {
      eventType: "posted",
      notificationId: "0|com.whatsapp|1|null|10123",
      packageName: "com.whatsapp",
      appName: "WhatsApp",
      title: "Alex",
      text: "WinWise",
      bigText: null,
      subText: null,
      timestamp: 1758801600000,
      isOngoing: false,
      isClearable: true,
      category: "msg",
      groupKey: null,
      actions: [{ actionId: "reply", index: 0, title: "Reply", acceptsText: true }],
    },
  };
}

test("notification-event: a well-formed example (matching droidthumb-android's actual ChannelEvent envelope) passes", async () => {
  const validate = await loadValidator();
  const event = wellFormedEvent();
  const ok = validate(event);
  assert.equal(ok, true, `expected a valid notification event: ${JSON.stringify(validate.errors)}`);
});

test("notification-event: nullable data fields (title/text/bigText/subText/category/groupKey) as null still pass", async () => {
  const validate = await loadValidator();
  const event = wellFormedEvent();
  event.data.title = null;
  event.data.text = null;
  const ok = validate(event);
  assert.equal(ok, true, `expected null title/text to be valid: ${JSON.stringify(validate.errors)}`);
});

test("notification-event: missing data.packageName fails", async () => {
  const validate = await loadValidator();
  const event = wellFormedEvent() as { data: Record<string, unknown> };
  delete event.data["packageName"];
  const ok = validate(event);
  assert.equal(ok, false);
});

test("notification-event: wrong top-level type fails", async () => {
  const validate = await loadValidator();
  const event = { ...wellFormedEvent(), type: "wifi" };
  const ok = validate(event);
  assert.equal(ok, false);
});

test("notification-event: the old flat shape (package/sender/text at top level) no longer validates", async () => {
  const validate = await loadValidator();
  const ok = validate({ package: "com.whatsapp", sender: "Alex", text: "hi" });
  assert.equal(ok, false);
});
