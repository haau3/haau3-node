// Against the production API, on a real key. Runs only when asked:
//
//   HAAU3_LIVE_TEST=1 HAAU3_API_KEY=haau3_sk_... pnpm test test/live.test.ts
//
// CI never sets either, so it never runs there.
import { describe, expect, it } from "vitest";
import { Haau3, RefusedError } from "../src/index.js";

const live = process.env.HAAU3_LIVE_TEST === "1" && Boolean(process.env.HAAU3_API_KEY);

describe.skipIf(!live)("the production API", () => {
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

  it("refuses a record that does not exist", async () => {
    await expect(haau3.readInsurancePlan("H0000-000-000")).rejects.toBeInstanceOf(RefusedError);
  });
});
