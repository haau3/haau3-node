// The code samples in openapi/code-samples.json, one per operation, each run as it is written: a
// program of its own, with HAAU3_BASE_URL pointing at a stand-in API that answers only the
// operation's example request, exactly as the spec writes it, and refuses anything else.
//
// Against the production API too, on a real key, when asked, as test/live.test.ts is:
//
//   HAAU3_LIVE_TEST=1 HAAU3_API_KEY=haau3_sk_... pnpm test test/samples.test.ts
//
// There each sample runs with no address set, as a customer runs it, one at a time. What it must
// do is set by the key's mode, read from its prefix: a live key (`haau3_sk_live_`) is answered
// everywhere but the Sandbox and refused there, a test key (`haau3_sk_test_`) the reverse, each
// refusal a ForbiddenError with its code. The live key comes from an organization with no agreement
// on file, which Pharmacy Benefits refuses, since it is not yet open. A key with neither prefix
// works on both bases, and its run leaves Pharmacy Benefits out. CI sets neither variable.
import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { slotViews } from "../src/index.js";
import { FHIR_JSON, KEY, spec } from "./helpers.js";

interface Sample {
  lang: string;
  label: string;
  source: string;
}
interface Action {
  target: string;
  update: { "x-codeSamples": Sample[] };
}
const overlay = JSON.parse(readFileSync(new URL("../openapi/code-samples.json", import.meta.url), "utf8")) as {
  overlay: string;
  info: { title: string; version: string };
  extends: string;
  actions: Action[];
};

type Json = Record<string, any>;
const firstExample = (content: Json | undefined): any => {
  const media = Object.values(content ?? {})[0] as Json | undefined;
  if (!media) return undefined;
  return media.example !== undefined ? media.example : (Object.values(media.examples ?? {})[0] as Json | undefined)?.value;
};

interface Operation {
  id: string;
  method: string;
  path: string;
  op: Json;
}
const operations: Operation[] = Object.entries(spec.paths).flatMap(([path, item]) =>
  ["get", "post"].filter((m) => item[m]).map((m) => ({ id: item[m].operationId as string, method: m.toUpperCase(), path, op: item[m] })),
);

/** The query the spec's example sends, every value as the text it goes out as. */
function exampleQuery(op: Json): Record<string, string[]> {
  const query: Record<string, string[]> = {};
  for (const p of (op.parameters ?? []) as Json[]) {
    if (p.$ref || p.in !== "query" || p.example === undefined) continue;
    query[p.name] = (Array.isArray(p.example) ? p.example : [p.example]).map(String);
  }
  return query;
}

function queryOf(params: URLSearchParams): Record<string, string[]> {
  const query: Record<string, string[]> = {};
  for (const name of new Set(params.keys())) query[name] = params.getAll(name);
  return query;
}

/** The path and query of one request, in a form two requests can be compared by. */
function requestKey(method: string, path: string, query: Record<string, string[]>): string {
  const sorted = Object.keys(query)
    .sort()
    .map((name) => [name, query[name]]);
  return `${method} ${path} ${JSON.stringify(sorted)}`;
}

function exampleRequestKey({ method, path, op }: Operation): string {
  let filled = path;
  for (const p of (op.parameters ?? []) as Json[]) if (p.in === "path") filled = filled.replace(`{${p.name}}`, p.example);
  return requestKey(method, filled, exampleQuery(op));
}

