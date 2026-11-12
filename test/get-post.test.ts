// get() and post(): any operation by its path, through the same path every generated method takes,
// so it answers with the same data and throws the same errors. Each value is encoded into the path,
// a message names the path as written and never a value, and a path that does not match its values
// is refused before anything is sent.
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { AuthError, ForbiddenError, Haau3, Haau3Error, NoAnswerError, RefusedError } from "../src/index.js";
import { KEY, answer, fakeFetch, fhirAnswer } from "./helpers.js";

const PRACTITIONER = "/v1/fhir/r4/Practitioner/{id}";
/** A value a message must never repeat: what a caller put in the path. */
const VALUE = "VALUE-NEVER-IN-A-MESSAGE";

const client = (respond: () => Response | Promise<Response>, options: Partial<ConstructorParameters<typeof Haau3>[0]> = {}) => {
  const { fetch, received } = fakeFetch(respond);
  return { haau3: new Haau3({ apiKey: KEY, fetch, maxRetries: 0, ...options }), received };
};

const outcome = (code: string, apiCode?: string) => ({
  resourceType: "OperationOutcome",
  issue: [
    {
      severity: "error",
      code,
      details: {
        text: "The API's own words.",
        ...(apiCode ? { coding: [{ system: "https://haau3.com/fhir/CodeSystem/api-error", code: apiCode }] } : {}),
      },
    },
  ],
});

/** Every way an error commonly reaches a log line. */
function printed(error: unknown): string {
  const e = error as Error;
  return [inspect(error, { depth: 10 }), String(error), e.message, e.stack ?? "", JSON.stringify(error)].join("\n");
}

describe("get()", () => {
  it("sends a GET to the path with each value encoded, the query, the key and FHIR's media type", async () => {
    const { haau3, received } = client(() => fhirAnswer({ resourceType: "Practitioner", id: "a b/c" }));
    const practitioner = await haau3.get<{ resourceType: string }>(PRACTITIONER, { pathParams: { id: "a b/c" }, query: { _format: "json", npi: ["1", "2"] } });
    expect(practitioner.resourceType).toBe("Practitioner");
    const [request] = received;
    expect(request!.method).toBe("GET");
    expect(request!.url.pathname).toBe("/v1/fhir/r4/Practitioner/a%20b%2Fc");
    expect(request!.url.searchParams.getAll("npi")).toEqual(["1", "2"]);
    expect(request!.url.searchParams.get("_format")).toBe("json");
    expect(request!.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(request!.headers.accept).toBe("application/fhir+json");
    expect(request!.body).toBeUndefined();
  });

  it("takes a path with no {name} and no pathParams, and JSON outside the FHIR base", async () => {
    const { haau3, received } = client(() => answer({ publishers: [] }));
    expect(await haau3.get("/v1/scheduling/publishers")).toEqual({ publishers: [] });
    expect(received[0]!.headers.accept).toBe("application/json");
  });

  it("answers .withResponse() with the request id, status, timing and attempts", async () => {
    const { haau3 } = client(() => fhirAnswer({ resourceType: "CapabilityStatement" }));
    const { data, requestId, status, attempts, durationMs } = await haau3.get("/v1/fhir/r4/metadata", { expects: ["CapabilityStatement"] }).withResponse();
    expect(data).toEqual({ resourceType: "CapabilityStatement" });
    expect(requestId).toBe("6b1f3c2e-4d5a-4b6c-8d7e-9f0a1b2c3d4e");
    expect(status).toBe(200);
    expect(attempts).toBe(1);
    expect(typeof durationMs).toBe("number");
  });

  it("passes every per-call option on: correlationId, headers and maxRetries", async () => {
    const id = "0b6f2d4e-8c1a-4e3b-9f5d-2a7c6e1b4d90";
    const { haau3, received } = client(() => answer({}, 503));
    await haau3.get("/v1/scheduling/publishers", { correlationId: id, headers: { "x-extra": "1" }, maxRetries: 0 }).catch(() => undefined);
    expect(received).toHaveLength(1);
    expect(received[0]!.headers["x-request-id"]).toBe(id);
    expect(received[0]!.headers["x-extra"]).toBe("1");
  });

  it("sends no key with none, in the Sandbox", async () => {
    const { fetch, received } = fakeFetch(() => fhirAnswer({ resourceType: "CapabilityStatement" }));
    const haau3 = new Haau3({ apiKey: "", environment: "sandbox", fetch, maxRetries: 0 });
    await haau3.get("/v1/fhir/r4/metadata");
    expect(received[0]!.url.origin).toBe("https://sandbox.haau3.com");
    expect(received[0]!.headers.authorization).toBeUndefined();
  });
});

describe("post()", () => {
  it("sends the body as JSON, with FHIR's media type on the FHIR base", async () => {
    const { haau3, received } = client(() => fhirAnswer({ resourceType: "Parameters" }));
    const body = { resourceType: "Parameters", parameter: [] };
    expect(await haau3.post("/v1/fhir/r4/$structure-dosage", { body, expects: ["Parameters"] })).toEqual({ resourceType: "Parameters" });
    expect(received[0]!.method).toBe("POST");
    expect(received[0]!.url.pathname).toBe("/v1/fhir/r4/$structure-dosage");
    expect(received[0]!.headers["content-type"]).toBe("application/fhir+json");
    expect(JSON.parse(received[0]!.body!)).toEqual(body);
  });

  it("sends a string body as it is", async () => {
    const { haau3, received } = client(() => fhirAnswer({ resourceType: "Bundle" }));
    await haau3.post("/v1/fhir/r4", { body: '{"resourceType":"Bundle"}' });
    expect(received[0]!.body).toBe('{"resourceType":"Bundle"}');
  });
});

describe("the errors every operation's own method throws", () => {
  it("401 is an AuthError", async () => {
    const error = await client(() => fhirAnswer(outcome("login"), 401)).haau3.get("/v1/fhir/r4/metadata").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthError);
    expect(error).toMatchObject({ status: 401, requestId: "6b1f3c2e-4d5a-4b6c-8d7e-9f0a1b2c3d4e" });
  });

  it("403 is a ForbiddenError with the API's code; not-open-to-customers says so in words", async () => {
    const error = (await client(() => fhirAnswer(outcome("forbidden", "not-open-to-customers"), 403))
      .haau3.post("/v1/fhir/r4/$process-message", { body: {} })
      .catch((e: unknown) => e)) as ForbiddenError;
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.code).toBe("not-open-to-customers");
    expect(error.message).toBe("POST /v1/fhir/r4/$process-message was refused: the operation is not yet open to customers (403).");
  });

  it("a 403 without a code keeps the general sentence (control)", async () => {
    const error = (await client(() => fhirAnswer(outcome("forbidden"), 403)).haau3.get("/v1/fhir/r4/metadata").catch((e: unknown) => e)) as ForbiddenError;
    expect(error.code).toBeUndefined();
    expect(error.message).toMatch(/its organization may not make this request \(403\)\.$/);
  });

  it("another 4xx is a RefusedError", async () => {
    const error = await client(() => fhirAnswer(outcome("not-found"), 404)).haau3.get(PRACTITIONER, { pathParams: { id: "x" } }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RefusedError);
    expect(error).toMatchObject({ status: 404 });
  });

  it("429 is a NoAnswerError, rate-limited, with Retry-After", async () => {
    const error = (await client(() => fhirAnswer(outcome("throttled"), 429, { "retry-after": "12" })).haau3.get("/v1/fhir/r4/metadata").catch((e: unknown) => e)) as NoAnswerError;
    expect(error).toBeInstanceOf(NoAnswerError);
    expect(error.reason).toBe("rate-limited");
    expect(error.retryAfter).toBe(12);
  });

  it("503 is a NoAnswerError, unavailable", async () => {
    const error = (await client(() => fhirAnswer(outcome("transient"), 503)).haau3.get("/v1/fhir/r4/metadata").catch((e: unknown) => e)) as NoAnswerError;
    expect(error.reason).toBe("unavailable");
  });

  it("an answer of another type than expects names is a NoAnswerError, unreadable", async () => {
    const error = (await client(() => fhirAnswer({ resourceType: "OperationOutcome" })).haau3
      .get(PRACTITIONER, { pathParams: { id: "x" }, expects: ["Practitioner"] })
      .catch((e: unknown) => e)) as NoAnswerError;
    expect(error).toBeInstanceOf(NoAnswerError);
    expect(error.reason).toBe("unreadable");
  });

  it("without expects, any answer is returned (control)", async () => {
    expect(await client(() => fhirAnswer({ resourceType: "OperationOutcome" })).haau3.get(PRACTITIONER, { pathParams: { id: "x" } })).toEqual({
      resourceType: "OperationOutcome",
    });
  });

  it("names the path as written, never a value or the key, however the error is printed", async () => {
    for (const status of [401, 403, 404, 429, 503]) {
      const error = await client(() => fhirAnswer(outcome("x"), status)).haau3.get(PRACTITIONER, { pathParams: { id: VALUE } }).catch((e: unknown) => e);
      expect((error as Error).message, String(status)).toContain(PRACTITIONER);
      expect(printed(error), String(status)).not.toContain(VALUE);
      expect(printed(error), String(status)).not.toContain(KEY);
    }
  });
});

