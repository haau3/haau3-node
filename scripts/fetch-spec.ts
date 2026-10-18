// Pins the published spec: fetches https://api.haau3.com/openapi.json and writes it to
// openapi/openapi.json, indented so a change reads as a diff, with the ETag it was served with in
// openapi/etag. When the pinned ETag still matches, the API answers 304 and nothing is written.
//
//   pnpm fetch-spec            then   pnpm generate
//
// HAAU3_SPEC_URL fetches from somewhere else, such as a local platform API.

import { readFile, writeFile } from "node:fs/promises";

const SPEC_URL = process.env.HAAU3_SPEC_URL ?? "https://api.haau3.com/openapi.json";
const SPEC = new URL("../openapi/openapi.json", import.meta.url);
const ETAG = new URL("../openapi/etag", import.meta.url);

const pinned = await readFile(ETAG, "utf8").then((text) => text.trim(), () => undefined);
const response = await fetch(SPEC_URL, {
  headers: pinned ? { "if-none-match": pinned } : {},
  signal: AbortSignal.timeout(30_000),
});

if (response.status === 304) {
  console.log(`Unchanged: ${SPEC_URL} still answers ETag ${pinned}.`);
} else if (!response.ok) {
  throw new Error(`${SPEC_URL} answered ${response.status}.`);
} else {
  const etag = response.headers.get("etag");
  if (!etag) throw new Error(`${SPEC_URL} sent no ETag.`);
  const doc = (await response.json()) as { openapi?: string; info?: { version?: string } };
  if (!doc.openapi?.startsWith("3.1")) throw new Error(`${SPEC_URL} is not an OpenAPI 3.1 document.`);
  await writeFile(SPEC, `${JSON.stringify(doc, null, 2)}\n`);
  await writeFile(ETAG, `${etag}\n`);
  console.log(`Pinned ${doc.info?.version} (ETag ${etag}) from ${SPEC_URL}.`);
}