/** What a sample prints for its example answer, by the rule the generator writes. */
function expectedOutput({ id, op }: Operation): string {
  const answer = firstExample(op.responses["200"].content);
  // The first call prints its first slot through the slot view, as console.log shows an object.
  if (id === "searchSlot") {
    const [first] = slotViews(answer);
    if (!first) return "No open slots matched.";
    const name = first.practitioners[0]?.name?.[0];
    return inspect({
      start: first.slot.start,
      practitioner: name?.text ?? ([name?.given?.join(" "), name?.family].filter(Boolean).join(" ") || undefined),
      location: first.locations[0]?.name,
      bookingLink: first.bookingLink,
    });
  }
  if (id === "fhirBatch") return answer.entry.map((e: Json) => String(Number.parseInt(e.response.status, 10))).join("\n");
  if (id === "fhirMetadata" || answer.resourceType === "CapabilityStatement") return answer.resourceType;
  if (answer.resourceType === "Bundle") return String(answer.entry?.length ?? 0);
  if (answer.resourceType === "Parameters") return answer.parameter.map((p: Json) => p.name).join("\n");
  if (answer.resourceType) return answer.id;
  if ("total" in answer) return String(answer.total);
  const lists = Object.values(answer).filter(Array.isArray);
  return String(lists[0]!.length);
}

let server: Server;
let baseURL: string;
const received: string[] = [];

beforeAll(async () => {
  const answers = new Map<string, { body: unknown; fhir: boolean }>();
  for (const operation of operations) {
    if (operation.id === "fhirBatch") continue;
    answers.set(exampleRequestKey(operation), {
      body: firstExample(operation.op.responses["200"].content),
      fhir: "application/fhir+json" in operation.op.responses["200"].content,
    });
  }
  const batch = operations.find((o) => o.id === "fhirBatch")!;
  const batchRequest = firstExample(batch.op.requestBody.content);
  const batchEntries = (batchRequest.entry as Json[]).map((e) => {
    const url = new URL(e.request.url, "https://base.invalid/v1/fhir/r4/");
    return requestKey(e.request.method, url.pathname, queryOf(url.searchParams));
  });

  server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => {
      const url = new URL(req.url ?? "/", "http://stand-in");
      const key = requestKey(req.method ?? "GET", decodeURIComponent(url.pathname), queryOf(url.searchParams));
      received.push(key);
      const refuse = (why: string) => {
        res.writeHead(400, { "content-type": FHIR_JSON });
        res.end(JSON.stringify({ resourceType: "OperationOutcome", issue: [{ severity: "error", code: "invalid", diagnostics: why }] }));
      };
      if (req.headers.authorization !== `Bearer ${KEY}`) return refuse("no key");
      if (req.method === "POST" && url.pathname === "/v1/fhir/r4") {
        const sent = (JSON.parse(body).entry as Json[]).map((e) => {
          const entryUrl = new URL(e.request.url, "https://base.invalid/v1/fhir/r4/");
          return requestKey(e.request.method, decodeURIComponent(entryUrl.pathname), queryOf(entryUrl.searchParams));
        });
        if (JSON.stringify(sent) !== JSON.stringify(batchEntries)) return refuse("not the example batch");
        res.writeHead(200, { "content-type": FHIR_JSON });
        return res.end(JSON.stringify(firstExample(batch.op.responses["200"].content)));
      }
      const answer = answers.get(key);
      if (!answer) return refuse(`not an example request: ${key}`);
      if (req.method === "POST") {
        const operation = operations.find((o) => o.method === "POST" && o.path === url.pathname)!;
        if (JSON.stringify(JSON.parse(body)) !== JSON.stringify(firstExample(operation.op.requestBody.content))) {
          return refuse("not the example body");
        }
      }
      res.writeHead(200, { "content-type": answer.fhir ? FHIR_JSON : "application/json" });
      res.end(JSON.stringify(answer.body));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("The stand-in has no port.");
  baseURL = `http://127.0.0.1:${address.port}`;
});

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())));

const TSX = new URL("../node_modules/.bin/tsx", import.meta.url).pathname;
const SRC = new URL("../src/index.ts", import.meta.url).pathname;

/**
 * Runs one sample as a program of its own, as a customer would, with `@haau3/sdk` resolving to this
 * repository's source. A sample whose body nests resources reads it from request.json where it runs.
 */
