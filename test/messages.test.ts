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
      protocol_version: 2,
      apk_version: "0.1.0",
      android_version: 34,
      device_model: "Google Pixel 8",
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
      protocol_version: 2,
      apk_version: "0.1.0",
      android_version: 34,
      device_model: "Google Pixel 8",
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
      protocol_version: 2,
      apk_version: "0.1.0",
      android_version: 34,
      device_model: "Google Pixel 8",
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
      protocol_version: 2,
      accounts: true,
      account_id: "acc_abc123",
      settings: { default_step_timeout_ms: 30000 },
    },
    "a well-formed welcome",
  );
});

test("welcome: settings is optional", async () => {
  const validate = await loadValidator("welcome.schema.json");
  assertValid(
    validate,
    {
      type: "welcome",
      accepted: true,
      protocol_version: 2,
      accounts: false,
      account_id: null,
    },
    "a well-formed welcome with no settings",
  );
});

test("welcome: accepted: false fails (a soft-reject is not this shape yet)", async () => {
  const validate = await loadValidator("welcome.schema.json");
  assertInvalid(
    validate,
    {
      type: "welcome",
      accepted: false,
      protocol_version: 2,
      accounts: true,
      account_id: null,
    },
    "a welcome with accepted: false",
  );
});

test("welcome: accounts is a required boolean, true or false", async () => {
  const validate = await loadValidator("welcome.schema.json");
  const base = { type: "welcome", accepted: true, protocol_version: 2, account_id: null };
  assertValid(validate, { ...base, accounts: true }, "a welcome from a server with accounts");
  assertValid(validate, { ...base, accounts: false }, "a welcome from a server without accounts");
  assertInvalid(validate, base, "a welcome missing accounts");
  assertInvalid(validate, { ...base, accounts: "true" }, "a welcome with a non-boolean accounts");
});

// --- challenge / challenge_response ---------------------------------------

test("challenge: valid example passes", async () => {
  const validate = await loadValidator("challenge.schema.json");
  assertValid(validate, { type: "challenge", nonce: "cmFuZG9tLW5vbmNlLWJ5dGVz" }, "a well-formed challenge");
});

test("challenge: missing nonce fails", async () => {
  const validate = await loadValidator("challenge.schema.json");
  assertInvalid(validate, { type: "challenge" }, "a challenge missing nonce");
});

test("challenge_response: valid example passes", async () => {
  const validate = await loadValidator("challenge-response.schema.json");
  assertValid(
    validate,
    { type: "challenge_response", signature: "MEUCIQDx...base64der...AiA=" },
    "a well-formed challenge_response",
  );
});

test("challenge_response: wrong type discriminator fails", async () => {
  const validate = await loadValidator("challenge-response.schema.json");
  assertInvalid(validate, { type: "challenge", signature: "abc" }, "a challenge_response with type: challenge");
});

// --- device-registration ---------------------------------------------------

test("device-registration: valid example passes", async () => {
  const validate = await loadValidator("device-registration.schema.json");
  assertValid(
    validate,
    { public_key: "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAE...base64der..." },
    "a well-formed device-registration",
  );
});

