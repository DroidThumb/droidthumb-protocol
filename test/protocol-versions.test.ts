import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaDir = path.join(__dirname, "..", "schema");
const examplesDir = path.join(__dirname, "..", "examples");

/** Every message a supported protocol version must carry a valid and an invalid example of. */
const REQUIRED_MESSAGES = [
  "hello",
  "welcome",
  "challenge",
  "challenge-response",
  "device-registration",
  "step",
  "result",
  "error",
  "notification-event",
  "device-registration-response",
  "regenerate-secret",
  "secret-regenerated",
];

interface ProtocolVersions {
  current: number;
  supported: number[];
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf-8"));
}

async function loadVersions(): Promise<ProtocolVersions> {
  return (await readJson(path.join(examplesDir, "protocol-versions.json"))) as ProtocolVersions;
}

interface Example {
  file: string;
  message: string;
  kind: "valid" | "invalid";
  body: Record<string, unknown>;
}

async function loadExamples(version: number): Promise<Example[]> {
  const dir = path.join(examplesDir, `v${version}`);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  const out: Example[] = [];
  for (const file of files) {
    const m = /^([a-z-]+)\.(valid|invalid)(\..+)?\.json$/.exec(file);
    assert.ok(m, `v${version}/${file} does not match <message>.<valid|invalid>[.<label>].json`);
    out.push({
      file,
      message: m[1] as string,
      kind: m[2] as "valid" | "invalid",
      body: (await readJson(path.join(dir, file))) as Record<string, unknown>,
    });
  }
  return out;
}

async function validatorFor(message: string) {
  const schema = await readJson(path.join(schemaDir, `${message}.schema.json`));
  const ajv = new Ajv2020({ strict: true });
  addFormats(ajv);
  return ajv.compile(schema as object);
}

test("protocol-versions.json: current is supported, at most N and N-1, consecutive", async () => {
  const { current, supported } = await loadVersions();
  assert.ok(Number.isInteger(current) && current >= 1, "current must be a positive integer");
  assert.ok(supported.includes(current), "the current version must be supported");
  assert.ok(supported.length >= 1 && supported.length <= 2, "policy: the server supports N and N-1 only");
  assert.equal(Math.max(...supported), current, "no supported version may be newer than current");
  const sorted = [...supported].sort((a, b) => a - b);
  sorted.forEach((v, i) => {
    if (i > 0) assert.equal(v, (sorted[i - 1] as number) + 1, "supported versions must be consecutive");
  });
});

test("every supported version has an examples directory, and no unsupported version keeps one", async () => {
  const { supported } = await loadVersions();
  const dirs = (await readdir(examplesDir, { withFileTypes: true }))
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
  assert.deepEqual(dirs, supported.map((v) => `v${v}`).sort());
});

test("every supported version has a valid and an invalid example of every required message", async () => {
  const { supported } = await loadVersions();
  for (const version of supported) {
    const examples = await loadExamples(version);
    for (const message of REQUIRED_MESSAGES) {
      for (const kind of ["valid", "invalid"] as const) {
        assert.ok(
          examples.some((e) => e.message === message && e.kind === kind),
          `v${version} is missing a ${kind} example of ${message}`,
        );
      }
    }
  }
});

test("every example validates (or fails to) against its schema as its file name says", async () => {
  const { supported } = await loadVersions();
  for (const version of supported) {
    for (const example of await loadExamples(version)) {
      const validate = await validatorFor(example.message);
      const ok = validate(example.body);
      const label = `v${version}/${example.file}`;
      if (example.kind === "valid") {
        assert.equal(ok, true, `${label} should be valid: ${JSON.stringify(validate.errors)}`);
      } else {
        assert.equal(ok, false, `${label} should be invalid, but passed`);
      }
    }
  }
});

test("a version's examples carry that protocol_version wherever a message has one", async () => {
  const { supported } = await loadVersions();
  for (const version of supported) {
    for (const example of await loadExamples(version)) {
      if (example.kind === "valid" && "protocol_version" in example.body) {
        assert.equal(example.body["protocol_version"], version, `v${version}/${example.file}`);
      }
    }
  }
});

test("v1 keeps a legacy hello and welcome (sent before the M2 fields existed) that stay valid", async () => {
  const examples = await loadExamples(1);
  for (const message of ["hello", "welcome"]) {
    const legacy = examples.find((e) => e.message === message && e.file.includes(".legacy."));
    assert.ok(legacy, `v1 must keep a legacy ${message} example`);
    assert.equal((await validatorFor(message))(legacy.body), true);
  }
  const legacyHello = examples.find((e) => e.file === "hello.valid.legacy.json");
  assert.ok(legacyHello && !("android_version" in legacyHello.body) && !("device_model" in legacyHello.body));
});