function run(
  source: string,
  files: Record<string, string> = {},
  env: Record<string, string> = { HAAU3_API_KEY: KEY, HAAU3_BASE_URL: baseURL },
): Promise<{ code: number; stdout: string; stderr: string }> {
  const dir = mkdtempSync(join(tmpdir(), "sdk-sample-"));
  writeFileSync(join(dir, "sample.mts"), source);
  writeFileSync(
    join(dir, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { module: "NodeNext", moduleResolution: "NodeNext", paths: { "@haau3/sdk": [SRC] } } }),
  );
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return new Promise((resolve) => {
    execFile(
      TSX,
      ["sample.mts"],
      { cwd: dir, env: { PATH: process.env.PATH, ...env }, timeout: 30_000 },
      (error, stdout, stderr) => {
        rmSync(dir, { recursive: true, force: true });
        resolve({ code: error ? ((error as { code?: number }).code ?? 1) : 0, stdout, stderr });
      },
    );
  });
}

const sampleOf = (operation: Operation) =>
  overlay.actions.find((a) => a.target === `$.paths['${operation.path}'].${operation.method.toLowerCase()}`)!.update[
    "x-codeSamples"
  ][0]!.source;
const requestFile = (operation: Operation): Record<string, string> =>
  sampleOf(operation).includes('readFile("request.json"') ? { "request.json": JSON.stringify(firstExample(operation.op.requestBody.content)) } : {};

describe("the code samples overlay", () => {
  it("is an OpenAPI Overlay for the spec it was generated from", () => {
    expect(overlay.overlay).toBe("1.2.0");
    expect(overlay.info.version).toBe(spec.info.version);
    expect(overlay.extends).toBe("https://api.haau3.com/openapi.json");
  });

  it("adds one TypeScript sample to every operation, in the spec's order, and to nothing else", () => {
    expect(overlay.actions.map((a) => a.target)).toEqual(operations.map((o) => `$.paths['${o.path}'].${o.method.toLowerCase()}`));
    for (const action of overlay.actions) {
      expect(Object.keys(action.update)).toEqual(["x-codeSamples"]);
      expect(action.update["x-codeSamples"]).toHaveLength(1);
      expect(action.update["x-codeSamples"][0]).toMatchObject({ lang: "typescript", label: "TypeScript" });
    }
  });

  it("names every method by its operationId, reads the key from the environment and sets no address", () => {
    for (const operation of operations) {
      const source = sampleOf(operation);
      expect(source).toContain('import { Haau3');
      expect(source).toContain("new Haau3();");
      expect(source).not.toMatch(/apiKey|baseURL|haau3_sk_/);
      // The first call searches slots through the helper that sends the includes the view reads.
      const method = operation.id === "searchSlot" ? "searchSlotWithIncludes" : operation.id;
      if (operation.id !== "fhirBatch") expect(source).toContain(`haau3.${method}(`);
    }
  });

  it("writes the slot search as the first call: through the helper and the slot view, the first slot it found, or that none did", () => {
    const source = sampleOf(operations.find((o) => o.id === "searchSlot")!);
    expect(source).toMatch(/^\/\/ Open appointment slots of one provider, found by NPI, each with its schedule, location and provider\.$/m);
    expect(source).toContain('const page = await haau3.searchSlotWithIncludes({\n  "provider-identifier": ');
    // The helper sends the includes, so the sample names none.
    expect(source).not.toContain("_include");
    expect(source).toContain("const [view] = haau3.slotViews(page);");
    // A name's text, or its given and family names when the publisher sent no text.
    expect(source).toContain("const name = view?.practitioners[0]?.name?.[0];");
    expect(source).toContain('practitioner: name?.text ?? ([name?.given?.join(" "), name?.family].filter(Boolean).join(" ") || undefined),');
    expect(source.trimEnd().endsWith('    : "No open slots matched.",\n);')).toBe(true);
  });
});

