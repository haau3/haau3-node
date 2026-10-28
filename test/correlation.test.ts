// Your own request id (correlationId): sent as X-Request-Id, refused before sending when the API
// would drop it, and read back from X-Correlation-Id everywhere the API answered. And toJSON(): an
// error as a plain object that is safe to log.
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { AuthError, Haau3, Haau3Error, NoAnswerError, RefusedError } from "../src/index.js";
import { KEY, fakeFetch, fhirAnswer } from "./helpers.js";

const MINE = "2c9d4e6f-8a1b-4c3d-9e5f-7a6b5c4d3e2f";
const PLAN = { resourceType: "InsurancePlan", id: "H2406-013-000" };
const MARKER = "A-BODY-THE-LOG-MUST-NOT-CARRY";
const outcome = { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "not-found", diagnostics: MARKER }] };

/** Answers as the API does: X-Correlation-Id only when the request's X-Request-Id was a UUID. */
function api(status: number, body: unknown) {
  return fakeFetch((request) => {
    const sent = request.headers["x-request-id"];
    const kept: Record<string, string> = sent && /^[0-9a-f-]{36}$/i.test(sent) ? { "x-correlation-id": sent.toLowerCase() } : {};
    return fhirAnswer(body, status, kept);
  });
}

describe("correlationId", () => {
  it("is sent as X-Request-Id and comes back on .withResponse()", async () => {
    const { fetch, received } = api(200, PLAN);
    const answered = await new Haau3({ apiKey: KEY, fetch }).readInsurancePlan("H2406-013-000", { correlationId: MINE }).withResponse();
    expect(received[0]!.headers["x-request-id"]).toBe(MINE);
    expect(answered.correlationId).toBe(MINE);
    expect(answered.requestId).not.toBe(MINE);
  });

  it("wins over an X-Request-Id given as a raw header", async () => {
    const { fetch, received } = api(200, PLAN);
    await new Haau3({ apiKey: KEY, fetch }).readInsurancePlan("x", { correlationId: MINE, headers: { "X-Request-Id": "other" } });
    expect(received[0]!.headers["x-request-id"]).toBe(MINE);
  });

  it("is unset on the answer when none was sent", async () => {
    const { fetch } = api(200, PLAN);
    expect((await new Haau3({ apiKey: KEY, fetch }).readInsurancePlan("x").withResponse()).correlationId).toBeUndefined();
  });

  it.each(["job-42", "", "2c9d4e6f8a1b4c3d9e5f7a6b5c4d3e2f", `${MINE} `])(
    "refuses %j before sending, since the API would drop it without a word",
    async (id) => {
      const { fetch, received } = api(200, PLAN);
      const call = new Haau3({ apiKey: KEY, fetch }).readInsurancePlan("H2406-013-000", { correlationId: id });
      await expect(call).rejects.toBeInstanceOf(Haau3Error);
      await expect(call).rejects.toThrow(/correlationId must be a UUID/);
      expect(received).toHaveLength(0);
    },
  );

  it("comes back on every error the API answered", async () => {
    for (const [status, kind] of [[401, AuthError], [404, RefusedError], [503, NoAnswerError]] as const) {
      const { fetch } = api(status, outcome);
      const error = await new Haau3({ apiKey: KEY, fetch, maxRetries: 0 })
        .readInsurancePlan("x", { correlationId: MINE })
        .catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(kind);
      expect((error as Haau3Error).correlationId).toBe(MINE);
    }
  });

  it("comes back on request(), and on a batch and each of its entries' errors", async () => {
    const raw = api(200, { slots: [] });
    expect((await new Haau3({ apiKey: KEY, fetch: raw.fetch }).request({ method: "GET", path: "/v1/scheduling/slots", correlationId: MINE })).correlationId).toBe(MINE);

    const { fetch } = fakeFetch((request) =>
      fhirAnswer(
        { resourceType: "Bundle", type: "batch-response", entry: [{ response: { status: "404" }, resource: outcome }] },
        200,
        { "x-correlation-id": request.headers["x-request-id"]! },
      ),
    );
    const { data, correlationId } = await new Haau3({ apiKey: KEY, fetch })
      .batch((b) => [b.readInsurancePlan("x")], { correlationId: MINE })
      .withResponse();
    expect(correlationId).toBe(MINE);
    expect(data[0].ok ? undefined : data[0].error.correlationId).toBe(MINE);
  });
});

describe("toJSON", () => {
  it("gives the name, the message and the fields that are set, and never the body or the cause", async () => {
    const { fetch } = api(404, outcome);
    const error = (await new Haau3({ apiKey: KEY, fetch })
      .readInsurancePlan("H2406-013-000", { correlationId: MINE })
      .catch((caught: unknown) => caught)) as RefusedError;
    expect(error.toJSON()).toEqual({
      name: "RefusedError",
      message: "GET /v1/fhir/r4/InsurancePlan/{id} was refused (404).",
      status: 404,
      statusText: "Not Found",
      attempts: 1,
      durationMs: error.durationMs,
      requestId: "6b1f3c2e-4d5a-4b6c-8d7e-9f0a1b2c3d4e",
      correlationId: MINE,
    });
    // Control: the body is on the error, for code to read.
    expect(error.outcome?.issue[0]?.diagnostics).toBe(MARKER);
    for (const printed of [JSON.stringify(error), JSON.stringify(error.toJSON()), inspect(error)]) {
      expect(printed).not.toContain(MARKER);
    }
    expect(JSON.parse(JSON.stringify(error))).toEqual(error.toJSON());
  });

  it("gives a no-answer's reason and wait, and leaves the cause out", async () => {
    const failing = (async () => {
      throw new TypeError(`connect ECONNREFUSED ${MARKER}`);
    }) as unknown as typeof fetch;
    const error = (await new Haau3({ apiKey: KEY, fetch: failing, maxRetries: 0 })
      .readInsurancePlan("x")
      .catch((caught: unknown) => caught)) as NoAnswerError;
    expect(error.cause).toBeInstanceOf(TypeError);
    const json = error.toJSON();
    expect(json).toMatchObject({ name: "NoAnswerError", reason: "network", attempts: 1 });
    expect(json).not.toHaveProperty("cause");
    expect(JSON.stringify(json)).not.toContain(MARKER);

    const limited = api(429, outcome);
    const waited = (await new Haau3({ apiKey: KEY, fetch: limited.fetch, maxRetries: 0 })
      .readInsurancePlan("x")
      .catch((caught: unknown) => caught)) as NoAnswerError;
    expect(waited.toJSON()).toMatchObject({ reason: "rate-limited", status: 429 });
  });
});
