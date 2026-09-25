import { compile } from "json-schema-to-typescript";
import { readdir, readFile, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaDir = path.join(__dirname, "..", "schema");
const outDir = path.join(__dirname, "..", "src", "generated");

function nameFromId(id: string): string {
  const basename = path.basename(new URL(id).pathname, ".json");
  return basename
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");
}

async function main(): Promise<void> {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const files = (await readdir(schemaDir)).filter((f) => f.endsWith(".schema.json"));
  if (files.length === 0) {
    throw new Error(`no schema files found in ${schemaDir}`);
  }

  const generated: { name: string; file: string }[] = [];

  for (const file of files) {
    const filePath = path.join(schemaDir, file);
    const schema = JSON.parse(await readFile(filePath, "utf-8"));
    if (typeof schema.$id !== "string") {
      throw new Error(`${file} has no $id`);
    }
    const name = nameFromId(schema.$id);
    const ts = await compile(schema, name, {
      cwd: schemaDir,
      additionalProperties: false,
      style: { singleQuote: false },
    });
    const outFile = path.join(outDir, `${name}.ts`);
    await writeFile(outFile, ts);
    generated.push({ name, file: `${name}.ts` });
    console.log(`generated ${path.relative(process.cwd(), outFile)} from ${file}`);
  }

  generated.sort((a, b) => a.name.localeCompare(b.name));
  const indexTs =
    generated.map((g) => `export * from "./${g.name}.js";`).join("\n") + "\n";
  await writeFile(path.join(outDir, "index.ts"), indexTs);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
