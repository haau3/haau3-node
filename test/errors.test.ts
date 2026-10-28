// The four kinds of error, and the rule that no body the API answered with is ever printed.
import { inspect } from "node:util";
import { describe, expect, it } from "vitest";
import { AuthError, ForbiddenError, Haau3, Haau3Error, NoAnswerError, RefusedError } from "../src/index.js";
import { KEY, answer, fakeFetch, fhirAnswer } from "./helpers.js";

/** What an answer can repeat from a request that carried a patient's records. */
const PATIENT = "Jane Q Example, born 1950-02-03, MRN 4455667";

const outcome = (diagnostics: string) => ({
  resourceType: "OperationOutcome",
  issue: [{ severity: "error", code: "invalid", diagnostics }],
});

const failWith = (response: () => Response) =>
  new Haau3({ apiKey: KEY, fetch: fakeFetch(response).fetch, maxRetries: 0 });

/** Every way an error commonly reaches a log line. */
function printed(error: unknown): string {
  const e = error as Error;
  return [inspect(error, { depth: 10 }), String(error), e.message, e.stack ?? "", JSON.stringify(error)].join("\n");
}

describe("the four kinds", () => {
  it("answers 401 with AuthError and 403 with ForbiddenError, each carrying the outcome", async () => {
    for (const [status, kind] of [[401, AuthError], [403, ForbiddenError]] as const) {
      const error = await failWith(() => fhirAnswer(outcome("key"), status)).readInsurancePlan("x").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(kind);
      expect(error).toBeInstanceOf(Haau3Error);
      expect(error).toMatchObject({ status, requestId: "6b1f3c2e-4d5a-4b6c-8d7e-9f0a1b2c3d4e" });
      expect((error as AuthError | ForbiddenError).outcome?.issue[0]?.diagnostics).toBe("key");
    }
  });

  it("answers 403 with ForbiddenError, which says the key was accepted", async () => {
    const error = (await failWith(() => fhirAnswer(outcome("not yet open"), 403)).readInsurancePlan("x").catch((e: unknown) => e)) as ForbiddenError;
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error).toBeInstanceOf(Haau3Error);
    // A 403 is not a key the API did not accept, so code that catches AuthError to rotate a key
    // never catches it.
    expect(error).not.toBeInstanceOf(AuthError);
    expect(error.name).toBe("ForbiddenError");
    expect(error.status).toBe(403);
    expect(error.message).toBe("GET /v1/fhir/r4/InsurancePlan/{id} was refused: the API key was accepted, and its organization may not make this request (403).");
    expect(error.message).not.toMatch(/not accepted/);
    expect(error.outcome?.issue[0]?.diagnostics).toBe("not yet open");
    expect(error.toJSON()).toMatchObject({ name: "ForbiddenError", status: 403 });
  });

  it("answers 401 with AuthError alone, saying the key was not accepted (control for the 403)", async () => {
    const error = (await failWith(() => fhirAnswer(outcome("key"), 401)).readInsurancePlan("x").catch((e: unknown) => e)) as AuthError;
    expect(error).not.toBeInstanceOf(ForbiddenError);
    expect(error.name).toBe("AuthError");
    expect(error.message).toBe("GET /v1/fhir/r4/InsurancePlan/{id} was refused: the API key was not accepted (401).");
  });

  it("carries a problem on a 403 off the FHIR base, as it does an outcome on it", async () => {
    const problem = { type: "https://docs.haau3.com/errors#forbidden", title: "Forbidden", status: 403, detail: "d", instance: "urn:uuid:x" };
    const error = (await failWith(() => answer(problem, 403, {}, "application/problem+json"))
      .searchSlots({ state: "MA" })
      .catch((e: unknown) => e)) as ForbiddenError;
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.problem).toEqual(problem);
    expect(error.outcome).toBeUndefined();
  });

  it("answers other 4xx with RefusedError, telling 404 from 410", async () => {
    for (const status of [400, 404, 410, 413]) {
      const error = await failWith(() => fhirAnswer(outcome("no"), status)).readInsurancePlan("x").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(RefusedError);
      expect((error as RefusedError).status).toBe(status);
    }
  });

  it("carries Scheduling's problem, not an outcome, off the FHIR base", async () => {
    const problem = { type: "https://docs.haau3.com/errors#invalid-request", title: "Invalid request", status: 400, detail: "d", instance: "urn:uuid:x" };
    const error = (await failWith(() => answer(problem, 400, {}, "application/problem+json"))
      .searchSlots({ state: "MA" })
      .catch((e: unknown) => e)) as RefusedError;
    expect(error.problem).toEqual(problem);
    expect(error.outcome).toBeUndefined();
  });

  it("answers 429, 5xx and a body that is not JSON with NoAnswerError, naming the reason", async () => {
    const cases: [number, string][] = [
      [429, "rate-limited"],
      [500, "server-error"],
      [502, "unavailable"],
      [503, "unavailable"],
      [504, "timeout"],
    ];
    for (const [status, reason] of cases) {
      const error = await failWith(() => fhirAnswer(outcome("down"), status)).readInsurancePlan("x").catch((e: unknown) => e);
      expect(error).toBeInstanceOf(NoAnswerError);
      expect(error).toMatchObject({ status, reason });
    }
    const html = await failWith(() => new Response("<html>", { status: 200, headers: { "content-type": "text/html" } }))
      .readInsurancePlan("x")
      .catch((e: unknown) => e);
    expect(html).toMatchObject({ name: "NoAnswerError", reason: "unreadable", status: 200 });
  });

  it("says which operation in its message, never a value the caller sent", async () => {
    const error = (await failWith(() => fhirAnswer(outcome("no"), 404)).readInsurancePlan("H2406-013-000").catch((e: unknown) => e)) as Error;
    expect(error.message).toBe("GET /v1/fhir/r4/InsurancePlan/{id} was refused (404).");
  });
});

