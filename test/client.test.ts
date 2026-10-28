// The client's construction, its guards, pages() and request().
import { readFileSync } from "node:fs";
import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Haau3, Haau3Error, RefusedError, VERSION } from "../src/index.js";
import { KEY, answer, fakeFetch, fhirAnswer } from "./helpers.js";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("construction", () => {
  it("reads HAAU3_API_KEY when no apiKey is passed", async () => {
    vi.stubEnv("HAAU3_API_KEY", "haau3_sk_from_the_environment");
    const { fetch, received } = fakeFetch(() => answer({ publishers: [] }));
    await new Haau3({ fetch }).listPublishers();
    expect(received[0]!.headers.authorization).toBe("Bearer haau3_sk_from_the_environment");
  });

  it("refuses to start with no key at all", () => {
    vi.stubEnv("HAAU3_API_KEY", "");
    expect(() => new Haau3({ fetch: fakeFetch(() => answer({})).fetch })).toThrow(Haau3Error);
    expect(() => new Haau3({ fetch: fakeFetch(() => answer({})).fetch })).toThrow(/HAAU3_API_KEY/);
  });

  it("sends to HAAU3_BASE_URL when no baseURL is passed, and to https://api.haau3.com when neither is set", async () => {
    vi.stubEnv("HAAU3_BASE_URL", "https://stand-in.example/");
    const { fetch, received } = fakeFetch(() => answer({ publishers: [] }));
    const haau3 = new Haau3({ apiKey: KEY, fetch });
    expect(haau3.baseURL).toBe("https://stand-in.example");
    await haau3.listPublishers();
    expect(received[0]!.url.href).toBe("https://stand-in.example/v1/scheduling/publishers");

    vi.stubEnv("HAAU3_BASE_URL", "");
    expect(new Haau3({ apiKey: KEY, fetch }).baseURL).toBe("https://api.haau3.com");
  });

  it("takes the baseURL option over HAAU3_BASE_URL", () => {
    vi.stubEnv("HAAU3_BASE_URL", "https://stand-in.example");
    const { fetch } = fakeFetch(() => answer({}));
    expect(new Haau3({ apiKey: KEY, baseURL: "https://other.example", fetch }).baseURL).toBe("https://other.example");
  });

  it("refuses a bad base URL when the client is made, by the name it came in", () => {
    const { fetch } = fakeFetch(() => answer({}));
    expect(() => new Haau3({ apiKey: KEY, fetch, baseURL: "not a url" })).toThrow(
      'baseURL takes an http or https URL with a host, such as https://api.haau3.com: "not a url" is not one.',
    );
    for (const bad of ["api.haau3.com", "ftp://api.haau3.com", "https://", "https://api.haau3.com/?q=1", "https://api.haau3.com/#top"]) {
      expect(() => new Haau3({ apiKey: KEY, fetch, baseURL: bad }), bad).toThrow(Haau3Error);
    }
    expect(new Haau3({ apiKey: KEY, fetch, baseURL: "http://localhost:8080///" }).baseURL).toBe("http://localhost:8080");

    vi.stubEnv("HAAU3_BASE_URL", "ftp://stand-in.example");
    expect(() => new Haau3({ apiKey: KEY, fetch })).toThrow(/^HAAU3_BASE_URL takes an http or https URL with a host/);
    expect(new Haau3({ apiKey: KEY, fetch, baseURL: "https://api.haau3.com" }).baseURL).toBe("https://api.haau3.com");
  });

  it("sends the key to HAAU3_BASE_URL's host only, once it is set", async () => {
    vi.stubEnv("HAAU3_BASE_URL", "https://stand-in.example");
    const { fetch, received } = fakeFetch(() => answer({}));
    const haau3 = new Haau3({ apiKey: KEY, fetch });
    await expect(haau3.request({ method: "GET", path: "https://api.haau3.com/v1/scheduling/publishers" })).rejects.toThrow(
      /Refusing to send the API key to https:\/\/api\.haau3\.com/,
    );
    expect(received).toHaveLength(0);
  });

  it("refuses to start in a browser, where a key is public", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {});
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh) Chrome/141.0" });
    expect(() => new Haau3({ apiKey: KEY })).toThrow(/server only/);
  });

  it("starts under jsdom, which renders components on a server (the control)", () => {
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", {});
    vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (darwin) AppleWebKit/537.36 (KHTML, like Gecko) jsdom/30.1.2" });
    expect(() => new Haau3({ apiKey: KEY, fetch: fakeFetch(() => answer({})).fetch })).not.toThrow();
  });

  it("never shows its key when the client is printed", () => {
    const haau3 = new Haau3({ apiKey: KEY, fetch: fakeFetch(() => answer({})).fetch });
    expect(inspect(haau3, { depth: 10, showHidden: true })).not.toContain(KEY);
    expect(JSON.stringify(haau3)).not.toContain(KEY);
  });

  it("names the version package.json names", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as { version: string };
    expect(VERSION).toBe(pkg.version);
  });
});

