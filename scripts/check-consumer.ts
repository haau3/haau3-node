// Typechecks the package as a customer installs it: packs the tarball, installs it into a fresh
// project beside one TypeScript version, and compiles test-types/consumer.mts (ES modules) and
// consumer.cts (CommonJS) with skipLibCheck off, so the published declarations themselves are
// checked. Run for each version customers use:
//
//   pnpm build && tsx scripts/check-consumer.ts 5.9.3 6.0.3 7.0.2

import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const versions = process.argv.slice(2);
if (versions.length === 0) throw new Error("Name at least one TypeScript version, such as 6.0.3.");

const work = join(root, ".consumer");
rmSync(work, { recursive: true, force: true });
mkdirSync(work);
execFileSync("pnpm", ["pack", "--pack-destination", work], { cwd: root, stdio: "inherit" });
const tarball = join(work, readdirSync(work).find((name) => name.endsWith(".tgz"))!);

let failed = 0;
for (const version of versions) {
  const dir = join(work, `typescript-${version}`);
  mkdirSync(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "consumer", private: true }));
  execFileSync(
    "npm",
    ["install", "--no-audit", "--no-fund", "--ignore-scripts", tarball, `typescript@${version}`, "@types/node@22"],
    { cwd: dir, stdio: "inherit" },
  );
  for (const file of ["consumer.mts", "consumer.cts", "tsconfig.json"]) {
    copyFileSync(join(root, "test-types", file), join(dir, file));
  }
  try {
    execFileSync(join(dir, "node_modules", ".bin", "tsc"), ["-p", dir], { cwd: dir, stdio: "inherit" });
    console.log(`TypeScript ${version}: the published types compile.`);
  } catch {
    failed += 1;
    console.error(`TypeScript ${version}: the published types do not compile.`);
  }
}
if (failed) process.exit(1);
