// batch(): entries made by the builder, sent as one FHIR batch, one result per entry in order, each
// judged as the call alone is.
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { AuthError, Haau3, Haau3Error, NoAnswerError, RefusedError } from "../src/index.js";
import { BatchBuilder } from "../src/generated/batch.js";
import { KEY, fakeFetch, fhirAnswer, spec, type Received } from "./helpers.js";

const REQUEST_ID = "6b1f3c2e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
const PARAMETERS = { resourceType: "Parameters", parameter: [{ name: "display", valueString: "Glucose" }] };
const PLAN = { resourceType: "InsurancePlan", id: "H2406-013-000" };
const SEARCHSET = { resourceType: "Bundle", type: "searchset", entry: [] };
const outcome = (text: string) => ({ resourceType: "OperationOutcome", issue: [{ severity: "error", code: "not-found", diagnostics: text }] });

interface RequestEntry {
  request: { method: string; url: string };
  resource?: unknown;
}

/** The batch Bundle a request carried. */
const sentBundle = (request: Received) => JSON.parse(request.body!) as { resourceType: string; type: string; entry: RequestEntry[] };

/** A fetch that answers a batch entry by entry, in order. */
function batchFetch(answerEntry: (entry: RequestEntry, index: number) => object) {
  return fakeFetch((request) =>
    fhirAnswer({ resourceType: "Bundle", type: "batch-response", entry: sentBundle(request).entry.map(answerEntry) }),
  );
}

const answered = (resource: unknown, status = "200") => ({ response: { status }, resource });

/** Sends one entry answered with `entry`, and returns its result. */
async function oneEntry(entry: object) {
  const { fetch } = batchFetch(() => entry);
  const [result] = await new Haau3({ apiKey: KEY, fetch }).batch((b) => [b.searchPractitioner({ identifier: "http://hl7.org/fhir/sid/us-npi|1234567893" })]);
  return result;
}

describe("batch", () => {
  it("sends one POST to the FHIR base, with one batch entry per entry, in order", async () => {
    const { fetch, received } = batchFetch((entry) => answered(entry.request.url.startsWith("Insurance") ? PLAN : PARAMETERS));
    await new Haau3({ apiKey: KEY, fetch }).batch((b) => [
      b.codeSystemLookup({ system: "http://loinc.org", code: "2345-7", property: "CLASSTYPE" }),
      b.readInsurancePlan("H2406-013-000"),
    ]);
    expect(received).toHaveLength(1);
    expect(received[0]!.method).toBe("POST");
    expect(received[0]!.url.href).toBe("https://api.haau3.com/v1/fhir/r4");
    expect(received[0]!.headers["content-type"]).toBe("application/fhir+json");
    expect(sentBundle(received[0]!)).toEqual({
      resourceType: "Bundle",
      type: "batch",
      entry: [
        { request: { method: "GET", url: "CodeSystem/$lookup?system=http%3A%2F%2Floinc.org&code=2345-7&property=CLASSTYPE" } },
        { request: { method: "GET", url: "InsurancePlan/H2406-013-000" } },
      ],
    });
  });

  it("returns one result per entry, in the order given, each with its answer and status", async () => {
    const { fetch } = batchFetch((entry) => (entry.request.url.startsWith("Insurance") ? answered(PLAN) : answered(PARAMETERS, "200 OK")));
    const [lookup, plan] = await new Haau3({ apiKey: KEY, fetch }).batch((b) => [
      b.codeSystemLookup({ system: "http://loinc.org", code: "2345-7" }),
      b.readInsurancePlan("H2406-013-000"),
    ]);
    expect(lookup).toEqual({ ok: true, data: PARAMETERS, status: 200 });
    expect(plan).toEqual({ ok: true, data: PLAN, status: 200 });
  });

  it("encodes a path value, and carries a POST operation's body as the entry's resource", async () => {
    const { fetch, received } = batchFetch(() => answered(PARAMETERS));
    const body = { resourceType: "Parameters" as const, parameter: [{ name: "code", valueCode: "2345-7" }] };
    await new Haau3({ apiKey: KEY, fetch }).batch((b) => [b.readPractitioner("a/b c"), b.codeSystemLookupPost(body)]);
    const [read, post] = sentBundle(received[0]!).entry;
    expect(read).toEqual({ request: { method: "GET", url: "Practitioner/a%2Fb%20c" } });
    expect(post).toEqual({ request: { method: "POST", url: "CodeSystem/$lookup" }, resource: body });
  });

  it("passes the call's options on to the batch's request", async () => {
    const { fetch, received } = batchFetch(() => answered(PARAMETERS));
    const id = "0b9a8c7d-6e5f-4a3b-9c2d-1e0f9a8b7c6d";
    await new Haau3({ apiKey: KEY, fetch }).batch((b) => [b.codeSystemLookup({ system: "s", code: "c" })], { headers: { "X-Request-Id": id } });
    expect(received[0]!.headers["x-request-id"]).toBe(id);
  });

  it("gives the batch's request id and timing with .withResponse()", async () => {
    const { fetch } = batchFetch(() => answered(PARAMETERS));
    const { data, requestId, attempts, durationMs, status } = await new Haau3({ apiKey: KEY, fetch })
      .batch((b) => [b.codeSystemLookup({ system: "s", code: "c" })])
      .withResponse();
    expect(data).toEqual([{ ok: true, data: PARAMETERS, status: 200 }]);
    expect({ requestId, attempts, status }).toEqual({ requestId: REQUEST_ID, attempts: 1, status: 200 });
    expect(durationMs).toBeGreaterThanOrEqual(0);
  });

  it("sends an empty batch as given", async () => {
    const { fetch, received } = fakeFetch(() => fhirAnswer({ resourceType: "Bundle", type: "batch-response" }));
    await expect(new Haau3({ apiKey: KEY, fetch }).batch(() => [])).resolves.toEqual([]);
    expect(sentBundle(received[0]!).entry).toEqual([]);
  });
});

