// Every operation in the pinned spec, driven by the example exchange the spec itself carries: the
// method sends the example request exactly as the API documents it, and returns the example answer.
import { describe, expect, it } from "vitest";
import { Haau3, VERSION } from "../src/index.js";
import { KEY, fakeFetch, fhirAnswer, answer, spec } from "./helpers.js";

interface Case {
  operationId: string;
  method: "GET" | "POST";
  path: string;
  pathValues: string[];
  query: Record<string, unknown> | undefined;
  hasQuery: boolean;
  body: unknown;
  answer: unknown;
  /** The media type the spec gives the answer, which the call asks for. */
  answers: string;
  /** The media type the spec gives the body, which the call sends it as. */
  sends: string | undefined;
}

const firstExample = (content: Record<string, any> | undefined) => {
  const media = Object.values(content ?? {})[0] as Record<string, any> | undefined;
  if (!media) return undefined;
  if (media.example !== undefined) return media.example;
  return (Object.values(media.examples ?? {})[0] as { value?: unknown } | undefined)?.value;
};

const cases: Case[] = [];
for (const [path, item] of Object.entries(spec.paths)) {
  for (const method of ["get", "post"] as const) {
    const op = item[method];
    if (!op) continue;
    const params = (op.parameters ?? []).filter((p: any) => !p.$ref);
    const query = params.filter((p: any) => p.in === "query");
    const examples = Object.fromEntries(query.filter((p: any) => p.example !== undefined).map((p: any) => [p.name, p.example]));
    cases.push({
      operationId: op.operationId,
      method: method.toUpperCase() as "GET" | "POST",
      path,
      pathValues: params.filter((p: any) => p.in === "path").map((p: any) => p.example),
      query: Object.keys(examples).length ? examples : undefined,
      hasQuery: query.length > 0,
      body: firstExample(op.requestBody?.content),
      answer: firstExample(op.responses["200"].content),
      answers: Object.keys(op.responses["200"].content)[0]!,
      sends: op.requestBody ? Object.keys(op.requestBody.content)[0] : undefined,
    });
  }
}

describe("the operations", () => {
  // Nothing here names a version or a count, so a regeneration PR (regenerate.yml) passes on its own
  // unless the new spec needs a change by hand.
  it("are every operation in the spec, each a method on Haau3 named by its operationId", () => {
    expect(spec.info.version).toMatch(/^1\.0\.0(-preview\.\d+)?$/);
    expect(cases.length).toBeGreaterThan(0);
    expect(new Set(cases.map((c) => c.operationId)).size).toBe(cases.length);
    // The generator writes GET and POST methods only, so an operation under any other method is
    // work by hand.
    const methods = Object.values(spec.paths).flatMap((item) => Object.keys(item).filter((key) => key !== "parameters"));
    expect([...new Set(methods)].sort()).toEqual(["get", "post"]);
    for (const { operationId } of cases) {
      expect(typeof (Haau3.prototype as unknown as Record<string, unknown>)[operationId], operationId).toBe("function");
    }
  });

  it("has no method the spec does not name, besides the client's own", () => {
    const own = new Set(["constructor", "pages", "resources", "matches", "resolve", "parameters", "parameter", "reviewFlags", "batch", "request", "answer", "respond", "operation", "url"]);
    const names = new Set<string>();
    for (let proto = Haau3.prototype; proto !== Object.prototype; proto = Object.getPrototypeOf(proto)) {
      for (const name of Object.getOwnPropertyNames(proto)) if (!own.has(name)) names.add(name);
    }
    expect([...names].sort()).toEqual(cases.map((c) => c.operationId).sort());
  });

  it.each(cases)("$operationId sends its example request and returns its example answer", async (c) => {
    const { fetch, received } = fakeFetch(() => (c.answers === "application/fhir+json" ? fhirAnswer(c.answer) : answer(c.answer)));
    const haau3 = new Haau3({ apiKey: KEY, fetch });

    const args: unknown[] = [...c.pathValues];
    if (c.hasQuery) args.push(c.query);
    if (c.body !== undefined) args.push(c.body);
    const method = (haau3 as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[c.operationId]!;
    const result = await method.apply(haau3, args);

    expect(result).toEqual(c.answer);
    expect(received).toHaveLength(1);
    const [request] = received;
    expect(request!.method).toBe(c.method);
    let path = c.path;
    for (const value of c.pathValues) path = path.replace(/\{[^}]+\}/, encodeURIComponent(value));
    expect(request!.url.origin + request!.url.pathname).toBe(`https://api.haau3.com${path}`);
    const sent: Record<string, unknown> = {};
    for (const name of new Set(request!.url.searchParams.keys())) {
      const values = request!.url.searchParams.getAll(name);
      sent[name] = Array.isArray(c.query?.[name]) ? values : values[0];
    }
    expect(sent).toEqual(
      Object.fromEntries(
        Object.entries(c.query ?? {}).map(([name, value]) => [name, Array.isArray(value) ? value.map(String) : String(value)]),
      ),
    );
    expect(request!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(request!.headers["user-agent"]).toBe(`haau3-node/${VERSION} (node ${process.versions.node.split(".")[0]})`);
    expect(request!.headers.accept).toBe(c.answers);
    if (c.body === undefined) {
      expect(request!.body).toBeUndefined();
    } else {
      expect(JSON.parse(request!.body!)).toEqual(c.body);
      expect(request!.headers["content-type"]).toBe(c.sends);
    }
  });
});
