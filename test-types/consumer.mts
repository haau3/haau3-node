// Compiled against the packed package by scripts/check-consumer.ts, under each TypeScript version
// customers use (5.9, 6.0, 7.0), as ES modules. consumer.cts is the same as CommonJS.
import { AuthError, ForbiddenError, Haau3, markAsTestData, NoAnswerError, RefusedError, type fhir4, type NoAnswerReason } from "@haau3/sdk";
import type { SchedulingProviderLocation, SchedulingSlot, SearchInsurancePlanParams } from "@haau3/sdk";
import type { BatchResult, BodyOf, Haau3ErrorJSON, QueryOf, ResponseOf } from "@haau3/sdk";

const haau3 = new Haau3({ apiKey: "haau3_sk_example", timeout: 10_000, maxRetries: 0 });

export async function tour(): Promise<void> {
  const plan: fhir4.InsurancePlan = await haau3.readInsurancePlan("H2406-013-000");
  const params: SearchInsurancePlanParams = { "coverage-area-state": "NC", _count: 10 };
  const plans: fhir4.Bundle = await haau3.searchInsurancePlan(params);
  for await (const page of haau3.pages(plans)) {
    const ids: (string | undefined)[] = (page.entry ?? []).map((entry) => entry.resource?.id);
    void ids;
  }
  // resources() narrows by resourceType, with no cast.
  for await (const resource of haau3.resources(plans)) {
    if (resource.resourceType === "InsurancePlan") {
      const name: string | undefined = resource.name;
      void name;
    }
  }
  // matches() and resolve() type what a page holds, with no cast.
  const pharmacies = await haau3.searchHealthcareService({
    "service-category": "pharm",
    "location.address-state": "FL",
    "location.address-postalcode": "33131",
    _include: ["HealthcareService:organization", "HealthcareService:location"],
  });
  for (const pharmacy of haau3.matches(pharmacies, "HealthcareService")) {
    const organization: fhir4.Organization | undefined = haau3.resolve(pharmacies, pharmacy.providedBy, { type: "Organization", from: pharmacy });
    const anything: fhir4.FhirResource | undefined = haau3.resolve(pharmacies, pharmacy.location?.[0]);
    // @ts-expect-error A reference resolved as an Organization is not a Location.
    const wrong: fhir4.Location | undefined = haau3.resolve(pharmacies, pharmacy.providedBy, { type: "Organization" });
    void [organization, anything, wrong];
  }
  const slots = await haau3.searchSlots({ state: "MA", limit: 25 });
  const slot: SchedulingSlot | undefined = slots.slots[0];
  const locations = await haau3.searchProviderLocations({ publisher: "haau3" });
  const location: SchedulingProviderLocation | undefined = locations.providerLocations[0];
  const lookup: fhir4.Parameters = await haau3.codeSystemLookup({ system: "http://loinc.org", code: "2345-7" });
  const counties: fhir4.Parameters = await haau3.listInsurancePlanCounties({ state: "NC" });
  const network: fhir4.Parameters = await haau3.checkInsurancePlanNetwork("H3359-038-000", { npi: ["1518929058"] });
  const capabilities = await haau3.fhirMetadata({ mode: "full" });
  const batch: fhir4.Bundle = await haau3.fhirBatch({
    resourceType: "Bundle",
    type: "batch",
    entry: [{ request: { method: "GET", url: "InsurancePlan/$counties?state=NC" } }],
  });
  const raw = await haau3.request({ method: "GET", path: "/v1/scheduling/publishers", maxRetries: 0 });
  const status: number = raw.status;
  void [plan, slot, location, lookup, counties, network, capabilities, batch, status];

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
  // @ts-expect-error Scheduling is not on the FHIR base.
  void haau3.batch((b) => [b.searchSlots({ state: "MA" })]);
  // An operation's own types, by name.
  const body: BodyOf<"reconcileMedications"> = { resourceType: "Bundle", type: "collection", entry: [] };
  const query: QueryOf<"codeSystemLookup"> = { system: "http://loinc.org", code: "2345-7" };
  const answer: ResponseOf<"readInsurancePlan"> = plan;
  void [inCounties, lookups, batched.requestId, body, query, answer];
  // MedList takes @types/fhir's Bundle or Parameters as they are, such as records read with any FHIR client.
  const records: fhir4.Bundle = plans;
  const asParameters: fhir4.Parameters = counties;
  const reconciled: fhir4.Bundle = await haau3.reconcileMedications(records);
  void [reconciled, await haau3.reconcileMedications(asParameters)];
  // Test data: what goes in is what comes out, so a call takes it as it takes the original.
  const marked: fhir4.Bundle = markAsTestData(records);
  void [await haau3.reconcileMedications(marked), await haau3.reconcileMedications(markAsTestData(asParameters))];
  // @ts-expect-error Only a FHIR resource can be labelled.
  void markAsTestData({ entry: [] });
  // @ts-expect-error Any other resource is not a body MedList takes.
  void haau3.reconcileMedications(plan);
  // A record written inline is checked as the resource it is, with no cast: a message's MessageHeader,
  // and MedList's records in a Parameters' Bundle.
  void haau3.processMessage({
    resourceType: "Bundle",
    type: "message",
    entry: [{ resource: { resourceType: "MessageHeader", eventCoding: { code: "rtpbc-request-non-phi" }, source: { endpoint: "urn:example" } } }],
  });
  void haau3.reconcileMedications({
    resourceType: "Parameters",
    parameter: [
      {
        name: "bundle",
        resource: {
          resourceType: "Bundle",
          type: "collection",
          entry: [{ resource: { resourceType: "MedicationRequest", status: "active", intent: "order", subject: { reference: "Patient/p" } } }],
        },
      },
    ],
  });
  void haau3.processMessage({
    resourceType: "Bundle",
    type: "message",
    // @ts-expect-error A misspelt field is an error, as it is in the record's own type.
    entry: [{ resource: { resourceType: "MessageHeader", eventCodin: { code: "x" }, source: { endpoint: "urn:example" } } }],
  });
  void haau3.reconcileMedications({
    resourceType: "Bundle",
    type: "collection",
    // @ts-expect-error A value outside a coded field's set is an error.
    entry: [{ resource: { resourceType: "MedicationRequest", status: "not-a-status", intent: "order", subject: { reference: "Patient/p" } } }],
  });

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
