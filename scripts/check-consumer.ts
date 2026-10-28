// Typechecks the package as a customer installs it: packs the tarball, installs it into a fresh
// project beside one TypeScript version, and compiles test-types/consumer.mts (ES modules) and
// consumer.cts (CommonJS) with skipLibCheck off, so the published declarations themselves are
// checked, along with every code sample in openapi/code-samples.json and every TypeScript block of
// the README, each as a module of its own. Run for each version customers use:
//
//   pnpm build && tsx scripts/check-consumer.ts 5.9.3 6.0.3 7.0.2

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const versions = process.argv.slice(2);
if (versions.length === 0) throw new Error("Name at least one TypeScript version, such as 6.0.3.");

const work = join(root, ".consumer");
rmSync(work, { recursive: true, force: true });
mkdirSync(work);
execFileSync("pnpm", ["pack", "--pack-destination", work], { cwd: root, stdio: "inherit" });
const tarball = join(work, readdirSync(work).find((name) => name.endsWith(".tgz"))!);

const overlay = JSON.parse(readFileSync(join(root, "openapi", "code-samples.json"), "utf8")) as {
  actions: { update: { "x-codeSamples": { source: string }[] } }[];
};
const samples = overlay.actions.map((action, i) => ({ file: `samples/sample-${i + 1}.mts`, source: action.update["x-codeSamples"][0]!.source }));

// A README block uses names the reader already has: the client from "Authenticate", an id, a list of
// codes, a patient's records, a pharmacy benefit check's message, a Sandbox check's message, a
// member's access token. Each is declared before the block, unless the block makes its own.
const makes = (block: string, name: string) =>
  new RegExp(`\\b(const|let)\\s+(${name}\\b|\\{[^}]*\\b${name}\\b[^}]*\\})`).test(block);
const GIVEN: [string, string][] = [
  ["haau3", "Haau3"],
  ["id", "string"],
  ["jobId", "string"],
  ["codes", "string[]"],
  ["first", "Fhir4.Bundle"],
  ["records", "Fhir4.Bundle"],
  ["message", "Fhir4.Bundle"],
  ["sandboxMessage", "Fhir4.Bundle"],
  ["accessToken", "string"],
];
const readme = readFileSync(join(root, "README.md"), "utf8");
const readmeBlocks = [...readme.matchAll(/```ts\n([\s\S]*?)```/g)].map((match, i) => {
  const block = match[1]!;
  const prelude = [
    /import \{[^}]*\bHaau3\b[^}]*\} from "@haau3\/sdk"/.test(block) ? undefined : 'import { Haau3 } from "@haau3/sdk";',
    'import type { fhir4 as Fhir4 } from "@haau3/sdk";',
    ...GIVEN.filter(([name]) => !makes(block, name)).map(([name, type]) => `declare const ${name}: ${type};`),
  ].filter(Boolean);
  // A block's own imports go first, as a module's must.
  const imports = block.split("\n").filter((line) => line.startsWith("import "));
  const rest = block.split("\n").filter((line) => !line.startsWith("import "));
  return { file: `readme/block-${i + 1}.mts`, source: [...imports, ...prelude, "", ...rest].join("\n") };
});
if (readmeBlocks.length < 10) throw new Error(`The README has ${readmeBlocks.length} TypeScript blocks; expected at least 10.`);

const tsconfig = JSON.parse(readFileSync(join(root, "test-types", "tsconfig.json"), "utf8")) as { files: string[] };
tsconfig.files.push(...samples.map((s) => s.file), ...readmeBlocks.map((b) => b.file));

let failed = 0;
for (const version of versions) {
  const dir = join(work, `typescript-${version}`);
  mkdirSync(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "consumer", private: true }));
  execFileSync(
    "npm",
    // undici for the README's proxy example.
    ["install", "--no-audit", "--no-fund", "--ignore-scripts", tarball, `typescript@${version}`, "@types/node@22", "undici@7.30.1"],
    { cwd: dir, stdio: "inherit" },
  );
  for (const file of ["consumer.mts", "consumer.cts"]) {
    copyFileSync(join(root, "test-types", file), join(dir, file));
  }
  writeFileSync(join(dir, "tsconfig.json"), JSON.stringify(tsconfig, null, 2));
  mkdirSync(join(dir, "samples"));
  mkdirSync(join(dir, "readme"));
  for (const { file, source } of [...samples, ...readmeBlocks]) writeFileSync(join(dir, file), source);
  try {
    execFileSync(join(dir, "node_modules", ".bin", "tsc"), ["-p", dir], { cwd: dir, stdio: "inherit" });
    console.log(
      `TypeScript ${version}: the published types, all ${samples.length} samples and all ${readmeBlocks.length} README blocks compile.`,
    );
  } catch {
    failed += 1;
    console.error(`TypeScript ${version}: the published types do not compile.`);
  }
}
if (failed) process.exit(1);
