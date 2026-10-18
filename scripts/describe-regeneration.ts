// Describes a regeneration pull request for .github/workflows/regenerate.yml:
//
//   GENERATED_CHANGED=true tsx scripts/describe-regeneration.ts <pinned spec> <changes> <body file>
//
// <pinned spec> is the spec main had before `pnpm fetch-spec`, and <changes> is what
// `oasdiff changelog --format json` reported between it and the new openapi/openapi.json. It prints
// `title=`, `breaking=` and `releases=` lines for $GITHUB_OUTPUT and writes the description to
// <body file>. HAAU3_SPEC_URL names where the spec was read from.

import { readFile, writeFile } from "node:fs/promises";
import { decide, type Change } from "./regeneration.js";

const [pinnedPath, changesPath, bodyPath] = process.argv.slice(2);
if (!pinnedPath || !changesPath || !bodyPath) {
  throw new Error("usage: describe-regeneration.ts <pinned spec> <changes> <body file>");
}

const version = async (path: string | URL) =>
  (JSON.parse(await readFile(path, "utf8")) as { info: { version: string } }).info.version;

const decision = decide({
  from: await version(pinnedPath),
  to: await version(new URL("../openapi/openapi.json", import.meta.url)),
  etag: (await readFile(new URL("../openapi/etag", import.meta.url), "utf8")).trim(),
  specUrl: process.env.HAAU3_SPEC_URL ?? "https://api.haau3.com/openapi.json",
  changes: JSON.parse((await readFile(changesPath, "utf8")) || "[]") as Change[],
  generatedChanged: process.env.GENERATED_CHANGED === "true",
});

await writeFile(bodyPath, decision.body);
console.log(`title=${decision.title}`);
console.log(`breaking=${decision.breaking}`);
console.log(`releases=${decision.releases}`);
