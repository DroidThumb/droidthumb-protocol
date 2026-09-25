import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaDir = path.join(__dirname, "..", "schema");

async function schemaFiles(): Promise<string[]> {
  return (await readdir(schemaDir)).filter((f) => f.endsWith(".schema.json")).sort();
}

test("every schema/*.schema.json file validates against the JSON Schema 2020-12 meta-schema", async () => {
  const ajv = new Ajv2020({ strict: true });
  addFormats(ajv);

  const files = await schemaFiles();
  assert.ok(files.length > 0, "expected at least one schema file");

  for (const file of files) {
    const schema = JSON.parse(await readFile(path.join(schemaDir, file), "utf-8"));
    assert.equal(
      schema.$schema,
      "https://json-schema.org/draft/2020-12/schema",
      `${file} must declare the 2020-12 meta-schema`,
    );
    const valid = ajv.validateSchema(schema);
    assert.equal(
      valid,
      true,
      `${file} failed meta-schema validation: ${ajv.errorsText(ajv.errors)}`,
    );
  }
});

test("every schema/*.schema.json file compiles with ajv without error", async () => {
  const ajv = new Ajv2020({ strict: true });
  addFormats(ajv);

  const files = await schemaFiles();
  for (const file of files) {
    const schema = JSON.parse(await readFile(path.join(schemaDir, file), "utf-8"));
    assert.doesNotThrow(() => ajv.compile(schema), `${file} failed to compile`);
  }
});

test("the six schema files required by the M0 plan all exist", async () => {
  const files = await schemaFiles();
  const expected = [
    "hello.schema.json",
    "welcome.schema.json",
    "step.schema.json",
    "result.schema.json",
    "error.schema.json",
    "file-reference.schema.json",
  ];
  for (const name of expected) {
    assert.ok(files.includes(name), `missing ${name}`);
  }
});
