// Compiled against the packed package by scripts/check-consumer.ts, under each TypeScript version
// customers use (5.9, 6.0, 7.0), as CommonJS. consumer.mts is the same as ES modules.
import { AuthError, ForbiddenError, Haau3, markAsTestData, NoAnswerError, RefusedError, type fhir4, type NoAnswerReason } from "@haau3/sdk";
import type { SearchInsurancePlanParams, SearchSlotParams } from "@haau3/sdk";
import type { AppInfo, BatchResult, BodyOf, Environment, Haau3ErrorJSON, QueryOf, ResponseOf } from "@haau3/sdk";
import { SPEC_VERSION, slotViews, type PatientType, type ScheduleView, type SearchSlotWithIncludesParams, type SlotView } from "@haau3/sdk";

const haau3 = new Haau3({ apiKey: "haau3_sk_example", timeout: 10_000, maxRetries: 0 });
// A library built on the SDK names itself in the User-Agent; a version read from the environment may be unset.
const app: AppInfo = { name: "my-plugin", version: process.env.MY_PLUGIN_VERSION, url: "https://example.com/my-plugin" };
export const named = new Haau3({ apiKey: "haau3_sk_example", appInfo: app });
// The Sandbox with no key, and what a client resolved.
export const sandbox = new Haau3({ environment: "sandbox" });
export const where: { environment: Environment; baseURL: string } = { environment: sandbox.environment, baseURL: sandbox.baseURL };

