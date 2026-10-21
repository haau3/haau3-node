// matches() and resolve(): a page's matches, and what a reference names in a Bundle, with no request.
import { describe, expect, it } from "vitest";
import { Haau3, Haau3Error } from "../src/index.js";
import { fakeFetch, KEY } from "./helpers.js";

const BASE = "https://api.haau3.com/v1/fhir/r4";

// A pharmacy search as the API answers one: the matched service first, then what _include brought,
// each at its RESTful address, the service naming the others by relative reference.
const service = {
  resourceType: "HealthcareService",
  id: "HealthcareService-pharmacy-1234567893",
  name: "EXAMPLE PHARMACY",
  providedBy: { reference: "Organization/Organization-1234567893" },
  location: [{ reference: "Location/Location-pharmacy-1234567893" }],
};
const organization = { resourceType: "Organization", id: "Organization-1234567893", name: "EXAMPLE PHARMACY" };
const store = { resourceType: "Location", id: "Location-pharmacy-1234567893", address: { city: "MIAMI" } };
const page = {
  resourceType: "Bundle",
  type: "searchset",
  entry: [
    { fullUrl: `${BASE}/HealthcareService/${service.id}`, resource: service, search: { mode: "match" } },
    { fullUrl: `${BASE}/Organization/${organization.id}`, resource: organization, search: { mode: "include" } },
    { fullUrl: `${BASE}/Location/${store.id}`, resource: store, search: { mode: "include" } },
    { resource: { resourceType: "OperationOutcome", issue: [] }, search: { mode: "outcome" } },
  ],
};

function client() {
  const { fetch, received } = fakeFetch(() => {
    throw new Error("resolve() and matches() send nothing");
  });
  return { haau3: new Haau3({ apiKey: KEY, fetch }), received };
}

describe("matches()", () => {
  it("gives the page's matches of a type, and no included resource or outcome", () => {
    const { haau3, received } = client();
    expect(haau3.matches(page as never, "HealthcareService").map((r) => r.id)).toEqual([service.id]);
    expect(haau3.matches(page as never, "Organization")).toEqual([]);
    expect(received).toHaveLength(0);
  });

  it("gives every match without a type, an entry that says no mode among them", () => {
    const { haau3 } = client();
    const bundle = { resourceType: "Bundle", type: "searchset", entry: [...page.entry, { resource: { resourceType: "Organization", id: "no-mode" } }] };
    expect(haau3.matches(bundle as never).map((r) => `${r.resourceType}/${r.id}`)).toEqual([
      `HealthcareService/${service.id}`,
      "Organization/no-mode",
    ]);
  });
});

