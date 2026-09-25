import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "..");
const generatedDir = path.join(repoRoot, "src", "generated");

test("codegen produced one .ts file per schema plus an index", async () => {
  const files = await readdir(generatedDir);
  const expected = [
    "Error.ts",
    "FileReference.ts",
    "Hello.ts",
    "Result.ts",
    "Step.ts",
    "Welcome.ts",
    "index.ts",
  ];
  for (const name of expected) {
    assert.ok(files.includes(name), `missing generated file ${name}`);
  }
});

test("generated types contain no explicit `any`", async () => {
  const files = (await readdir(generatedDir)).filter((f) => f.endsWith(".ts"));
  for (const file of files) {
    const contents = await readFile(path.join(generatedDir, file), "utf-8");
    assert.doesNotMatch(
      contents,
      /\bany\b/,
      `${file} contains an explicit "any" type`,
    );
  }
});

test("generated types compile with tsc in strict mode", async () => {
  await assert.doesNotReject(
    execFileAsync("npx", ["tsc", "--noEmit"], { cwd: repoRoot }),
    "tsc --noEmit should succeed against the generated types",
  );
});
