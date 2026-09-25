import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

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

// --- hello ---------------------------------------------------------------

test("hello: valid example passes", async () => {
  const validate = await loadValidator("hello.schema.json");
  assertValid(
    validate,
    {
      type: "hello",
      protocol_version: 1,
      apk_version: "0.1.0",
      device_id: "pixel-8-abc123",
      capabilities: ["a11y_tree"],
      mode: "live",
      flow_manifest: [],
    },
    "a well-formed hello",
  );
});

test("hello: missing required field fails", async () => {
  const validate = await loadValidator("hello.schema.json");
  assertInvalid(
    validate,
    {
      type: "hello",
      protocol_version: 1,
      apk_version: "0.1.0",
      device_id: "pixel-8-abc123",
      capabilities: ["a11y_tree"],
      // mode is missing
      flow_manifest: [],
    },
    "a hello missing mode",
  );
});

test("hello: wrong type discriminator fails", async () => {
  const validate = await loadValidator("hello.schema.json");
  assertInvalid(
    validate,
    {
      type: "welcome",
      protocol_version: 1,
      apk_version: "0.1.0",
      device_id: "pixel-8-abc123",
      capabilities: [],
      mode: "live",
      flow_manifest: [],
    },
    "a hello with type: welcome",
  );
});

// --- welcome ---------------------------------------------------------------

test("welcome: valid example passes", async () => {
  const validate = await loadValidator("welcome.schema.json");
  assertValid(
    validate,
    {
      type: "welcome",
      accepted: true,
      protocol_version: 1,
      settings: { default_step_timeout_ms: 30000 },
    },
    "a well-formed welcome",
  );
});

test("welcome: accepted: false fails (a soft-reject is not this shape yet)", async () => {
  const validate = await loadValidator("welcome.schema.json");
  assertInvalid(
    validate,
    {
      type: "welcome",
      accepted: false,
      protocol_version: 1,
    },
    "a welcome with accepted: false",
  );
});

// --- step --------------------------------------------------------------

test("step: valid example passes", async () => {
  const validate = await loadValidator("step.schema.json");
  assertValid(
    validate,
    {
      type: "step",
      step_id: "s-1",
      op: "tap",
      params: { selector: { text: "Send" } },
    },
    "a well-formed step",
  );
});

test("step: missing step_id fails", async () => {
  const validate = await loadValidator("step.schema.json");
  assertInvalid(
    validate,
    {
      type: "step",
      op: "tap",
    },
    "a step missing step_id",
  );
});

// --- result --------------------------------------------------------------

test("result: valid example passes", async () => {
  const validate = await loadValidator("result.schema.json");
  assertValid(
    validate,
    {
      type: "result",
      step_id: "s-1",
      output: { tree: "root>button[Send]" },
    },
    "a well-formed result",
  );
});

test("result: wrong type discriminator fails", async () => {
  const validate = await loadValidator("result.schema.json");
  assertInvalid(
    validate,
    {
      type: "error",
      step_id: "s-1",
      output: {},
    },
    "a result with type: error",
  );
});

// --- error --------------------------------------------------------------

test("error: valid example passes", async () => {
  const validate = await loadValidator("error.schema.json");
  assertValid(
    validate,
    {
      type: "error",
      step_id: "s-1",
      code: "selector_not_found",
      message: "no node matched the given selector",
    },
    "a well-formed error",
  );
});

test("error: missing message fails", async () => {
  const validate = await loadValidator("error.schema.json");
  assertInvalid(
    validate,
    {
      type: "error",
      step_id: "s-1",
      code: "selector_not_found",
    },
    "an error missing message",
  );
});

test("error: result-shaped payload (wrong discriminator) is not accepted as an error", async () => {
  const validate = await loadValidator("error.schema.json");
  assertInvalid(
    validate,
    {
      type: "result",
      step_id: "s-1",
      output: null,
    },
    "a result-shaped payload validated against the error schema",
  );
});

// --- file-reference --------------------------------------------------------------

test("file-reference: valid inline example passes", async () => {
  const validate = await loadValidator("file-reference.schema.json");
  assertValid(
    validate,
    {
      kind: "inline",
      mime: "image/jpeg",
      data: "//8=",
    },
    "a well-formed inline file-reference",
  );
});

test("file-reference: valid url example passes", async () => {
  const validate = await loadValidator("file-reference.schema.json");
  assertValid(
    validate,
    {
      kind: "url",
      mime: "image/jpeg",
      url: "https://example.com/blob/abc123",
      expires_at: "2026-09-26T00:00:00Z",
    },
    "a well-formed url file-reference",
  );
});

test("file-reference: inline variant missing data fails", async () => {
  const validate = await loadValidator("file-reference.schema.json");
  assertInvalid(
    validate,
    {
      kind: "inline",
      mime: "image/jpeg",
    },
    "an inline file-reference missing data",
  );
});

test("file-reference: mixing inline and url fields fails (matches neither oneOf branch)", async () => {
  const validate = await loadValidator("file-reference.schema.json");
  assertInvalid(
    validate,
    {
      kind: "inline",
      mime: "image/jpeg",
      data: "//8=",
      url: "https://example.com/blob/abc123",
    },
    "a file-reference with both data and url",
  );
});