describe("a body is readable and never printed", () => {
  it("keeps a refusal's outcome out of every way an error is logged", async () => {
    const error = await failWith(() => fhirAnswer(outcome(PATIENT), 400))
      .reconcileMedications({ resourceType: "Bundle", type: "collection", entry: [] })
      .catch((e: unknown) => e);
    expect((error as RefusedError).outcome?.issue[0]?.diagnostics).toBe(PATIENT);
    expect(printed(error)).not.toContain("Jane");
    expect(printed(error)).not.toContain("4455667");
  });

  it("does the same for AuthError, ForbiddenError and NoAnswerError", async () => {
    const auth = await failWith(() => fhirAnswer(outcome(PATIENT), 401)).readInsurancePlan("x").catch((e: unknown) => e);
    const forbidden = await failWith(() => fhirAnswer(outcome(PATIENT), 403)).readInsurancePlan("x").catch((e: unknown) => e);
    const none = await failWith(() => fhirAnswer(outcome(PATIENT), 503)).readInsurancePlan("x").catch((e: unknown) => e);
    expect(forbidden).toBeInstanceOf(ForbiddenError);
    for (const error of [auth, forbidden, none]) {
      expect((error as AuthError | ForbiddenError | NoAnswerError).outcome?.issue[0]?.diagnostics).toBe(PATIENT);
      expect(printed(error)).not.toContain("Jane");
    }
  });

  it("would catch a body that is printed (the control)", async () => {
    const error = (await failWith(() => fhirAnswer(outcome(PATIENT), 400)).readInsurancePlan("x").catch((e: unknown) => e)) as RefusedError;
    const careless = Object.assign(new Error(error.message), { outcome: error.outcome });
    expect(printed(careless)).toContain("Jane");
  });

  it("never prints the API key", async () => {
    const error = await failWith(() => fhirAnswer(outcome("no"), 401)).readInsurancePlan("x").catch((e: unknown) => e);
    expect(printed(error)).not.toContain(KEY);
  });
});

