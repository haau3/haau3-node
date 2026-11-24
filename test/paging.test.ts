// nextCursor(): the cursor in a search page's next link, for a search continued in a later request.
import { describe, expect, it } from "vitest";
import { Haau3, Haau3Error, nextCursor } from "../src/index.js";
import { fakeFetch, fhirAnswer, KEY } from "./helpers.js";

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

  it("is undefined when the next link carries no page, or an empty one", () => {
    expect(nextCursor(page({ next: `${BASE}/Slot?status=free` }))).toBeUndefined();
    expect(nextCursor(page({ next: `${BASE}/Slot?status=free&page=` }))).toBeUndefined();
  });

  it("reads a relative next link", () => {
    expect(nextCursor(page({ next: "Slot?status=free&page=abc" }))).toBe("abc");
    expect(nextCursor(page({ next: "?page=abc" }))).toBe("abc");
  });

  it("is undefined when the next link is no URL at all", () => {
    expect(nextCursor(page({ next: "https://[not-a-host" }))).toBeUndefined();
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
  // The search as the caller keeps it: status and start sent, so nothing in it is the API's default.
  const search = {
    status: "free",
    start: ["ge2026-12-01T00:00:00Z", "lt2026-12-04T00:00:00Z"],
    "location-address-state": "TX",
  };

  it("sends the request the next link names: the same search, with the cursor as page", async () => {
    // The next link the API would write for that search: every parameter as sent, the includes the
    // helper sent, and the cursor.
    const nextLink = new URL(`${BASE}/Slot`);
    nextLink.searchParams.append("status", "free");
    for (const start of search.start) nextLink.searchParams.append("start", start);
    nextLink.searchParams.append("location-address-state", "TX");
    nextLink.searchParams.append("_include", "Slot:schedule");
    for (const iterate of ["Schedule:actor", "PractitionerRole:practitioner", "HealthcareService:location"]) {
      nextLink.searchParams.append("_include:iterate", iterate);
    }
    nextLink.searchParams.append("page", "eyJrIjoxfQ");

    const { fetch, received } = fakeFetch((_request, count) => fhirAnswer(count === 1 ? page({ next: nextLink.href }) : page()));
    const haau3 = new Haau3({ apiKey: KEY, fetch });

    const first = await haau3.searchSlotWithIncludes(search);
    const cursor = haau3.nextCursor(first);
    expect(cursor).toBe("eyJrIjoxfQ");
    const second = await haau3.searchSlotWithIncludes({ ...search, page: cursor });
    expect(haau3.nextCursor(second)).toBeUndefined();

    const sorted = (url: URL) => [...url.searchParams.entries()].map(([name, value]) => `${name}=${value}`).sort();
    expect(received[1]!.url.pathname).toBe(nextLink.pathname);
    expect(sorted(received[1]!.url)).toEqual(sorted(nextLink));
  });
});