describe("resolve()", () => {
  it("finds what a relative reference names at the address of the entry holding it", () => {
    const { haau3, received } = client();
    const [found] = haau3.matches(page as never, "HealthcareService");
    expect(haau3.resolve(page as never, found!.providedBy, { from: found, type: "Organization" })).toBe(organization);
    expect(haau3.resolve(page as never, found!.location?.[0], { from: found, type: "Location" })).toBe(store);
    expect(received).toHaveLength(0);
  });

  it("finds it without from, as the one entry whose address ends in that type and id", () => {
    const { haau3 } = client();
    expect(haau3.resolve(page as never, "Organization/Organization-1234567893")).toBe(organization);
    // The control: an id the page does not hold.
    expect(haau3.resolve(page as never, "Organization/Organization-not-on-this-page")).toBeUndefined();
  });

  it("refuses to choose between two addresses ending in the same type and id, unless from says which", () => {
    const { haau3 } = client();
    const elsewhere = { resourceType: "Organization", id: organization.id, name: "ANOTHER SERVER'S COPY" };
    const bundle = { ...page, entry: [...page.entry, { fullUrl: `https://fhir.example.org/r4/Organization/${organization.id}`, resource: elsewhere }] };
    expect(() => haau3.resolve(bundle as never, service.providedBy)).toThrow(Haau3Error);
    expect(() => haau3.resolve(bundle as never, service.providedBy)).toThrow(/ambiguous/);
    expect(haau3.resolve(bundle as never, service.providedBy, { from: service })).toBe(organization);
  });

  it("matches an absolute reference to the entry with that fullUrl, a urn:uuid among them", () => {
    const { haau3 } = client();
    const header = { resourceType: "MessageHeader", focus: [{ reference: "urn:uuid:5f0c4a52-0d1e-4b7a-9c2f-3e4d5a6b7c8d" }] };
    const claim = { resourceType: "Claim", id: "c" };
    const message = {
      resourceType: "Bundle",
      type: "message",
      entry: [
        { fullUrl: "urn:uuid:1a2b3c4d-0000-4000-8000-000000000001", resource: header },
        { fullUrl: "urn:uuid:5f0c4a52-0d1e-4b7a-9c2f-3e4d5a6b7c8d", resource: claim },
      ],
    };
    expect(haau3.resolve(message as never, header.focus[0], { type: "Claim" })).toBe(claim);
    expect(haau3.resolve(page as never, `${BASE}/Location/${store.id}`)).toBe(store);
    expect(haau3.resolve(message as never, "urn:uuid:00000000-0000-4000-8000-00000000ffff")).toBeUndefined();
  });

  it("gives a relative reference no meaning from an entry at a urn:uuid, as FHIR says", () => {
    const { haau3 } = client();
    const holder = { resourceType: "Claim", provider: { reference: "Organization/Organization-1234567893" } };
    const bundle = { ...page, entry: [...page.entry, { fullUrl: "urn:uuid:1a2b3c4d-0000-4000-8000-000000000002", resource: holder }] };
    expect(haau3.resolve(bundle as never, holder.provider, { from: holder })).toBeUndefined();
    // The control: the same reference without from finds the one RESTful entry.
    expect(haau3.resolve(bundle as never, holder.provider)).toBe(organization);
  });

  it("refuses a from that is not an entry of the Bundle", () => {
    const { haau3 } = client();
    expect(() => haau3.resolve(page as never, service.providedBy, { from: { ...service } as never })).toThrow(/not an entry of this Bundle/);
  });

  it("finds a contained resource in from, and refuses to guess without it", () => {
    const { haau3 } = client();
    const pharmacy = { resourceType: "Organization", id: "pharmacy" };
    const holder = { resourceType: "Claim", contained: [pharmacy], provider: { reference: "#pharmacy" } };
    const bundle = { resourceType: "Bundle", type: "collection", entry: [{ resource: holder }] };
    expect(haau3.resolve(bundle as never, holder.provider, { from: holder as never })).toBe(pharmacy);
    expect(haau3.resolve(bundle as never, "#", { from: holder as never })).toBe(holder);
    expect(haau3.resolve(bundle as never, "#elsewhere", { from: holder as never })).toBeUndefined();
    expect(() => haau3.resolve(bundle as never, holder.provider)).toThrow(/pass \{ from \}/);
  });

  it("matches a version to meta.versionId", () => {
    const { haau3 } = client();
    const v1 = { resourceType: "Organization", id: "o", meta: { versionId: "1" } };
    const v2 = { resourceType: "Organization", id: "o", meta: { versionId: "2" } };
    const history = {
      resourceType: "Bundle",
      type: "history",
      entry: [
        { fullUrl: `${BASE}/Organization/o`, resource: v2 },
        { fullUrl: `${BASE}/Organization/o`, resource: v1 },
        // A deleted version holds no resource, and names nothing.
        { fullUrl: `${BASE}/Organization/o`, request: { method: "DELETE", url: "Organization/o" } },
      ],
    };
    expect(haau3.resolve(history as never, `${BASE}/Organization/o/_history/1`)).toBe(v1);
    expect(haau3.resolve(history as never, "Organization/o/_history/2")).toBe(v2);
    expect(haau3.resolve(history as never, "Organization/o/_history/3")).toBeUndefined();
    // The control: with no version, both versions answer, and which is meant is ambiguous.
    expect(() => haau3.resolve(history as never, `${BASE}/Organization/o`)).toThrow(/ambiguous/);
  });

  it("refuses a resource of another type than the one asked for", () => {
    const { haau3 } = client();
    expect(() => haau3.resolve(page as never, service.providedBy, { type: "Location" })).toThrow(
      "The reference names a resource of type Organization, not Location.",
    );
  });

  it("is undefined for no reference, an identifier alone, and a reference FHIR gives no meaning", () => {
    const { haau3 } = client();
    expect(haau3.resolve(page as never, undefined)).toBeUndefined();
    expect(haau3.resolve(page as never, null)).toBeUndefined();
    expect(haau3.resolve(page as never, { identifier: { system: "http://hl7.org/fhir/sid/us-npi", value: "1234567893" } })).toBeUndefined();
    expect(haau3.resolve(page as never, "not a reference")).toBeUndefined();
  });

  it("never names the reference in an error, so a message is safe to log", () => {
    const { haau3 } = client();
    const elsewhere = { fullUrl: `https://fhir.example.org/r4/Organization/${organization.id}`, resource: { ...organization } };
    const bundle = { ...page, entry: [...page.entry, elsewhere] };
    let message = "";
    try {
      haau3.resolve(bundle as never, service.providedBy);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/ambiguous/);
    expect(message).not.toContain("1234567893");
  });
});