describe("a path that does not match its values is refused before anything is sent", () => {
  it.each([
    ["a {name} with no value", PRACTITIONER, {}, /pathParams has no value for \{id\}/],
    ["no pathParams at all", PRACTITIONER, undefined, /pathParams has no value for \{id\}/],
    ["a value with no {name}", "/v1/fhir/r4/metadata", { id: VALUE }, /the path has no \{id\} for pathParams' value/],
    ["a value that is not a string", PRACTITIONER, { id: 7 as unknown as string }, /the value for \{id\} in pathParams must be a string/],
  ])("%s", async (_what, path, pathParams, message) => {
    const { haau3, received } = client(() => fhirAnswer({ resourceType: "Practitioner" }));
    const error = await haau3.get(path, { pathParams }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Haau3Error);
    expect((error as Error).message).toMatch(message);
    expect(printed(error)).not.toContain(VALUE);
    expect(received).toHaveLength(0);
  });

  it("refuses a whole URL on another host, and sends nothing", async () => {
    const { haau3, received } = client(() => fhirAnswer({}));
    const error = await haau3.get("https://elsewhere.example/v1/fhir/r4/metadata").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Haau3Error);
    expect((error as Error).message).toMatch(/Refusing to send the API key to https:\/\/elsewhere\.example/);
    expect(received).toHaveLength(0);
  });

  it("rejects the call rather than throwing at it, so a caller's .catch() sees it", async () => {
    const { haau3 } = client(() => fhirAnswer({}));
    let call: Promise<unknown> | undefined;
    expect(() => {
      call = haau3.get(PRACTITIONER);
    }).not.toThrow();
    await expect(call).rejects.toBeInstanceOf(Haau3Error);
  });
});
