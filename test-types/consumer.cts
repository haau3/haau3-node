// Compiled against the packed package by scripts/check-consumer.ts, under each TypeScript version
// customers use (5.9, 6.0, 7.0), as CommonJS. consumer.mts is the same as ES modules.
import { AuthError, Haau3, NoAnswerError, RefusedError, type fhir4, type NoAnswerReason } from "@haau3/sdk";
import type { SchedulingProviderLocation, SchedulingSlot, SearchInsurancePlanParams } from "@haau3/sdk";
import type { BatchResult, BodyOf, QueryOf, ResponseOf } from "@haau3/sdk";

const haau3 = new Haau3({ apiKey: "haau3_sk_example", timeout: 10_000, maxRetries: 0 });

export async function tour(): Promise<void> {
  const plan: fhir4.InsurancePlan = await haau3.readInsurancePlan("H2406-013-000");
  const params: SearchInsurancePlanParams = { "coverage-area-state": "NC", _count: 10 };
  const plans: fhir4.Bundle = await haau3.searchInsurancePlan(params);
  for await (const page of haau3.pages(plans)) {
    const ids: (string | undefined)[] = (page.entry ?? []).map((entry) => entry.resource?.id);
    void ids;
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
    } else if (error instanceof AuthError) {
      const id: string | undefined = error.requestId;
      void id;
    }
  }
}