describe("an entry's result", () => {
  it.each([
    ["404", RefusedError, { status: 404 }],
    ["400", RefusedError, { status: 400 }],
    // The key is checked once for the whole batch, so a refusal inside it is the entry's own.
    ["401", RefusedError, { status: 401 }],
    ["403", RefusedError, { status: 403 }],
    ["429", NoAnswerError, { status: 429, reason: "rate-limited", retryAfter: undefined }],
    ["500", NoAnswerError, { status: 500, reason: "server-error" }],
    ["502", NoAnswerError, { status: 502, reason: "unavailable" }],
    ["503", NoAnswerError, { status: 503, reason: "unavailable" }],
    ["504", NoAnswerError, { status: 504, reason: "timeout" }],
    ["302", NoAnswerError, { status: 302, reason: "unreadable" }],
  ] as const)("is the call's own error for a %s", async (status, kind, fields) => {
    const result = await oneEntry(answered(outcome("no such practitioner"), status));
    expect(result.ok).toBe(false);
    const error = (result as { error: unknown }).error;
    expect(error).toBeInstanceOf(kind);
    expect(error).not.toBeInstanceOf(AuthError);
    expect(error).toMatchObject(fields);
  });

  it("is unreadable when a success is another resource type, has none, or has no status", async () => {
    for (const entry of [answered(PARAMETERS), { response: { status: "200" } }, { resource: SEARCHSET }, { response: { status: "OK" }, resource: SEARCHSET }]) {
      const result = await oneEntry(entry);
      expect(result.ok, JSON.stringify(entry)).toBe(false);
      expect((result as { error: unknown }).error).toMatchObject({ reason: "unreadable" });
    }
  });

  it("reads the OperationOutcome from the entry's resource or its response's outcome", async () => {
    for (const entry of [answered(outcome("from the resource"), "404"), { response: { status: "404", outcome: outcome("from the response") } }]) {
      const result = await oneEntry(entry);
      const error = (result as { error: RefusedError }).error;
      expect(error.outcome?.resourceType).toBe("OperationOutcome");
    }
  });

  it("carries the batch's request id and timing, and names the entry by its operation and position only", async () => {
    const { fetch } = batchFetch((_entry, index) => (index === 0 ? answered(SEARCHSET) : answered(outcome("x"), "404")));
    const results = await new Haau3({ apiKey: KEY, fetch }).batch((b) => [
      b.searchPractitioner({ identifier: "http://hl7.org/fhir/sid/us-npi|1234567893" }),
      b.searchPractitioner({ identifier: "http://hl7.org/fhir/sid/us-npi|1518929058" }),
    ]);
    expect(results[0]).toEqual({ ok: true, data: SEARCHSET, status: 200 });
    const error = (results[1] as { error: RefusedError }).error;
    expect(error.message).toBe("GET /v1/fhir/r4/Practitioner (entry 2 of 2) was refused (404).");
    expect(error).toMatchObject({ requestId: REQUEST_ID, attempts: 1 });
    expect(error.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("never prints the body an entry answered with", async () => {
    const result = await oneEntry(answered(outcome("PHI-SHAPED-TEXT"), "404"));
    const error = (result as { error: RefusedError }).error;
    expect(error.outcome?.issue[0]?.diagnostics).toBe("PHI-SHAPED-TEXT");
    for (const printed of [error.message, String(error), inspect(error), JSON.stringify(error), JSON.stringify(result)]) {
      expect(printed).not.toContain("PHI-SHAPED-TEXT");
    }
  });
});

describe("the batch as a whole", () => {
  it("is no answer when the answer is not a batch-response, or cannot be paired entry for entry", async () => {
    for (const body of [
      { resourceType: "Bundle", type: "searchset", entry: [answered(PARAMETERS)] },
      { resourceType: "Bundle", type: "batch-response", entry: [answered(PARAMETERS), answered(PARAMETERS)] },
      { resourceType: "Bundle", type: "batch-response" },
    ]) {
      const { fetch } = fakeFetch(() => fhirAnswer(body));
      const call = new Haau3({ apiKey: KEY, fetch }).batch((b) => [b.codeSystemLookup({ system: "s", code: "c" })]);
      await expect(call).rejects.toMatchObject({ name: "NoAnswerError", reason: "unreadable", requestId: REQUEST_ID });
      await expect(call.withResponse()).rejects.toBeInstanceOf(NoAnswerError);
    }
  });

  it("throws as any call does: a refused key, a refused batch", async () => {
    const refusedKey = fakeFetch(() => fhirAnswer(outcome("key"), 401));
    await expect(new Haau3({ apiKey: KEY, fetch: refusedKey.fetch }).batch((b) => [b.codeSystemLookup({ system: "s", code: "c" })])).rejects.toBeInstanceOf(AuthError);
    const tooLong = fakeFetch(() => fhirAnswer(outcome("too long"), 400));
    await expect(new Haau3({ apiKey: KEY, fetch: tooLong.fetch }).batch((b) => [b.codeSystemLookup({ system: "s", code: "c" })])).rejects.toMatchObject({
      name: "RefusedError",
      status: 400,
    });
  });

  it("is retried as any call is, while an entry that failed is not", async () => {
    const { fetch, received } = fakeFetch((request, count) =>
      count === 1
        ? fhirAnswer(outcome("busy"), 503)
        : fhirAnswer({ resourceType: "Bundle", type: "batch-response", entry: sentBundle(request).entry.map(() => answered(outcome("down"), "502")) }),
    );
    const [result] = await new Haau3({ apiKey: KEY, fetch }).batch((b) => [b.codeSystemLookup({ system: "s", code: "c" })]);
    expect(received).toHaveLength(2);
    expect(result).toMatchObject({ ok: false, error: { reason: "unavailable", attempts: 2 } });
  });

  it("refuses, before sending anything, a build that throws or an entry the builder did not make", async () => {
    const { fetch, received } = fakeFetch(() => fhirAnswer({}));
    const haau3 = new Haau3({ apiKey: KEY, fetch });
    const boom = new Error("boom");
    await expect(haau3.batch(() => { throw boom; })).rejects.toBe(boom);
    await expect(haau3.batch(() => [{ method: "GET", url: "Practitioner/1" }] as never)).rejects.toBeInstanceOf(Haau3Error);
    await expect(haau3.batch(() => "Practitioner/1" as never)).rejects.toBeInstanceOf(Haau3Error);
    expect(received).toHaveLength(0);
  });
});

describe("the builder", () => {
  const operations = Object.entries(spec.paths).flatMap(([path, item]) =>
    (["get", "post"] as const).filter((m) => item[m]).map((m) => ({ path, method: m.toUpperCase(), op: item[m] })),
  );

  const refused = operations.filter(({ op }) => op["x-haau3-batchable"] === false);

  it("offers every operation on the FHIR base but the batch itself and the ones the spec marks x-haau3-batchable: false", () => {
    const offered = Object.getOwnPropertyNames(BatchBuilder.prototype).filter((name) => name !== "constructor");
    const expected = operations
      .filter(({ path, op }) => path.startsWith("/v1/fhir/r4/") && op["x-haau3-batchable"] !== false)
      .map(({ op }) => op.operationId as string);
    expect(offered.sort()).toEqual(expected.sort());
    expect(offered).not.toContain("fhirBatch");
    for (const { op } of refused) expect(offered).not.toContain(op.operationId);
  });

  it("finds the operations a batch refuses marked in the spec, and the batch's description naming the mark", () => {
    expect(refused.map(({ op }) => op.operationId)).toContain("reconcileMedications");
    expect(spec.paths["/v1/fhir/r4"]!.post.description).toContain("`x-haau3-batchable: false`");
  });

  // Each entry's address is the request the same method sends on its own, from the spec's examples.
  const first = (content: Record<string, any> | undefined) => {
    const media = Object.values(content ?? {})[0] as Record<string, any> | undefined;
    return media?.example ?? (Object.values(media?.examples ?? {})[0] as { value?: unknown } | undefined)?.value;
  };
  const batchable = operations.filter(({ path, op }) => path.startsWith("/v1/fhir/r4/") && op["x-haau3-batchable"] !== false);

  it.each(batchable.map(({ op, method }) => ({ id: op.operationId as string, method, op })))(
    "$id makes the entry its direct call would send",
    async ({ id, method, op }) => {
      const params = (op.parameters ?? []).filter((p: any) => !p.$ref);
      const query = Object.fromEntries(params.filter((p: any) => p.in === "query" && p.example !== undefined).map((p: any) => [p.name, p.example]));
      const args: unknown[] = params.filter((p: any) => p.in === "path").map((p: any) => p.example);
      if (params.some((p: any) => p.in === "query")) args.push(Object.keys(query).length ? query : undefined);
      const body = first(op.requestBody?.content);
      if (body !== undefined) args.push(body);

      const direct = fakeFetch(() => fhirAnswer({}));
      const client = new Haau3({ apiKey: KEY, fetch: direct.fetch, maxRetries: 0 });
      await (client as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[id]!.apply(client, args).catch(() => undefined);
      const sent = direct.received[0]!;

      const viaBatch = batchFetch(() => answered({}));
      await new Haau3({ apiKey: KEY, fetch: viaBatch.fetch, maxRetries: 0 }).batch((b) => [(b as unknown as Record<string, (...a: unknown[]) => never>)[id]!.apply(b, args)]).catch(() => undefined);
      const [entry] = sentBundle(viaBatch.received[0]!).entry;

      expect(entry!.request).toEqual({ method, url: sent.url.pathname.slice("/v1/fhir/r4/".length) + sent.url.search });
      expect(entry!.resource).toEqual(sent.body === undefined ? undefined : JSON.parse(sent.body));
    },
  );
});
