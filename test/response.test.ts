// What a typed call gives besides its answer, the answer types it checks, and what it passes on to
// fetch: `.withResponse()`, timing on every error, `expects`, and `fetchOptions` over a no-store default.
import { describe, expect, it, vi } from "vitest";
import { APIPromise, AuthError, Haau3, NoAnswerError, RefusedError } from "../src/index.js";
import { KEY, answer, fakeFetch, fhirAnswer } from "./helpers.js";

const PLAN = { resourceType: "InsurancePlan", id: "H2406-013-000" };
const REQUEST_ID = "6b1f3c2e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";

/** A fetch that keeps every init it was given, whole. */
function initRecorder(respond: () => Response = () => fhirAnswer(PLAN)) {
  const inits: RequestInit[] = [];
  const fetch = (async (_input: string | URL | Request, init?: RequestInit) => {
    inits.push(init ?? {});
    return respond();
  }) as typeof globalThis.fetch;
  return { fetch, inits };
}

describe("withResponse", () => {
  it("gives the answer with its request id, duration, attempts, status and headers", async () => {
    const { fetch } = fakeFetch(() => fhirAnswer(PLAN));
    const call = new Haau3({ apiKey: KEY, fetch }).readInsurancePlan("H2406-013-000");
    expect(call).toBeInstanceOf(APIPromise);
    const { data, requestId, durationMs, attempts, status, headers } = await call.withResponse();
    expect(data).toEqual(PLAN);
    expect(requestId).toBe(REQUEST_ID);
    expect(durationMs).toBeGreaterThanOrEqual(0);
    expect(attempts).toBe(1);
    expect(status).toBe(200);
    expect(headers.get("x-request-id")).toBe(REQUEST_ID);
  });

  it("still gives the answer alone when awaited, and sends once however it is read", async () => {
    const { fetch, received } = fakeFetch(() => fhirAnswer(PLAN));
    const call = new Haau3({ apiKey: KEY, fetch }).readInsurancePlan("H2406-013-000");
    await expect(call).resolves.toEqual(PLAN);
    expect((await call.withResponse()).data).toEqual(PLAN);
    expect(await call.then((plan) => plan.id)).toBe("H2406-013-000");
    expect(received).toHaveLength(1);
  });

  it("counts the attempts a retry took", async () => {
    const { fetch } = fakeFetch((_, n) => (n === 1 ? fhirAnswer({ resourceType: "OperationOutcome", issue: [] }, 503, { "retry-after": "0" }) : fhirAnswer(PLAN)));
    expect((await new Haau3({ apiKey: KEY, fetch }).readInsurancePlan("x").withResponse()).attempts).toBe(2);
  });

  it("rejects withResponse and the plain await alike when the call fails", async () => {
    const { fetch } = fakeFetch(() => fhirAnswer({ resourceType: "OperationOutcome", issue: [] }, 404));
    const call = new Haau3({ apiKey: KEY, fetch }).readInsurancePlan("x");
    await expect(call.withResponse()).rejects.toBeInstanceOf(RefusedError);
    await expect(call).rejects.toBeInstanceOf(RefusedError);
    await expect(call.catch((e: unknown) => (e as RefusedError).status)).resolves.toBe(404);
  });
});

describe("timing on errors", () => {
  it("gives every answered error its attempts and duration", async () => {
    const refused = await new Haau3({ apiKey: KEY, fetch: fakeFetch(() => fhirAnswer({ resourceType: "OperationOutcome", issue: [] }, 404)).fetch })
      .readInsurancePlan("x")
      .catch((e: unknown) => e);
    expect(refused).toBeInstanceOf(RefusedError);
    expect(refused).toMatchObject({ attempts: 1, requestId: REQUEST_ID });
    expect((refused as RefusedError).durationMs).toBeGreaterThanOrEqual(0);

    const auth = await new Haau3({ apiKey: KEY, fetch: fakeFetch(() => answer({ type: "x", status: 401 }, 401)).fetch })
      .listPublishers()
      .catch((e: unknown) => e);
    expect(auth).toBeInstanceOf(AuthError);
    expect((auth as AuthError).durationMs).toBeGreaterThanOrEqual(0);
  });

  it("gives a request that got no answer at all its duration too", async () => {
    const unreachable = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    const error = await new Haau3({ apiKey: KEY, fetch: unreachable.fetch, maxRetries: 0 }).readInsurancePlan("x").catch((e: unknown) => e);
    expect(error).toMatchObject({ reason: "network", attempts: 1 });
    expect((error as NoAnswerError).durationMs).toBeGreaterThanOrEqual(0);
  });
});