describe("the first call, when the search finds no slot", () => {
  let empty: Server;
  let emptyURL: string;

  beforeAll(async () => {
    empty = createServer((_req, res) => {
      res.writeHead(200, { "content-type": "application/fhir+json" });
      res.end(JSON.stringify({ resourceType: "Bundle", type: "searchset", total: 0 }));
    });
    await new Promise<void>((resolve) => empty.listen(0, "127.0.0.1", resolve));
    const address = empty.address();
    if (!address || typeof address === "string") throw new Error("The stand-in has no port.");
    emptyURL = `http://127.0.0.1:${address.port}`;
  });

  afterAll(() => new Promise<void>((resolve) => empty.close(() => resolve())));

  const firstCall = () => sampleOf(operations.find((o) => o.id === "searchSlot")!);

  it("says that no open slot matched", async () => {
    const result = await run(firstCall(), {}, { HAAU3_API_KEY: KEY, HAAU3_BASE_URL: emptyURL });
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout).toBe("No open slots matched.\n");
  });

  it("where the sample before the guard printed undefined (the control)", async () => {
    const unguarded = firstCall().replace('    : "No open slots matched.",', "    : view,");
    expect(unguarded).not.toBe(firstCall());
    const result = await run(unguarded, {}, { HAAU3_API_KEY: KEY, HAAU3_BASE_URL: emptyURL });
    expect(result.stdout).toBe("undefined\n");
  });
});

describe("the first call's practitioner, when the publisher sent no name text", () => {
  // Most publishers name a Practitioner by its given and family names alone. The stand-in answers the
  // first call with one such Slot, or with one whose Schedule names a Location and no provider.
  const API = "https://api.haau3.com/v1/fhir/r4";
  const SLOT_LINK = "http://hl7.org/fhir/uv/smart-scheduling-links/StructureDefinition/booking-deep-link";
  const answerWith = (actors: object[], more: object[]) => ({
    resourceType: "Bundle",
    type: "searchset",
    total: 1,
    entry: [
      {
        fullUrl: `${API}/Slot/s1`,
        search: { mode: "match" },
        resource: {
          resourceType: "Slot",
          id: "s1",
          schedule: { reference: "Schedule/sc1" },
          status: "free",
          start: "2026-12-01T09:00:00-05:00",
          end: "2026-12-01T09:30:00-05:00",
          extension: [{ url: SLOT_LINK, valueUrl: "https://example.org/book" }],
        },
      },
      { fullUrl: `${API}/Schedule/sc1`, search: { mode: "include" }, resource: { resourceType: "Schedule", id: "sc1", actor: actors } },
      { fullUrl: `${API}/Location/l1`, search: { mode: "include" }, resource: { resourceType: "Location", id: "l1", name: "Main Street Clinic" } },
      ...more,
    ],
  });
  const role = {
    fullUrl: `${API}/PractitionerRole/r1`,
    search: { mode: "include" },
    resource: { resourceType: "PractitionerRole", id: "r1", practitioner: { reference: "Practitioner/p1" } },
  };
  const practitioner = {
    fullUrl: `${API}/Practitioner/p1`,
    search: { mode: "include" },
    resource: { resourceType: "Practitioner", id: "p1", name: [{ given: ["Ana", "Maria"], family: "Lee" }] },
  };

  let body: unknown;
  let standIn: Server;
  let standInURL: string;

  beforeAll(async () => {
    standIn = createServer((_req, res) => {
      res.writeHead(200, { "content-type": FHIR_JSON });
      res.end(JSON.stringify(body));
    });
    await new Promise<void>((resolve) => standIn.listen(0, "127.0.0.1", resolve));
    const address = standIn.address();
    if (!address || typeof address === "string") throw new Error("The stand-in has no port.");
    standInURL = `http://127.0.0.1:${address.port}`;
  });

  afterAll(() => new Promise<void>((resolve) => standIn.close(() => resolve())));

  const firstCall = () => sampleOf(operations.find((o) => o.id === "searchSlot")!);

  it("prints the given and family names", async () => {
    body = answerWith([{ reference: "Location/l1" }, { reference: "PractitionerRole/r1" }], [role, practitioner]);
    const result = await run(firstCall(), {}, { HAAU3_API_KEY: KEY, HAAU3_BASE_URL: standInURL });
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      `${inspect({ start: "2026-12-01T09:00:00-05:00", practitioner: "Ana Maria Lee", location: "Main Street Clinic", bookingLink: "https://example.org/book" })}\n`,
    );
  });

  it("prints undefined, not an empty name, when the Schedule names no provider", async () => {
    body = answerWith([{ reference: "Location/l1" }], []);
    const result = await run(firstCall(), {}, { HAAU3_API_KEY: KEY, HAAU3_BASE_URL: standInURL });
    expect(result.stderr).toBe("");
    expect(result.stdout).toBe(
      `${inspect({ start: "2026-12-01T09:00:00-05:00", practitioner: undefined, location: "Main Street Clinic", bookingLink: "https://example.org/book" })}\n`,
    );
  });
});