export async function tour(): Promise<void> {
  const generatedFrom: string = SPEC_VERSION;
  void generatedFrom;
  const plan: fhir4.InsurancePlan = await haau3.readInsurancePlan("H2406-013-000");
  const params: SearchInsurancePlanParams = { "coverage-area-state": "NC", _count: 10 };
  const plans: fhir4.Bundle = await haau3.searchInsurancePlan(params);
  const marked: fhir4.Bundle = markAsTestData(plans);
  void marked;
  for await (const page of haau3.pages(plans)) {
    const ids: (string | undefined)[] = (page.entry ?? []).map((entry) => entry.resource?.id);
    void ids;
  }
  // matches() and resolve() type what a page holds, with no cast.
  const pharmacies = await haau3.searchHealthcareService({
    "service-category": "pharm",
    "location.address-state": "FL",
    "location.address-postalcode": "33131",
    active: "true",
    _include: ["HealthcareService:organization", "HealthcareService:location"],
  });
  for (const pharmacy of haau3.matches(pharmacies, "HealthcareService")) {
    const organization: fhir4.Organization | undefined = haau3.resolve(pharmacies, pharmacy.providedBy, { type: "Organization", from: pharmacy });
    const anything: fhir4.FhirResource | undefined = haau3.resolve(pharmacies, pharmacy.location?.[0]);
    // @ts-expect-error A reference resolved as an Organization is not a Location.
    const wrong: fhir4.Location | undefined = haau3.resolve(pharmacies, pharmacy.providedBy, { type: "Organization" });
    void [organization, anything, wrong];
  }
  // A list parameter takes one value as well as several, as the query sends both the same way.
  const slots = await haau3.searchSlot({ "location-address-state": "MA", _include: "Slot:schedule", "_include:iterate": ["Schedule:actor"] });
  const slot: fhir4.Slot | undefined = haau3.matches(slots, "Slot")[0];
  const schedules = await haau3.searchSchedule({ "location-address-city": "Boston", _include: "Schedule:actor" });
  const location: fhir4.Schedule | undefined = haau3.matches(schedules, "Schedule")[0];
  const oneInclude: SearchSlotParams = { "_include:iterate": "PractitionerRole:practitioner" };
  // @ts-expect-error An include the search does not serve is not taken, alone or in a list.
  void haau3.searchSlot({ _include: "Slot:subject" });
  // @ts-expect-error The same in a list.
  void haau3.searchSlot({ _include: ["Slot:subject"] });
  // The slot view: each Slot with its Schedule, Locations and provider, typed, with no cast.
  const included = await haau3.searchSlotWithIncludes({ "location-address-state": "MA", _count: 10 });
  for (const view of haau3.slotViews(included)) {
    const scheduleId: string | undefined = view.schedule.id;
    const place: fhir4.Location | undefined = view.locations[0];
    const who: fhir4.Practitioner | undefined = view.practitioners[0];
    const link: string | undefined = view.bookingLink;
    const virtual: boolean = view.virtual;
    void [scheduleId, place, who, link, virtual];
  }
  const scheduleView: ScheduleView | undefined = haau3.scheduleViews(await haau3.searchScheduleWithIncludes())[0];
  const plainViews: SlotView[] = slotViews(included);
  // @ts-expect-error The helper sends the includes itself.
  void haau3.searchSlotWithIncludes({ _include: "Slot:schedule" });
  // Nor does it take a Slot search's parameters that may hold one; its own type is the one to build.
  const anySearch: SearchSlotParams = { "location-address-state": "MA" };
  // @ts-expect-error A SearchSlotParams may hold an include.
  void haau3.searchSlotWithIncludes(anySearch);
  const helperSearch: SearchSlotWithIncludesParams = { "location-address-state": "MA" };
  void haau3.searchSlotWithIncludes(helperSearch);
  // ...and the same value still suits the plain search.
  void haau3.searchSlot(helperSearch);
  const accepts: PatientType | undefined = haau3.slotViews(included)[0]?.patientType;
  // @ts-expect-error A patient type is one of HL7's four codes.
  const notACode: PatientType = "everyone";
  void [scheduleView, plainViews, accepts, notACode];
  const lookup: fhir4.Parameters = await haau3.codeSystemLookup({ system: "http://loinc.org", code: "2345-7" });
  const counties: fhir4.Parameters = await haau3.listInsurancePlanCounties({ state: "NC" });
  const network: fhir4.Parameters = await haau3.checkInsurancePlanNetwork("H3359-038-000", { npi: ["1518929058"] });
  const capabilities = await haau3.fhirMetadata({ mode: "full" });
  const batch: fhir4.Bundle = await haau3.fhirBatch({
    resourceType: "Bundle",
    type: "batch",
    entry: [{ request: { method: "GET", url: "InsurancePlan/$counties?state=NC" } }],
  });
  const raw = await haau3.request({ method: "GET", path: "/v1/fhir/r4/metadata", maxRetries: 0 });
  const status: number = raw.status;
  void [plan, slot, location, oneInclude, lookup, counties, network, capabilities, batch, status];

  // Request ids and timing on a typed call, and fetch options for a framework.
  const answered = await haau3.readInsurancePlan("H2406-013-000", { fetchOptions: { cache: "reload" } }).withResponse();
  const fromWith: fhir4.InsurancePlan = answered.data;
  const requestId: string | undefined = answered.requestId;
  const took: number = answered.durationMs;
  const nextClient = new Haau3({ apiKey: "haau3_sk_example", fetchOptions: { cache: undefined, keepalive: true } });
  const correlated = await haau3.readInsurancePlan("H2406-013-000", { correlationId: "2c9d4e6f-8a1b-4c3d-9e5f-7a6b5c4d3e2f" }).withResponse();
  const kept: string | undefined = correlated.correlationId;
  void kept;
  void [fromWith, requestId, took, nextClient];

  // A batch: one typed result per entry, by position for a list written out, and as an array for
  // one built in code.
  const [inPlan, inCounties] = await haau3.batch((b) => [
    b.readInsurancePlan("H2406-013-000"),
    b.listInsurancePlanCounties({ state: "NC" }),
  ]);
  if (inPlan.ok) {
    const read: fhir4.InsurancePlan = inPlan.data;
    // @ts-expect-error A plan's entry answers an InsurancePlan, not Parameters.
    const wrong: fhir4.Parameters = inPlan.data;
    void [read, wrong];
  } else {
    const failed: RefusedError | NoAnswerError = inPlan.error;
    void failed;
  }
  const lookups: BatchResult<fhir4.Parameters>[] = await haau3.batch((b) =>
    ["2345-7", "718-7"].map((code) => b.codeSystemLookup({ system: "http://loinc.org", code })),
  );
  const batched = await haau3.batch((b) => [b.fhirMetadata()]).withResponse();
  // @ts-expect-error A batch cannot carry the medication list.
  void haau3.batch((b) => [b.reconcileMedications({ resourceType: "Bundle", type: "collection" })]);
  // Scheduling is on the FHIR base, so a batch carries its searches.
  void haau3.batch((b) => [b.searchSlot({ "location-address-state": "MA" }), b.searchSchedule({ _include: "Schedule:actor" })]);
  // An operation's own types, by name.
  const body: BodyOf<"reconcileMedications"> = { resourceType: "Bundle", type: "collection", entry: [] };
  const query: QueryOf<"codeSystemLookup"> = { system: "http://loinc.org", code: "2345-7" };
  const answer: ResponseOf<"readInsurancePlan"> = plan;
  void [inCounties, lookups, batched.requestId, body, query, answer];

  // @ts-expect-error `state` is required.
  await haau3.listInsurancePlanCounties({});
  // @ts-expect-error The grouped endpoint is searchProviderLocations; /actors is gone.
  void haau3.searchActors;

  try {
    await haau3.readQuestionnaire("phq-9");
  } catch (error) {
    if (error instanceof RefusedError) {
      const code: number = error.status;
      const issues: fhir4.OperationOutcomeIssue[] | undefined = error.outcome?.issue;
      void [code, issues];
    } else if (error instanceof NoAnswerError) {
      const reason: NoAnswerReason = error.reason;
      const wait: number | undefined = error.retryAfter;
      const ms: number | undefined = error.durationMs;
      void [reason, wait, ms];
    } else if (error instanceof ForbiddenError) {
      const status: number = error.status;
      const why: fhir4.OperationOutcomeIssue[] | undefined = error.outcome?.issue;
      void [status, why];
    } else if (error instanceof AuthError) {
      const id: string | undefined = error.requestId;
      const mine: string | undefined = error.correlationId;
      const logged: Haau3ErrorJSON = error.toJSON();
      void [id, mine, logged];
    }
  }
}
