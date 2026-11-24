// The slot and schedule views: each matched Slot or Schedule with the resources the page holds for
// it, side by side as FHIR resources, read with FHIR's reference rules and no request; and the two
// search helpers, which send every include their search serves and nothing else.
import type { Bundle, Device, Extension, HealthcareService, Location, Organization, Practitioner, PractitionerRole, Resource, Schedule, Slot } from "fhir/r4.js";
import { describe, expect, it } from "vitest";
import { Haau3, Haau3Error, scheduleViews, slotViews } from "../src/index.js";
import { SCHEDULE_INCLUDES, SLOT_INCLUDES } from "../src/views.js";
import { EMPTY_SEARCH, KEY, fakeFetch, fhirAnswer, spec } from "./helpers.js";

const BASE = "https://api.haau3.com/v1/fhir/r4";
const SSL = "http://hl7.org/fhir/uv/smart-scheduling-links/StructureDefinition/";
/** SMART's own registry, where the extensions were published before the HL7 guide. */
const EARLIER = "http://fhir-registry.smarthealthit.org/StructureDefinition/";
const PHYSICAL_TYPE = "http://terminology.hl7.org/CodeSystem/location-physical-type";

/** A search page: the matches, then what the includes brought, each at its address on the base. */
function page(matches: Resource[], included: Resource[] = []): Bundle {
  const entry = (resource: Resource, mode: "match" | "include") => ({
    fullUrl: `${BASE}/${resource.resourceType}/${resource.id}`,
    resource,
    search: { mode },
  });
  return {
    resourceType: "Bundle",
    type: "searchset",
    total: matches.length,
    entry: [...matches.map((r) => entry(r, "match")), ...included.map((r) => entry(r, "include"))],
  };
}

const location = (id: string, physicalType?: { system?: string; code?: string }): Location => ({
  resourceType: "Location",
  id,
  name: `Place ${id}`,
  ...(physicalType ? { physicalType: { coding: [physicalType] } } : {}),
});
const practitioner = (id: string): Practitioner => ({ resourceType: "Practitioner", id, name: [{ text: `Clinician ${id}` }] });
const role = (id: string, practitionerId: string): PractitionerRole => ({
  resourceType: "PractitionerRole",
  id,
  practitioner: { reference: `Practitioner/${practitionerId}` },
});
const service = (id: string, ...locationIds: string[]): HealthcareService => ({
  resourceType: "HealthcareService",
  id,
  location: locationIds.map((l) => ({ reference: `Location/${l}` })),
});
const schedule = (id: string, ...actors: string[]): Schedule => ({
  resourceType: "Schedule",
  id,
  actor: actors.map((reference) => ({ reference })),
});
const slot = (id: string, scheduleId: string, extension: Extension[] = []): Slot => ({
  resourceType: "Slot",
  id,
  schedule: { reference: `Schedule/${scheduleId}` },
  status: "free",
  start: "2027-01-04T09:00:00-05:00",
  end: "2027-01-04T09:30:00-05:00",
  ...(extension.length ? { extension } : {}),
});

/** The first 200 example of an operation in the pinned spec. */
function exampleAnswer(operationId: string): Bundle {
  for (const item of Object.values(spec.paths)) {
    const op = item.get;
    if (op?.operationId !== operationId) continue;
    const media = Object.values(op.responses["200"].content as Record<string, { examples: Record<string, { value: Bundle }> }>)[0]!;
    return Object.values(media.examples)[0]!.value;
  }
  throw new Error(`No example answer for ${operationId}.`);
}