describe("each sample, run as written", () => {
  it.concurrent.each(operations)("$id sends its example request and prints what came back", async (operation) => {
    const result = await run(sampleOf(operation), requestFile(operation));
    expect(result.stderr).toBe("");
    expect(result.code).toBe(0);
    expect(result.stdout.trimEnd()).toBe(expectedOutput(operation));
  });

  it("fails when it sends anything but the example request (the stand-in's control)", async () => {
    const read = operations.find((o) => o.id === "readInsurancePlan")!;
    const changed = sampleOf(read).replace(/readInsurancePlan\("[^"]+"\)/, 'readInsurancePlan("H0000-000-000")');
    expect(changed).not.toBe(sampleOf(read));
    const result = await run(changed);
    expect(result.code).not.toBe(0);
    expect(result.stderr).toContain("RefusedError");
  });
});

const live = process.env.HAAU3_LIVE_TEST === "1" && Boolean(process.env.HAAU3_API_KEY);
const liveKey = process.env.HAAU3_API_KEY ?? "";
const keyMode = liveKey.startsWith("haau3_sk_live_") ? "live" : liveKey.startsWith("haau3_sk_test_") ? "test" : "either";

/** What a sample must do on this key: answer, or be refused with this code (null for none); undefined when it is not run. */
function onThisKey({ id, path }: Operation): { answers: true } | { refused: string | null } | undefined {
  const sandbox = path.startsWith("/v1/sandbox/");
  // A test key sends every sample to the Sandbox's own host, which answers each example request with
  // its fixed answer, and the first address's two at the same operations there.
  if (keyMode === "test") return { answers: true };
  if (keyMode === "live" && sandbox) return { refused: "live-key-in-sandbox" };
  if (id === "processMessage") return keyMode === "live" ? { refused: null } : undefined;
  return { answers: true };
}

describe.skipIf(!live)("each sample, run against the API its key picks", () => {
  for (const operation of operations) {
    const expected = onThisKey(operation);
    it.skipIf(expected === undefined)(`${operation.id}, on a ${keyMode} key`, async () => {
      const result = await run(sampleOf(operation), requestFile(operation), { HAAU3_API_KEY: liveKey });
      if (expected && "answers" in expected) {
        expect(result.stderr).toBe("");
        expect(result.code).toBe(0);
        expect(result.stdout.trim()).not.toBe("");
        // The first call prints a slot, so an empty search would print undefined.
        expect(result.stdout.trim()).not.toBe("undefined");
        // A search that finds nothing still answers: its example found something, so this must too.
        if (expectedOutput(operation) !== "0") expect(result.stdout.trim()).not.toBe("0");
      } else {
        expect(result.code).not.toBe(0);
        expect(result.stderr).toContain("ForbiddenError");
        expect(result.stderr).toContain(expected?.refused ? `code: '${expected.refused}'` : "code: undefined");
      }
    }, 60_000);
  }
});