// A 403 names its reason when the API names it by a code of its own: in an OperationOutcome's
// `api-error` coding on a FHIR base, or in a problem's `code` elsewhere. The message says it in
// words chosen by the code, never the body's.
describe("a 403's code", () => {
  const API_ERROR = "https://haau3.com/fhir/CodeSystem/api-error";
  const coded = (code: string, system = API_ERROR) => ({
    resourceType: "OperationOutcome",
    issue: [{ severity: "error", code: "forbidden", details: { coding: [{ system, code }], text: "the API's own words" } }],
  });
  const bundle = { resourceType: "Bundle", type: "message", entry: [] } as never;

  it("names a test key outside the Sandbox, from the outcome's coding", async () => {
    const error = (await failWith(() => fhirAnswer(coded("test-key-outside-sandbox"), 403))
      .readInsurancePlan("x")
      .catch((e: unknown) => e)) as ForbiddenError;
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error.code).toBe("test-key-outside-sandbox");
    expect(error.message).toBe(
      "GET /v1/fhir/r4/InsurancePlan/{id} was refused: this is a test key, which works only in the Sandbox (403).",
    );
    expect(error.message).not.toContain("the API's own words");
    expect(error.toJSON()).toMatchObject({ name: "ForbiddenError", status: 403, code: "test-key-outside-sandbox" });
  });

  it("names a live key in the Sandbox", async () => {
    const error = (await failWith(() => fhirAnswer(coded("live-key-in-sandbox"), 403))
      .sandboxProcessMessage(bundle)
      .catch((e: unknown) => e)) as ForbiddenError;
    expect(error.code).toBe("live-key-in-sandbox");
    expect(error.message).toBe(
      "POST /v1/sandbox/fhir/r4/$process-message was refused: this is a live key, which does not work in the Sandbox (403).",
    );
  });

  it("reads the code from a problem off the FHIR bases", async () => {
    const problem = {
      type: "https://docs.haau3.com/errors#forbidden",
      title: "Forbidden",
      status: 403,
      detail: "d",
      instance: "urn:uuid:x",
      code: "test-key-outside-sandbox",
    };
    const error = (await failWith(() => answer(problem, 403, {}, "application/problem+json"))
      .searchSlots({ state: "MA" })
      .catch((e: unknown) => e)) as ForbiddenError;
    expect(error.code).toBe("test-key-outside-sandbox");
    expect(error.message).toBe("GET /v1/scheduling/slots was refused: this is a test key, which works only in the Sandbox (403).");
  });

  it("names patient data not all labelled as test data, and never as a refused key", async () => {
    const error = (await failWith(() => fhirAnswer(coded("phi-agreement-required"), 403))
      .reconcileMedications({ resourceType: "Bundle", type: "collection", entry: [] })
      .catch((e: unknown) => e)) as ForbiddenError;
    expect(error).toBeInstanceOf(ForbiddenError);
    expect(error).not.toBeInstanceOf(AuthError);
    expect(error.code).toBe("phi-agreement-required");
    expect(error.message).toBe(
      "POST /v1/fhir/r4/$reconcile-medications was refused: its organization may not send patient data, and not every resource in this request is labelled as test data (403).",
    );
    expect(error.message).not.toContain("the API's own words");
    expect(error.toJSON()).toMatchObject({ name: "ForbiddenError", status: 403, code: "phi-agreement-required" });
  });

  it("carries a code it has no sentence for, under the general message", async () => {
    const error = (await failWith(() => fhirAnswer(coded("a-code-from-a-later-version"), 403))
      .readInsurancePlan("x")
      .catch((e: unknown) => e)) as ForbiddenError;
    expect(error.code).toBe("a-code-from-a-later-version");
    expect(error.message).toBe(
      "GET /v1/fhir/r4/InsurancePlan/{id} was refused: the API key was accepted, and its organization may not make this request (403).",
    );
  });

  // Negative controls: no code, and a code from another system, are not the API's reason.
  it("has no code when the API names none, or names one in another system", async () => {
    for (const body of [outcome("not yet open"), coded("test-key-outside-sandbox", "http://example.org/other")]) {
      const error = (await failWith(() => fhirAnswer(body, 403)).readInsurancePlan("x").catch((e: unknown) => e)) as ForbiddenError;
      expect(error.code).toBeUndefined();
      expect(error.message).toMatch(/the API key was accepted, and its organization may not make this request \(403\)\.$/);
    }
  });
});

// Every answer and every error the API answered carries its status's text: the answer's own, or the
// standard one when it came with none, as HTTP/2 answers do.
describe("status text", () => {
  const plan = { resourceType: "InsurancePlan", id: "H2406-013-000" };
  const withText = (body: unknown, status: number, statusText: string) =>
    new Response(JSON.stringify(body), { status, statusText, headers: { "content-type": "application/fhir+json" } });

  it("is on a typed call's answer: the standard text when the answer has none, its own when it has", async () => {
    const standard = await failWith(() => fhirAnswer(plan)).readInsurancePlan("x").withResponse();
    expect(standard.status).toBe(200);
    expect(standard.statusText).toBe("OK");
    const own = await failWith(() => withText(plan, 200, "Fine")).readInsurancePlan("x").withResponse();
    expect(own.statusText).toBe("Fine");
  });

  it("is on each error the API answered", async () => {
    const auth = (await failWith(() => fhirAnswer(outcome("key"), 401)).readInsurancePlan("x").catch((e: unknown) => e)) as AuthError;
    const forbidden = (await failWith(() => fhirAnswer(outcome("no"), 403)).readInsurancePlan("x").catch((e: unknown) => e)) as ForbiddenError;
    const refused = (await failWith(() => withText(outcome("no"), 404, "Nothing Here"))
      .readInsurancePlan("x")
      .catch((e: unknown) => e)) as RefusedError;
    const none = (await failWith(() => fhirAnswer(outcome("down"), 503)).readInsurancePlan("x").catch((e: unknown) => e)) as NoAnswerError;
    expect([auth.statusText, forbidden.statusText, refused.statusText, none.statusText]).toEqual([
      "Unauthorized",
      "Forbidden",
      "Nothing Here",
      "Service Unavailable",
    ]);
    expect(none.toJSON()).toMatchObject({ status: 503, statusText: "Service Unavailable" });
  });

  // Negative control: a request that got no answer has no status, so no status text either.
  it("is unset when no answer came", async () => {
    const fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as typeof globalThis.fetch;
    const error = (await new Haau3({ apiKey: KEY, maxRetries: 0, fetch }).readInsurancePlan("x").catch((e: unknown) => e)) as NoAnswerError;
    expect(error.reason).toBe("network");
    expect(error.status).toBeUndefined();
    expect(error.statusText).toBeUndefined();
    expect(error.toJSON()).not.toHaveProperty("statusText");
  });
});