describe("answer types", () => {
  it("refuses a FHIR answer of another type, naming both types and no value", async () => {
    const { fetch } = fakeFetch(() => fhirAnswer({ resourceType: "Bundle", type: "searchset", entry: [] }));
    const error = await new Haau3({ apiKey: KEY, fetch }).readInsurancePlan("A-PLAN-ID-THE-MESSAGE-MUST-NOT-CARRY").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NoAnswerError);
    expect(error).toMatchObject({ reason: "unreadable", status: 200, requestId: REQUEST_ID });
    expect((error as Error).message).toBe("GET /v1/fhir/r4/InsurancePlan/{id} answered a Bundle where an InsurancePlan was expected.");
  });

  it("says less about an answer whose resourceType is not a plausible type name", async () => {
    const { fetch } = fakeFetch(() => fhirAnswer({ resourceType: "<b>not a type</b>" }));
    const error = await new Haau3({ apiKey: KEY, fetch }).readInsurancePlan("x").catch((e: unknown) => e);
    expect((error as Error).message).toBe("GET /v1/fhir/r4/InsurancePlan/{id} answered something that is not a FHIR resource where an InsurancePlan was expected.");
  });

  it("takes any of the types an operation answers with", async () => {
    for (const resourceType of ["CapabilityStatement", "TerminologyCapabilities"]) {
      const { fetch } = fakeFetch(() => fhirAnswer({ resourceType }));
      await expect(new Haau3({ apiKey: KEY, fetch }).fhirMetadata()).resolves.toEqual({ resourceType });
    }
    const { fetch } = fakeFetch(() => fhirAnswer({ resourceType: "Bundle" }));
    await expect(new Haau3({ apiKey: KEY, fetch }).fhirMetadata()).rejects.toThrow("where a CapabilityStatement or a TerminologyCapabilities was expected");
  });

  it("checks no type on an answer the spec does not mark as FHIR", async () => {
    const { fetch } = fakeFetch(() => answer({ publishers: [] }));
    await expect(new Haau3({ apiKey: KEY, fetch }).listPublishers()).resolves.toEqual({ publishers: [] });
  });

  it("checks each page pages() follows is a Bundle", async () => {
    const { fetch } = fakeFetch(() => fhirAnswer(PLAN));
    const haau3 = new Haau3({ apiKey: KEY, fetch });
    const first = { resourceType: "Bundle" as const, type: "searchset" as const, link: [{ relation: "next", url: "https://api.haau3.com/v1/fhir/r4/InsurancePlan?page=2" }] };
    const pages = haau3.pages(first);
    await pages.next();
    await expect(pages.next()).rejects.toThrow("answered an InsurancePlan where a Bundle was expected");
  });
});

describe("fetchOptions", () => {
  it("sends every request no-store by default, typed and raw", async () => {
    const { fetch, inits } = initRecorder();
    const haau3 = new Haau3({ apiKey: KEY, fetch });
    await haau3.readInsurancePlan("x");
    await haau3.request({ method: "GET", path: "/v1/fhir/r4/InsurancePlan/x" });
    expect(inits.map((init) => init.cache)).toEqual(["no-store", "no-store"]);
  });

  it("passes the client's options on, and one call's over the client's", async () => {
    const { fetch, inits } = initRecorder();
    const haau3 = new Haau3({ apiKey: KEY, fetch, fetchOptions: { cache: "force-cache", keepalive: true } });
    await haau3.readInsurancePlan("x");
    await haau3.readInsurancePlan("x", { fetchOptions: { cache: "reload" } });
    expect(inits[0]).toMatchObject({ cache: "force-cache", keepalive: true });
    expect(inits[1]).toMatchObject({ cache: "reload", keepalive: true });
  });

  it("adds no cache when the caller sets Next.js's next, and sends none when told cache: undefined", async () => {
    const { fetch, inits } = initRecorder();
    const haau3 = new Haau3({ apiKey: KEY, fetch });
    await haau3.readInsurancePlan("x", { fetchOptions: { next: { revalidate: 60 } } as RequestInit });
    await haau3.readInsurancePlan("x", { fetchOptions: { cache: undefined } });
    expect(inits[0]!.cache).toBeUndefined();
    expect((inits[0] as { next?: unknown }).next).toEqual({ revalidate: 60 });
    expect(inits[1]!.cache).toBeUndefined();
  });

  it("passes on whatever else the runtime's fetch takes, such as a dispatcher", async () => {
    const { fetch, inits } = initRecorder();
    const dispatcher = { name: "a proxy agent" };
    await new Haau3({ apiKey: KEY, fetch, fetchOptions: { dispatcher } as RequestInit }).readInsurancePlan("x");
    expect((inits[0] as { dispatcher?: unknown }).dispatcher).toBe(dispatcher);
  });

  it("sends no cache on a runtime whose fetch refuses the field", async () => {
    const Real = globalThis.Request;
    vi.stubGlobal(
      "Request",
      class extends Real {
        constructor(input: RequestInfo | URL, init?: RequestInit) {
          if (init && "cache" in init) throw new TypeError("The 'cache' field is not implemented.");
          super(input, init);
        }
      },
    );
    try {
      const { fetch, inits } = initRecorder();
      await new Haau3({ apiKey: KEY, fetch }).readInsurancePlan("x");
      expect("cache" in inits[0]!).toBe(false);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("never lets fetchOptions replace the method, headers, body, signal or redirect", async () => {
    const { fetch, inits } = initRecorder();
    const sneaky = { method: "DELETE", headers: { authorization: "Bearer someone-else" }, redirect: "follow", body: "x" } as RequestInit;
    await new Haau3({ apiKey: KEY, fetch, fetchOptions: sneaky }).readInsurancePlan("x");
    expect(inits[0]).toMatchObject({ method: "GET", redirect: "manual", body: undefined });
    expect((inits[0]!.headers as Record<string, string>).authorization).toBe(`Bearer ${KEY}`);
    expect(inits[0]!.signal).toBeInstanceOf(AbortSignal);
  });
});

describe("a bad baseURL", () => {
  it("rejects the call rather than throwing at it", async () => {
    const haau3 = new Haau3({ apiKey: KEY, fetch: initRecorder().fetch, baseURL: "not a url" });
    let call: Promise<unknown> | undefined;
    expect(() => {
      call = haau3.readInsurancePlan("x");
    }).not.toThrow();
    await expect(call).rejects.toBeInstanceOf(TypeError);
  });
});
