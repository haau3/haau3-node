// The client's construction, its guards, pages() and request().
import { readFileSync } from "node:fs";
import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Haau3, Haau3Error, VERSION } from "../src/index.js";
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
