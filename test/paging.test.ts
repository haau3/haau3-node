// nextCursor(): the cursor in a search page's next link, for a search continued in a later request.
import { describe, expect, it } from "vitest";
import { Haau3, Haau3Error, nextCursor } from "../src/index.js";
import { fakeFetch, fhirAnswer, KEY, spec } from "./helpers.js";

const BASE = "https://api.haau3.com/v1/fhir/r4";

/** A search page with the links given, by relation. */
const page = (links: Record<string, string> = {}) => ({
  resourceType: "Bundle" as const,
  type: "searchset" as const,
  total: 0,
  link: Object.entries(links).map(([relation, url]) => ({ relation, url })),
});

describe("nextCursor()", () => {
  it("is the next link's page value", () => {
    const p = page({ self: `${BASE}/Slot?status=free`, next: `${BASE}/Slot?status=free&_count=25&page=eyJ2IjoxfQ` });
    expect(nextCursor(p)).toBe("eyJ2IjoxfQ");
  });

  it("is undefined on the last page, which has no next link", () => {
    expect(nextCursor(page({ self: `${BASE}/Slot?status=free&page=eyJ2IjoxfQ` }))).toBeUndefined();
    expect(nextCursor({ resourceType: "Bundle", type: "searchset" })).toBeUndefined();
  });

  it("throws when the next link carries no page, or an empty one, rather than reading as the last page", () => {
    const message = "The page's next link carries no page cursor, so the next page is reached only by following the link, as pages() does.";
    expect(() => nextCursor(page({ next: `${BASE}/Slot?status=free` }))).toThrow(message);
    expect(() => nextCursor(page({ next: `${BASE}/Slot?status=free&page=` }))).toThrow(message);
  });

  it("reads a relative next link", () => {
    expect(nextCursor(page({ next: "Slot?status=free&page=abc" }))).toBe("abc");
    expect(nextCursor(page({ next: "?page=abc" }))).toBe("abc");
  });

  it("throws when the next link is no URL at all", () => {
    expect(() => nextCursor(page({ next: "https://[not-a-host" }))).toThrow(Haau3Error);
    expect(() => nextCursor(page({ next: "https://[not-a-host" }))).toThrow("The page's next link is not a URL, so it names no next page.");
  });

  it("decodes a percent-encoded cursor, which the client encodes again when it sends it", async () => {
    const p = page({ next: `${BASE}/Slot?page=a%2Fb%3D%3D` });
    expect(nextCursor(p)).toBe("a/b==");
    const { fetch, received } = fakeFetch(() => fhirAnswer(page()));
    await new Haau3({ apiKey: KEY, fetch }).searchSlot({ page: nextCursor(p) });
    expect(received[0]!.url.searchParams.get("page")).toBe("a/b==");
  });

  it("throws when the next link carries two cursors, rather than choosing one", () => {
    const p = page({ next: `${BASE}/Slot?page=one&page=two` });
    expect(() => nextCursor(p)).toThrow(Haau3Error);
    expect(() => nextCursor(p)).toThrow("The page's next link carries 2 page cursors, so which one continues the search is ambiguous.");
  });

  it("reads the first next link, as pages() follows it", () => {
    const p = {
      resourceType: "Bundle" as const,
      type: "searchset" as const,
      link: [
        { relation: "next", url: `${BASE}/Slot?page=first` },
        { relation: "next", url: `${BASE}/Slot?page=second` },
      ],
    };
    expect(nextCursor(p)).toBe("first");
  });

  it("is the same on the client, with no request", () => {
    const { fetch, received } = fakeFetch(() => fhirAnswer(page()));
    const p = page({ next: `${BASE}/Slot?page=abc` });
    expect(new Haau3({ apiKey: KEY, fetch }).nextCursor(p)).toBe("abc");
    expect(received).toHaveLength(0);
  });
});

describe("a search continued in a later request with nextCursor()", () => {
  // The API's own example answer to a Slot search, with the links it wrote: the search as sent in
  // `self`, and the same search with the cursor in `next`.
  const op = spec.paths["/v1/fhir/r4/Slot"]!.get;
  const content = Object.values(op.responses["200"].content)[0] as { examples?: Record<string, { value: unknown }>; example?: unknown };
  const example = (content.example ?? Object.values(content.examples ?? {})[0]!.value) as {
    link: { relation: string; url: string }[];
  };
  const linkOf = (relation: string) => new URL(example.link.find((link) => link.relation === relation)!.url);
  const sorted = (url: URL) => [...url.searchParams.entries()].map(([name, value]) => `${name}=${value}`).sort();

  // The search as its caller keeps it: every parameter `self` shows, but the includes the helper sends.
  const search: Record<string, string | string[] | number> = {};
  for (const [name, value] of linkOf("self").searchParams) {
    if (name.startsWith("_include")) continue;
    const held = search[name];
    search[name] = name === "_count" ? Number(value) : held === undefined ? (name === "start" ? [value] : value) : [...[held].flat().map(String), value];
  }

  it("sends the request the API's next link names: the same search, with the cursor as page", async () => {
    const { fetch, received } = fakeFetch((_request, count) => fhirAnswer(count === 1 ? example : page()));
    const haau3 = new Haau3({ apiKey: KEY, fetch });

    const first = await haau3.searchSlotWithIncludes(search);
    expect(sorted(received[0]!.url)).toEqual(sorted(linkOf("self")));
    const cursor = haau3.nextCursor(first);
    expect(cursor).toBe(linkOf("next").searchParams.get("page"));

    const second = await haau3.searchSlotWithIncludes({ ...search, page: cursor! });
    expect(haau3.nextCursor(second)).toBeUndefined();
    expect(received[1]!.url.pathname).toBe(linkOf("next").pathname);
    expect(sorted(received[1]!.url)).toEqual(sorted(linkOf("next")));
  });
});