test("device-registration: missing public_key fails", async () => {
  const validate = await loadValidator("device-registration.schema.json");
  assertInvalid(validate, { device_id: "pixel-8-abc123" }, "a device-registration missing public_key");
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

// --- hello / welcome: the version-reporting fields (plan 03 milestone 2) ---------

test("hello: android_version and device_model are accepted; a non-positive or empty value fails", async () => {
  const validate = await loadValidator("hello.schema.json");
  const base = {
    type: "hello",
    protocol_version: 2,
    apk_version: "1.0.0",
    device_id: "d",
    capabilities: [],
    mode: "live",
    flow_manifest: [],
  };
  assertValid(validate, { ...base, android_version: 34, device_model: "Google Pixel 8" }, "hello with both fields");
  assertInvalid(validate, { ...base, android_version: 0 }, "android_version 0");
  assertInvalid(validate, { ...base, device_model: "" }, "empty device_model");
  assertInvalid(validate, { ...base, device_model: "x".repeat(129) }, "over-long device_model");
});

// --- sign_in / signed_in / sign_in_rejected (design doc D-33) ---------------------------

test("sign_in: valid example passes", async () => {
  const validate = await loadValidator("sign-in.schema.json");
  assertValid(
    validate,
    { type: "sign_in", account_token: "clt_abc123", install_hint: "3fa2f1c9d4e5b6a7" },
    "a well-formed sign_in",
  );
});

test("sign_in: missing account_token or install_hint fails", async () => {
  const validate = await loadValidator("sign-in.schema.json");
  assertInvalid(validate, { type: "sign_in" }, "a sign_in missing account_token");
  assertInvalid(
    validate,
    { type: "sign_in", account_token: "clt_abc123" },
    "a sign_in missing install_hint",
  );
});

test("signed_in: valid example passes", async () => {
  const validate = await loadValidator("signed-in.schema.json");
  assertValid(validate, { type: "signed_in", account_id: "acc_abc123" }, "a well-formed signed_in");
});

test("signed_in: missing account_id fails", async () => {
  const validate = await loadValidator("signed-in.schema.json");
  assertInvalid(validate, { type: "signed_in" }, "a signed_in missing account_id");
});

test("sign_in_rejected: valid example passes", async () => {
  const validate = await loadValidator("sign-in-rejected.schema.json");
  assertValid(
    validate,
    { type: "sign_in_rejected", reason: "invalid_token" },
    "a well-formed sign_in_rejected",
  );
  assertValid(
    validate,
    { type: "sign_in_rejected", reason: "accounts_unsupported" },
    "a sign_in_rejected from a server without accounts",
  );
});

test("sign_in_rejected: unknown reason fails", async () => {
  const validate = await loadValidator("sign-in-rejected.schema.json");
  assertInvalid(validate, { type: "sign_in_rejected", reason: "nope" }, "a sign_in_rejected with an unknown reason");
});

// --- sign_out / signed_out -------------------------------------------------------------

test("sign_out: valid example passes", async () => {
  const validate = await loadValidator("sign-out.schema.json");
  assertValid(validate, { type: "sign_out" }, "a well-formed sign_out");
});

test("sign_out: only the type discriminator is allowed", async () => {
  const validate = await loadValidator("sign-out.schema.json");
  assertInvalid(validate, { type: "sign_out", account_id: "acc_abc123" }, "a sign_out with an extra field");
  assertInvalid(validate, {}, "a message without the type discriminator");
});

test("signed_out: valid example passes", async () => {
  const validate = await loadValidator("signed-out.schema.json");
  assertValid(validate, { type: "signed_out" }, "a well-formed signed_out");
});

test("signed_out: only the type discriminator is allowed", async () => {
  const validate = await loadValidator("signed-out.schema.json");
  assertInvalid(validate, { type: "signed_out", account_id: "acc_abc123" }, "a signed_out with an extra field");
  assertInvalid(validate, {}, "a message without the type discriminator");
});

test("welcome: the update fields are optional, and download_url must be https", async () => {
  const validate = await loadValidator("welcome.schema.json");
  const base = { type: "welcome", accepted: true, protocol_version: 2, accounts: true, account_id: null };
  assertValid(validate, base, "welcome without update fields");
  assertValid(
    validate,
    {
      ...base,
      latest_app_version: "1.3.0",
      minimum_supported_app_version: "1.0.0",
      download_url: "https://example.com/app.apk",
    },
    "welcome with update fields",
  );
  assertInvalid(validate, { ...base, download_url: "http://example.com/app.apk" }, "http download_url");
  assertInvalid(validate, { ...base, latest_app_version: "" }, "empty latest_app_version");
});
