// Compiled against the packed package by scripts/check-consumer.ts, under each TypeScript version
// customers use (5.9, 6.0, 7.0), as ES modules. consumer.cts is the same as CommonJS.
import { AuthError, Haau3, NoAnswerError, RefusedError, type fhir4, type NoAnswerReason } from "@haau3/sdk";
import type { SchedulingProviderLocation, SchedulingSlot, SearchInsurancePlanParams } from "@haau3/sdk";

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
      void [reason, wait];
    } else if (error instanceof AuthError) {
      const id: string | undefined = error.requestId;
      void id;
    }
  }
}