describe("the spec's own example answers", () => {
  it("give the Slot search's one Slot with its Schedule, Location, role and practitioner", () => {
    const answer = exampleAnswer("searchSlot");
    const [view, ...more] = slotViews(answer);
    expect(more).toEqual([]);
    expect(view!.slot.resourceType).toBe("Slot");
    expect(view!.schedule.resourceType).toBe("Schedule");
    expect(view!.slot.schedule.reference).toBe(`Schedule/${view!.schedule.id}`);
    expect(view!.locations.map((l) => l.name)).toEqual(["haau3 Cambridge Imaging Center"]);
    expect(view!.practitionerRoles).toHaveLength(1);
    expect(view!.practitioners.map((p) => p.name?.[0]?.text)).toEqual(["Dr. Wei Example"]);
    expect(view!.healthcareServices).toEqual([]);
    // The guide's own `ph` is not `vi`, so the place is stated and not virtual.
    expect(view!.virtual).toBe(false);
    expect(view!.patientType).toBe("existptonly");
    expect(view!.bookingLink).toMatch(/^https:\/\/docs\.haau3\.com\//);
    expect(view!.bookingPhone).toBe("+1-617-555-0100");
    // Each is the resource the page holds, not a copy.
    const held = (answer.entry ?? []).map((e) => e.resource);
    for (const resource of [view!.slot, view!.schedule, ...view!.locations, ...view!.practitionerRoles, ...view!.practitioners]) {
      expect(held).toContain(resource);
    }
  });

  it("give the Schedule search's one Schedule with its Location, role and practitioner", () => {
    const [view, ...more] = scheduleViews(exampleAnswer("searchSchedule"));
    expect(more).toEqual([]);
    expect(view!.schedule.resourceType).toBe("Schedule");
    expect(view!.locations.map((l) => l.name)).toEqual(["haau3 Cambridge Imaging Center"]);
    expect(view!.practitioners.map((p) => p.name?.[0]?.text)).toEqual(["Dr. Wei Example"]);
    expect(view!.virtual).toBe(false);
  });
});

describe("what a Schedule reaches", () => {
  it("takes its Location actors, then each HealthcareService's locations, each once, whatever order it names them in", () => {
    const s = schedule("s", "HealthcareService/svc", "Location/a");
    const views = scheduleViews(page([s], [location("a"), service("svc", "b", "a"), location("b")]));
    expect(views[0]!.locations.map((l) => l.id)).toEqual(["a", "b"]);
    expect(views[0]!.healthcareServices.map((h) => h.id)).toEqual(["svc"]);
  });

  it("leaves out an actor of a type the view does not list, held in the page", () => {
    const device: Device = { resourceType: "Device", id: "d" };
    const [view] = scheduleViews(page([schedule("s", "Device/d", "Location/a")], [device, location("a")]));
    expect(view!.locations.map((l) => l.id)).toEqual(["a"]);
    expect([view!.practitionerRoles, view!.practitioners, view!.healthcareServices]).toEqual([[], [], []]);
  });

  it("leaves out a target of another type than its element allows, and keeps the rest of the page", () => {
    const organization: Organization = { resourceType: "Organization", id: "o" };
    const r: PractitionerRole = { resourceType: "PractitionerRole", id: "r", practitioner: { reference: "Organization/o" } };
    const views = scheduleViews(page([schedule("s", "PractitionerRole/r", "Location/a"), schedule("t", "Location/a")], [r, organization, location("a")]));
    expect(views.map((v) => v.schedule.id)).toEqual(["s", "t"]);
    expect(views[0]!.practitionerRoles.map((x) => x.id)).toEqual(["r"]);
    expect(views[0]!.practitioners).toEqual([]);
  });

  it("resolves a relative reference against the base of the entry that holds it", () => {
    const OTHER = "https://other.example/fhir";
    const two: Bundle = {
      resourceType: "Bundle",
      type: "searchset",
      entry: [
        { fullUrl: `${OTHER}/Schedule/s`, resource: schedule("s", "Location/a"), search: { mode: "match" } },
        { fullUrl: `${BASE}/Location/a`, resource: { ...location("a"), name: "on the API's base" } as Location, search: { mode: "include" } },
        { fullUrl: `${OTHER}/Location/a`, resource: { ...location("a"), name: "on the other base" } as Location, search: { mode: "include" } },
      ],
    };
    expect(scheduleViews(two)[0]!.locations.map((l) => l.name)).toEqual(["on the other base"]);
  });

  it("does not follow a PractitionerRole's own locations", () => {
    const r: PractitionerRole = { ...role("r", "p"), location: [{ reference: "Location/elsewhere" }] };
    const views = scheduleViews(page([schedule("s", "PractitionerRole/r")], [r, practitioner("p"), location("elsewhere")]));
    expect(views[0]!.locations).toEqual([]);
    expect(views[0]!.practitioners.map((p) => p.id)).toEqual(["p"]);
  });

  it("gives empty lists for a Schedule that names no provider", () => {
    const [view] = scheduleViews(page([schedule("s", "Location/a")], [location("a")]));
    expect(view!.locations.map((l) => l.id)).toEqual(["a"]);
    expect([view!.practitionerRoles, view!.practitioners, view!.healthcareServices]).toEqual([[], [], []]);
  });

  it("lists a Practitioner actor first, then the one behind each role, and one named twice once", () => {
    const s = schedule("s", "PractitionerRole/r", "Practitioner/q", "Practitioner/p");
    const [view] = scheduleViews(page([s], [role("r", "p"), practitioner("p"), practitioner("q")]));
    expect(view!.practitioners.map((p) => p.id)).toEqual(["q", "p"]);
  });

  it("leaves out a resource the page does not hold, and asks the API for nothing", () => {
    const { fetch, received } = fakeFetch(() => fhirAnswer(EMPTY_SEARCH));
    const haau3 = new Haau3({ apiKey: KEY, fetch });
    const [view] = haau3.scheduleViews(page([schedule("s", "Location/a", "PractitionerRole/gone", "Device/d")], [location("a")]));
    expect(view!.locations.map((l) => l.id)).toEqual(["a"]);
    expect(view!.practitionerRoles).toEqual([]);
    expect(received).toHaveLength(0);
  });

  it("throws when the page holds two entries a reference could name, as resolve does", () => {
    const twice: Bundle = {
      resourceType: "Bundle",
      type: "searchset",
      entry: [
        { fullUrl: `${BASE}/Schedule/s`, resource: schedule("s", "Location/a"), search: { mode: "match" } },
        { fullUrl: `${BASE}/Location/a`, resource: location("a"), search: { mode: "include" } },
        { fullUrl: `${BASE}/Location/a`, resource: location("a"), search: { mode: "include" } },
      ],
    };
    expect(() => scheduleViews(twice)).toThrow(/matches 2 entries/);
  });
});

describe("contained resources", () => {
  it("resolve from the entry that contains them, as FHIR says, and what they name too", () => {
    const containedRole: PractitionerRole = { resourceType: "PractitionerRole", id: "r", practitioner: { reference: "Practitioner/p" } };
    const containedService: HealthcareService = { resourceType: "HealthcareService", id: "h", location: [{ reference: "Location/b" }] };
    const s: Schedule = { ...schedule("s", "#r", "#h", "Location/a"), contained: [containedRole, containedService] };
    const [view] = scheduleViews(page([s], [location("a"), location("b"), practitioner("p")]));
    expect(view!.practitionerRoles).toEqual([containedRole]);
    expect(view!.practitioners.map((p) => p.id)).toEqual(["p"]);
    expect(view!.healthcareServices).toEqual([containedService]);
    expect(view!.locations.map((l) => l.id)).toEqual(["a", "b"]);
  });

  it("give a Slot its contained Schedule, and what that Schedule names", () => {
    const containedSchedule = schedule("s", "Location/a");
    const x: Slot = { ...slot("x", "s"), schedule: { reference: "#s" }, contained: [containedSchedule] };
    const [view] = slotViews(page([x], [location("a")]));
    expect(view!.schedule).toBe(containedSchedule);
    expect(view!.locations.map((l) => l.id)).toEqual(["a"]);
  });
});

describe("whether the place is virtual", () => {
  const virtualOf = (...locations: Location[]) =>
    scheduleViews(page([schedule("s", ...locations.map((l) => `Location/${l.id}`))], locations))[0]!.virtual;

  it("is true when any Location is vi, false when one states another type, and undefined when none states one", () => {
    expect(virtualOf(location("a", { system: PHYSICAL_TYPE, code: "vi" }))).toBe(true);
    expect(virtualOf(location("a", { system: PHYSICAL_TYPE, code: "bu" }), location("b", { system: PHYSICAL_TYPE, code: "vi" }))).toBe(true);
    expect(virtualOf(location("a", { system: PHYSICAL_TYPE, code: "bu" }))).toBe(false);
    expect(virtualOf(location("a"))).toBeUndefined();
    expect(virtualOf()).toBeUndefined();
  });

  it("reads vi only in HL7's physical type code system (control)", () => {
    expect(virtualOf(location("a", { system: "http://example.org/other", code: "vi" }))).toBe(false);
  });
});

describe("what a Slot carries", () => {
  const viewOf = (extension: Extension[]) => slotViews(page([slot("x", "s", extension)], [schedule("s")]))[0]!;

  it("reads the booking link, phone and patient type from SMART Scheduling Links 1.0.0's extensions", () => {
    const view = viewOf([
      { url: `${SSL}booking-deep-link`, valueUrl: "https://book.example/x" },
      { url: `${SSL}booking-phone`, valueContactPoint: { system: "phone", value: "+1-555-0100" } },
      { url: `${SSL}patient-type`, valueCoding: { system: "http://terminology.hl7.org/CodeSystem/accepting-patients", code: "newpt" } },
    ]);
    expect([view.bookingLink, view.bookingPhone, view.patientType]).toEqual(["https://book.example/x", "+1-555-0100", "newpt"]);
  });

  it("reads none under SMART's earlier registry URLs, which 1.0.0 replaced", () => {
    const view = viewOf([
      { url: `${EARLIER}booking-deep-link`, valueUrl: "https://book.example/x" },
      { url: `${EARLIER}booking-phone`, valueString: "+1-555-0100" },
    ]);
    expect([view.bookingLink, view.bookingPhone]).toEqual([undefined, undefined]);
    // The resource still carries both, as the API served it.
    expect(view.slot.extension).toHaveLength(2);
  });

  it("reads no patient type from another code system, nor a code HL7's does not have", () => {
    const view = viewOf([{ url: `${SSL}patient-type`, valueCoding: { system: "http://example.org/other", code: "newpt" } }]);
    expect(view.patientType).toBeUndefined();
    const unknown = viewOf([{ url: `${SSL}patient-type`, valueCoding: { system: "http://terminology.hl7.org/CodeSystem/accepting-patients", code: "somept" } }]);
    expect(unknown.patientType).toBeUndefined();
    // Control: each of HL7's four is read, nopt included.
    for (const code of ["newpt", "existptonly", "existptfam", "nopt"]) {
      const known = viewOf([{ url: `${SSL}patient-type`, valueCoding: { system: "http://terminology.hl7.org/CodeSystem/accepting-patients", code } }]);
      expect(known.patientType).toBe(code);
    }
  });

  it("reads the first extension of its URL that carries the value it is read for", () => {
    const view = viewOf([
      { url: `${SSL}booking-deep-link`, valueString: "not a url value" },
      { url: `${SSL}booking-deep-link`, valueUrl: "https://book.example/second" },
      { url: `${SSL}booking-phone`, valueString: "+1-555-0199" },
      { url: `${SSL}booking-phone`, valueContactPoint: { system: "phone", value: "+1-555-0100" } },
    ]);
    expect([view.bookingLink, view.bookingPhone]).toEqual(["https://book.example/second", "+1-555-0100"]);
  });

  it("carries none when the Slot has no extensions", () => {
    const view = viewOf([]);
    expect([view.bookingLink, view.bookingPhone, view.patientType]).toEqual([undefined, undefined, undefined]);
  });
});

describe("which entries are views", () => {
  it("only matches of the view's own type: never an included entry or another type", () => {
    const s = schedule("s", "Location/a");
    const bundle = page([slot("x", "s"), location("m")], [s, location("a"), slot("included", "s")]);
    expect(slotViews(bundle).map((v) => v.slot.id)).toEqual(["x"]);
    expect(scheduleViews(bundle)).toEqual([]);
  });

  it("none for an empty page", () => {
    expect(slotViews(EMPTY_SEARCH as Bundle)).toEqual([]);
    expect(scheduleViews(EMPTY_SEARCH as Bundle)).toEqual([]);
  });

  it("throws, naming the fix, when a Slot's Schedule is not in the page", () => {
    const bare = page([slot("x", "s")]);
    expect(() => slotViews(bare)).toThrow(Haau3Error);
    expect(() => slotViews(bare)).toThrow(/search with searchSlotWithIncludes, or send _include=Slot:schedule/);
    // A Slot whose schedule names a resource of another type holds no Schedule either.
    const elsewhere: Slot = { ...slot("x", "s"), schedule: { reference: "Location/a" } };
    expect(() => slotViews(page([elsewhere], [location("a")]))).toThrow(/names a Schedule the page does not hold/);
    // Control: the same page with its Schedule included gives its view.
    expect(slotViews(page([slot("x", "s")], [schedule("s")]))).toHaveLength(1);
  });

  it("are what the plain functions give", () => {
    const bundle = page([slot("x", "s")], [schedule("s", "Location/a"), location("a")]);
    const haau3 = new Haau3({ apiKey: KEY, fetch: fakeFetch(() => fhirAnswer(EMPTY_SEARCH)).fetch });
    expect(haau3.slotViews(bundle)).toEqual(slotViews(bundle));
    expect(haau3.scheduleViews(page([schedule("s", "Location/a")], [location("a")]))).toEqual(scheduleViews(page([schedule("s", "Location/a")], [location("a")])));
  });
});

describe("the search helpers", () => {
  const client = () => {
    const recorded = fakeFetch(() => fhirAnswer(EMPTY_SEARCH));
    return { haau3: new Haau3({ apiKey: KEY, fetch: recorded.fetch }), received: recorded.received };
  };
  const query = (url: URL) => Object.fromEntries([...new Set(url.searchParams.keys())].map((name) => [name, url.searchParams.getAll(name)]));

  it("searchSlotWithIncludes sends the caller's parameters and every include the Slot search serves, and nothing else", async () => {
    const { haau3, received } = client();
    await haau3.searchSlotWithIncludes({ "location-address-state": "MA", _count: 10 });
    expect(received[0]!.url.pathname).toBe("/v1/fhir/r4/Slot");
    expect(query(received[0]!.url)).toEqual({
      "location-address-state": ["MA"],
      _count: ["10"],
      _include: ["Slot:schedule"],
      "_include:iterate": ["Schedule:actor", "PractitionerRole:practitioner", "HealthcareService:location"],
    });
  });

  it("searchScheduleWithIncludes does the same for the Schedule search", async () => {
    const { haau3, received } = client();
    await haau3.searchScheduleWithIncludes({ "location-address-city": "Boston", page: "next-page" });
    expect(received[0]!.url.pathname).toBe("/v1/fhir/r4/Schedule");
    expect(query(received[0]!.url)).toEqual({
      "location-address-city": ["Boston"],
      page: ["next-page"],
      _include: ["Schedule:actor"],
      "_include:iterate": ["PractitionerRole:practitioner", "HealthcareService:location"],
    });
  });

  it("pass a call's options on, as the search does", async () => {
    const { haau3, received } = client();
    await haau3.searchSlotWithIncludes({}, { headers: { "x-extra": "slot" } });
    await haau3.searchScheduleWithIncludes({}, { headers: { "x-extra": "schedule" } });
    expect(received.map((r) => r.headers["x-extra"])).toEqual(["slot", "schedule"]);
  });

  it("send every include their search serves, as the spec lists them", () => {
    const served = (operationId: string) => {
      const op = Object.values(spec.paths).map((item) => item.get).find((get) => get?.operationId === operationId)!;
      const names = (op.parameters as { name?: string; schema?: { items?: { enum?: string[] }; enum?: string[] } }[])
        .filter((p) => p.name === "_include" || p.name === "_include:iterate")
        .flatMap((p) => p.schema?.items?.enum ?? p.schema?.enum ?? []);
      return [...new Set(names)].sort();
    };
    const sent = (includes: { _include: string; "_include:iterate": readonly string[] }) => [includes._include, ...includes["_include:iterate"]].sort();
    expect(sent(SLOT_INCLUDES)).toEqual(served("searchSlot"));
    expect(sent(SCHEDULE_INCLUDES)).toEqual(served("searchSchedule"));
    expect(served("searchSlot")).toHaveLength(4);
  });

  it("answers .withResponse() as the search does", async () => {
    const { haau3 } = client();
    const { data, status, requestId } = await haau3.searchSlotWithIncludes().withResponse();
    expect(data).toEqual(EMPTY_SEARCH);
    expect(status).toBe(200);
    expect(requestId).toBe("6b1f3c2e-4d5a-4b6c-8d7e-9f0a1b2c3d4e");
  });

  it("refuses an include passed anyway, naming the plain search, and sends nothing", async () => {
    const { haau3, received } = client();
    for (const [call, plain] of [
      [() => haau3.searchSlotWithIncludes({ _include: "Slot:schedule" } as never), "searchSlot"],
      [() => haau3.searchSlotWithIncludes({ "_include:iterate": ["Schedule:actor"] } as never), "searchSlot"],
      [() => haau3.searchScheduleWithIncludes({ _include: "Schedule:actor" } as never), "searchSchedule"],
      [() => haau3.searchSlotWithIncludes({ _include: null } as never), "searchSlot"],
      [() => haau3.searchSlotWithIncludes({ "_include:iterate": [] } as never), "searchSlot"],
    ] as const) {
      const error = await call().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(Haau3Error);
      expect((error as Error).message).toContain(`call ${plain}.`);
    }
    expect(received).toHaveLength(0);
  });

  it("take an include left undefined as none, as the search does", async () => {
    const { haau3, received } = client();
    await haau3.searchSlotWithIncludes({ _include: undefined } as never);
    expect(query(received[0]!.url)._include).toEqual(["Slot:schedule"]);
  });
});
