// What 0.2.3 adds to every answer and every failure: what failed, in words safe to log; the status's
// text; the language and runtime in the User-Agent; no `null` query values; no paging loop; and FHIR
// JSON asked for under a baseURL with a path of its own.
import { describe, expect, it } from "vitest";
import { Haau3, NoAnswerError, VERSION } from "../src/index.js";
import { failureDetail } from "../src/transport.js";
import { KEY, answer, fakeFetch, fhirAnswer } from "./helpers.js";

/** Node's fetch failure: a TypeError "fetch failed" whose cause says what the system saw. */
const fetchFailed = (cause: unknown) => Object.assign(new TypeError("fetch failed"), { cause });

describe("detail, on a failure with no answer", () => {
  it("is the system's code, never the message that names the address", async () => {
    const refused = Object.assign(new Error("connect ECONNREFUSED 10.1.2.3:443"), { code: "ECONNREFUSED" });
    const { fetch } = fakeFetch(() => {
      throw fetchFailed(refused);
    });
    const error = await new Haau3({ apiKey: KEY, fetch, maxRetries: 0 }).readInsurancePlan("H1").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NoAnswerError);
    expect((error as NoAnswerError).detail).toBe("ECONNREFUSED");
    expect((error as NoAnswerError).toJSON()).toMatchObject({ reason: "network", detail: "ECONNREFUSED" });
    expect(JSON.stringify(error)).not.toContain("10.1.2.3");
    expect((error as NoAnswerError).message).not.toContain("10.1.2.3");
  });

  it("reads the code of a refusal Node reports as an AggregateError, one error per address", () => {
    // Measured 2026-10-18 on Node 24: fetch to localhost tries ::1 and 127.0.0.1.
    const refused = Object.assign(
      new AggregateError([new Error("connect ECONNREFUSED ::1:3999"), new Error("connect ECONNREFUSED 127.0.0.1:3999")], ""),
      { code: "ECONNREFUSED" },
    );
    expect(failureDetail(fetchFailed(refused))).toBe("ECONNREFUSED");
    const inner = new AggregateError([Object.assign(new Error("getaddrinfo ENOTFOUND x"), { code: "ENOTFOUND" })], "");
    expect(failureDetail(fetchFailed(inner))).toBe("ENOTFOUND");
  });

  it("names a timeout by the error's name", async () => {
    const { fetch } = fakeFetch(
      (request) =>
        new Promise<Response>((_, reject) => {
          request.signal?.addEventListener("abort", () => reject(request.signal!.reason));
        }),
    );
    const error = await new Haau3({ apiKey: KEY, fetch, timeout: 20, maxRetries: 0 }).readInsurancePlan("H1").catch((e: unknown) => e);
    expect(error).toMatchObject({ reason: "timeout", detail: "TimeoutError" });
  });

  it("falls back to the deepest error's name, and to Error", () => {
    expect(failureDetail(fetchFailed(new RangeError("x")))).toBe("RangeError");
    expect(failureDetail("a string")).toBe("Error");
    expect(failureDetail({ code: "not a code: has spaces" })).toBe("Error");
  });

  it("is unset on an error the API answered", async () => {
    const { fetch } = fakeFetch(() => fhirAnswer({}, 503));
    const error = await new Haau3({ apiKey: KEY, fetch, maxRetries: 0 }).readInsurancePlan("H1").catch((e: unknown) => e);
    expect((error as NoAnswerError).detail).toBeUndefined();
    expect((error as NoAnswerError).toJSON()).not.toHaveProperty("detail");
  });
});

describe("statusText, on request()", () => {
  it("is the answer's own text, or the standard one when it sent none", async () => {
    const own = fakeFetch(() => new Response("{}", { status: 404, statusText: "Not Here", headers: { "content-type": "application/json" } }));
    expect((await new Haau3({ apiKey: KEY, fetch: own.fetch }).request({ method: "GET", path: "/v1/x" })).statusText).toBe("Not Here");
    const none = fakeFetch(() => new Response("{}", { status: 429, headers: { "content-type": "application/json" } }));
    const raw = await new Haau3({ apiKey: KEY, fetch: none.fetch, maxRetries: 0 }).request({ method: "GET", path: "/v1/x" });
    expect(raw.statusText).toBe("Too Many Requests");
    const odd = fakeFetch(() => new Response("{}", { status: 299 }));
    expect((await new Haau3({ apiKey: KEY, fetch: odd.fetch }).request({ method: "GET", path: "/v1/x" })).statusText).toBe("");
  });
});

describe("the User-Agent", () => {
  it("names the SDK, its version, the language's runtime and its major version", async () => {
    const { fetch, received } = fakeFetch(() => answer({ publishers: [] }));
    await new Haau3({ apiKey: KEY, fetch }).listPublishers();
    expect(received[0]!.headers["user-agent"]).toBe(`haau3-node/${VERSION} (node ${process.versions.node.split(".")[0]})`);
  });
});

describe("a null query value", () => {
  it("is not sent, alone or in a list", async () => {
    const { fetch, received } = fakeFetch(() => answer({ slots: [], total: 0 }));
    await new Haau3({ apiKey: KEY, fetch }).searchSlots({ state: null, city: "Boston" } as never);
    expect(received[0]!.url.search).toBe("?city=Boston");
    await new Haau3({ apiKey: KEY, fetch }).request({ method: "GET", path: "/v1/x", query: { npi: ["1", null, "2"] as never, x: null as never } });
    expect(received[1]!.url.search).toBe("?npi=1&npi=2");
  });
});

describe("pages()", () => {
  it("stops at a next link to a page already read", async () => {
    const second = "https://api.haau3.com/v1/fhir/r4/InsurancePlan?page=B";
    const page = (next: string) => ({ resourceType: "Bundle", type: "searchset", link: [{ relation: "next", url: next }] });
    const { fetch, received } = fakeFetch(() => fhirAnswer(page(second)));
    const pages = new Haau3({ apiKey: KEY, fetch }).pages(page(second) as never);
    await expect(pages.next()).resolves.toMatchObject({ done: false });
    await expect(pages.next()).resolves.toMatchObject({ done: false });
    const error = await pages.next().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NoAnswerError);
    expect(error).toMatchObject({
      reason: "unreadable",
      message: "GET /v1/fhir/r4/InsurancePlan answered with a next link to a page already read, so paging stopped.",
    });
    expect(received).toHaveLength(1);
  });
});

describe("a baseURL with a path of its own", () => {
  it("still asks for FHIR JSON on the FHIR base", async () => {
    const { fetch, received } = fakeFetch(() => fhirAnswer({ resourceType: "InsurancePlan" }));
    await new Haau3({ apiKey: KEY, fetch, baseURL: "https://proxy.example.test/api/" }).readInsurancePlan("H1");
    expect(received[0]!.url.href).toBe("https://proxy.example.test/api/v1/fhir/r4/InsurancePlan/H1");
    expect(received[0]!.headers.accept).toBe("application/fhir+json");
  });
});
