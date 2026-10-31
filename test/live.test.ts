// Against the production API, on a real key. Runs only when asked:
//
//   HAAU3_LIVE_TEST=1 HAAU3_API_KEY=haau3_sk_... pnpm test test/live.test.ts
//
// CI never sets either, so it never runs there. The calls below are the API's services outside the
// Sandbox, so they skip on a test key (`haau3_sk_test_`), whose calls test/samples.test.ts makes. The
// patient-data cases need a live key (`haau3_sk_live_`) from an organization with no agreement on
// file, which is refused real patient data.
import type { Bundle, Resource } from "fhir/r4.js";
import { describe, expect, it } from "vitest";
import { ForbiddenError, Haau3, markAsTestData, parameter, RefusedError, reviewFlags, RXNORM_SYSTEM, structureDosageRequest } from "../src/index.js";
import { spec } from "./helpers.js";

const live = process.env.HAAU3_LIVE_TEST === "1" && Boolean(process.env.HAAU3_API_KEY);
const key = process.env.HAAU3_API_KEY ?? "";
const testKey = key.startsWith("haau3_sk_test_");
const liveKey = key.startsWith("haau3_sk_live_");

/** A copy with every `HTEST` label taken off, so made-up records read as real patient data. */
function withoutTestLabels<T>(value: T): T {
  if (Array.isArray(value)) return value.map(withoutTestLabels) as T;
  if (!value || typeof value !== "object") return value;
  const copy = Object.fromEntries(Object.entries(value).map(([k, v]) => [k, withoutTestLabels(v)])) as Record<string, any>;
  if (Array.isArray(copy.meta?.security)) {
    const security = copy.meta.security.filter((c: { code?: string }) => c.code !== "HTEST");
    copy.meta = { ...copy.meta, security };
    if (security.length === 0) delete copy.meta.security;
    if (Object.keys(copy.meta).length === 0) delete copy.meta;
  }
  return copy as T;
}

describe.skipIf(!live || !liveKey)("patient data on the production API, without an agreement", () => {
  const haau3 = live ? new Haau3() : (undefined as never);
  // MedList's example request from the spec: made-up records, here with their test-data labels off.
  const media = (spec.paths["/v1/fhir/r4/$reconcile-medications"] as any).post.requestBody.content["application/fhir+json"];
  const records = withoutTestLabels(Object.values(media.examples as Record<string, { value: Bundle }>)[0]!.value);

  it("answers made-up records that markAsTestData labels", async () => {
    expect(JSON.stringify(records)).not.toContain("HTEST");
    const list = await haau3.reconcileMedications(markAsTestData(records as Resource as Bundle));
    expect(list.resourceType).toBe("Bundle");
  });

  it("refuses the same records unlabelled, with a ForbiddenError naming the agreement", async () => {
    const refused = await haau3.reconcileMedications(records).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(ForbiddenError);
    expect((refused as ForbiddenError).code).toBe("phi-agreement-required");
  });
});

describe.skipIf(!live || testKey)("the production API", () => {
  const haau3 = live ? new Haau3() : (undefined as never);

  it("answers a Scheduling search", async () => {
    const answer = await haau3.searchProviderLocations({ publisher: "haau3", limit: 1 });
    expect(answer.total).toBeGreaterThan(0);
    expect(answer.providerLocations).toHaveLength(1);
  });

  it("reads a FHIR resource", async () => {
    const plan = await haau3.readInsurancePlan("H2406-013-000");
    expect(plan.resourceType).toBe("InsurancePlan");
    expect(plan.id).toBe("H2406-013-000");
  });

  it("looks up a code", async () => {
    const answer = await haau3.codeSystemLookup({ system: "http://loinc.org", code: "2345-7" });
    expect(answer.resourceType).toBe("Parameters");
  });

  it("structures a sig built with structureDosageRequest, and reads its review flag", async () => {
    const text = "Instill 2 drops in the affected ear twice daily";
    const answer = await haau3.structureDosage(
      structureDosageRequest({ text, medication: { coding: [{ system: RXNORM_SYSTEM, code: "1923428" }] } }),
    );
    const dosage = parameter(answer, "dosage")?.valueDosage;
    expect(dosage?.text).toBe(text);
    expect(reviewFlags(dosage!).flags.map((flag) => flag.code)).toEqual(["route-form-mismatch"]);
  });

  it("pages a search to a second page", async () => {
    const first = await haau3.searchInsurancePlan({ "coverage-area-state": "NC", _count: 2 });
    let pages = 0;
    for await (const page of haau3.pages(first)) {
      pages += 1;
      expect(page.resourceType).toBe("Bundle");
      if (pages === 2) break;
    }
    expect(pages).toBe(2);
  });

  it("sends a batch, each entry with its own answer or error", async () => {
    const [lookup, missing] = await haau3.batch((b) => [
      b.codeSystemLookup({ system: "http://loinc.org", code: "2345-7" }),
      b.readInsurancePlan("H0000-000-000"),
    ]);
    expect(lookup.ok && lookup.data.resourceType).toBe("Parameters");
    expect(missing.ok ? undefined : missing.error).toBeInstanceOf(RefusedError);
  });

  it("keeps your own request id and returns it", async () => {
    const correlationId = crypto.randomUUID();
    const answered = await haau3.readInsurancePlan("H2406-013-000", { correlationId }).withResponse();
    expect(answered.correlationId).toBe(correlationId);
    expect(answered.requestId).toBeDefined();
    expect(answered.requestId).not.toBe(correlationId);
  });

  it("refuses a record that does not exist", async () => {
    await expect(haau3.readInsurancePlan("H0000-000-000")).rejects.toBeInstanceOf(RefusedError);
  });
});