describe("the key never leaves its host", () => {
  it("sends requests to its own baseURL", async () => {
    const { fetch, received } = fakeFetch(() => answer({ publishers: [] }));
    await new Haau3({ apiKey: KEY, fetch, baseURL: "http://localhost:3001/" }).listPublishers();
    expect(received[0]!.url.href).toBe("http://localhost:3001/v1/scheduling/publishers");
  });

  it("refuses a request() to another host before sending anything", async () => {
    const { fetch, received } = fakeFetch(() => answer({}));
    const haau3 = new Haau3({ apiKey: KEY, fetch });
    await expect(haau3.request({ method: "GET", path: "https://example.com/steal" })).rejects.toThrow(/Refusing to send the API key/);
    expect(received).toHaveLength(0);
  });
});

describe("pages()", () => {
  const page = (n: number, next?: string) => ({
    resourceType: "Bundle",
    type: "searchset",
    link: next ? [{ relation: "next", url: next }] : [],
    entry: [{ resource: { resourceType: "InsurancePlan", id: `plan-${n}` } }],
  });

  it("yields the first page and follows each next link on the client's own host", async () => {
    const { fetch, received } = fakeFetch((request) =>
      fhirAnswer(request.url.searchParams.get("page") === "B" ? page(3) : page(2, "https://api.haau3.com/v1/fhir/r4/InsurancePlan?page=B")),
    );
    const haau3 = new Haau3({ apiKey: KEY, fetch });
    const ids: string[] = [];
    for await (const p of haau3.pages(page(1, "https://api.haau3.com/v1/fhir/r4/InsurancePlan?page=A") as never)) {
      ids.push(...(p.entry ?? []).map((entry) => entry.resource!.id!));
    }
    expect(ids).toEqual(["plan-1", "plan-2", "plan-3"]);
    expect(received.map((r) => r.url.searchParams.get("page"))).toEqual(["A", "B"]);
    expect(received[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it("refuses a next link to another host and sends nothing to it", async () => {
    const { fetch, received } = fakeFetch(() => fhirAnswer(page(2)));
    const haau3 = new Haau3({ apiKey: KEY, fetch });
    const pages = haau3.pages(page(1, "https://directory.example.org/fhir/InsurancePlan?page=A") as never);
    await expect(pages.next()).resolves.toMatchObject({ done: false });
    await expect(pages.next()).rejects.toThrow(/Refusing to send the API key to https:\/\/directory\.example\.org/);
    expect(received).toHaveLength(0);
  });
});

describe("resources()", () => {
  const entry = (resourceType: string, id: string, mode?: string) => ({
    resource: { resourceType, id },
    ...(mode ? { search: { mode } } : {}),
  });
  const bundle = (next: string | undefined, ...entries: object[]) => ({
    resourceType: "Bundle",
    type: "searchset",
    link: next ? [{ relation: "next", url: next }] : [],
    entry: entries,
  });

  it("yields the matches of every page, and no included resource or outcome", async () => {
    const second = bundle(
      undefined,
      entry("InsurancePlan", "C", "match"),
      entry("Organization", "included", "include"),
      entry("OperationOutcome", "outcome", "outcome"),
      entry("InsurancePlan", "D"),
      { search: { mode: "match" } },
    );
    const { fetch, received } = fakeFetch(() => fhirAnswer(second));
    const haau3 = new Haau3({ apiKey: KEY, fetch });
    const first = bundle("https://api.haau3.com/v1/fhir/r4/InsurancePlan?page=2", entry("InsurancePlan", "A", "match"), entry("InsurancePlan", "B"));
    const ids: string[] = [];
    for await (const resource of haau3.resources(first as never)) ids.push(`${resource.resourceType}/${resource.id}`);
    expect(ids).toEqual(["InsurancePlan/A", "InsurancePlan/B", "InsurancePlan/C", "InsurancePlan/D"]);
    expect(received).toHaveLength(1);
  });

  it("ends with the error a page ended with", async () => {
    const { fetch } = fakeFetch(() => fhirAnswer({ resourceType: "OperationOutcome", issue: [] }, 404));
    const haau3 = new Haau3({ apiKey: KEY, fetch });
    const first = bundle("https://api.haau3.com/v1/fhir/r4/InsurancePlan?page=2", entry("InsurancePlan", "A"));
    const ids: string[] = [];
    await expect(
      (async () => {
        for await (const resource of haau3.resources(first as never)) ids.push(resource.id!);
      })(),
    ).rejects.toThrow(RefusedError);
    expect(ids).toEqual(["A"]);
  });
});

describe("request()", () => {
  it("returns any status without throwing, with what the API answered", async () => {
    const { fetch } = fakeFetch(() => answer({ type: "x", status: 404 }, 404, {}, "application/problem+json"));
    const response = await new Haau3({ apiKey: KEY, fetch }).request({ method: "GET", path: "/v1/scheduling/nowhere" });
    expect(response).toMatchObject({
      status: 404,
      body: { type: "x", status: 404 },
      requestId: "6b1f3c2e-4d5a-4b6c-8d7e-9f0a1b2c3d4e",
      attempts: 1,
    });
    expect(response.durationMs).toBeGreaterThanOrEqual(0);
  });

  it("sends a string body as it is, and an object as JSON", async () => {
    const { fetch, received } = fakeFetch(() => fhirAnswer({ resourceType: "Bundle" }));
    const haau3 = new Haau3({ apiKey: KEY, fetch });
    const text = '{"resourceType":"Bundle","type":"collection"}';
    await haau3.request({ method: "POST", path: "/v1/fhir/r4/$reconcile-medications", body: text });
    await haau3.request({ method: "POST", path: "/v1/fhir/r4", body: { resourceType: "Bundle", type: "batch" } });
    expect(received[0]!.body).toBe(text);
    expect(received[0]!.headers["content-type"]).toBe("application/fhir+json");
    expect(JSON.parse(received[1]!.body!)).toEqual({ resourceType: "Bundle", type: "batch" });
  });

  it("repeats a list parameter once per value", async () => {
    const { fetch, received } = fakeFetch(() => fhirAnswer({ resourceType: "Parameters" }));
    await new Haau3({ apiKey: KEY, fetch }).checkInsurancePlanNetwork("H3359-038-000", { npi: ["1518929058", "1992700001"] });
    expect(received[0]!.url.searchParams.getAll("npi")).toEqual(["1518929058", "1992700001"]);
    expect(received[0]!.url.pathname).toBe("/v1/fhir/r4/InsurancePlan/H3359-038-000/$in-network");
  });
});

describe("the FHIR bases", () => {
  // The API reads a path equal to or under /v1/fhir or /v1/sandbox/fhir as FHIR, and nothing else.
  const headersAt = async (path: string, baseURL?: string) => {
    const { fetch, received } = fakeFetch(() => fhirAnswer({ resourceType: "Bundle" }));
    await new Haau3({ apiKey: KEY, fetch, ...(baseURL ? { baseURL } : {}) }).request({ method: "POST", path, body: { resourceType: "Bundle" } });
    return { accept: received[0]!.headers.accept, contentType: received[0]!.headers["content-type"] };
  };

  it.each(["/v1/sandbox/fhir/r4/$process-message", "/v1/sandbox/fhir", "/v1/fhir/r4/$process-message", "/v1/fhir"])(
    "asks for and sends FHIR JSON at %s, under a baseURL with a path of its own too",
    async (path) => {
      const fhir = { accept: "application/fhir+json", contentType: "application/fhir+json" };
      expect(await headersAt(path)).toEqual(fhir);
      expect(await headersAt(path, "https://proxy.example.test/api/")).toEqual(fhir);
    },
  );

  it.each(["/v1/sandbox", "/v1/sandbox/fhirish", "/v1/scheduling/slots"])("asks for and sends plain JSON at %s (the control)", async (path) => {
    expect(await headersAt(path)).toEqual({ accept: "application/json", contentType: "application/json" });
  });
});
