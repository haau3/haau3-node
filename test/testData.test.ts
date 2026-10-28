// markAsTestData labels exactly the resources the API reads for the test data label: the request,
// each Bundle entry, each Parameters resource part at any depth, and the same again inside them.
import { describe, expect, it } from "vitest";
import type { Bundle, Coding, MedicationRequest, Parameters, Patient } from "fhir/r4.js";
import { markAsTestData } from "../src/index.js";
import { spec } from "./helpers.js";

const HTEST = { system: "http://terminology.hl7.org/CodeSystem/v3-ActReason", code: "HTEST", display: "test health data" };
const isHtest = (coding: unknown) =>
  typeof coding === "object" && coding !== null && (coding as Coding).system === HTEST.system && (coding as Coding).code === HTEST.code;

/** A copy with every HTEST label taken out, and a `meta` or `security` it leaves empty with it. */
function strip<T>(value: T): T {
  const copy = structuredClone(value);
  const stack: unknown[] = [copy];
  while (stack.length > 0) {
    const node = stack.pop();
    if (typeof node !== "object" || node === null) continue;
    const meta = (node as { meta?: { security?: unknown[] } }).meta;
    if (meta && Array.isArray(meta.security)) {
      meta.security = meta.security.filter((coding) => !isHtest(coding));
      if (meta.security.length === 0) delete meta.security;
      if (Object.keys(meta).length === 0) delete (node as { meta?: unknown }).meta;
    }
    stack.push(...Object.values(node));
  }
  return copy;
}

/** How many HTEST labels a value holds, anywhere in it. */
function labels(value: unknown): number {
  let count = 0;
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const node = stack.pop();
    if (typeof node !== "object" || node === null) continue;
    if (isHtest(node)) count++;
    stack.push(...Object.values(node));
  }
  return count;
}

const security = (resource: unknown) => (resource as { meta?: { security?: Coding[] } }).meta?.security;

/** Every request example in the spec that carries the label, by operation. */
const labelledExamples: [string, Bundle | Parameters][] = [];
for (const item of Object.values(spec.paths)) {
  for (const op of Object.values(item)) {
    for (const media of Object.values((op?.requestBody?.content ?? {}) as Record<string, { examples?: Record<string, { value: unknown }> }>)) {
      for (const [name, example] of Object.entries(media.examples ?? {})) {
        if (labels(example.value) > 0) labelledExamples.push([`${op.operationId}: ${name}`, example.value as Bundle]);
      }
    }
  }
}

describe("markAsTestData", () => {
  it("finds the spec's labelled requests to check against", () => {
    expect(labelledExamples.map(([name]) => name.split(":")[0])).toEqual(expect.arrayContaining(["reconcileMedications", "sandboxProcessMessage"]));
  });

  it.each(labelledExamples)("labels %s exactly as the spec's example is labelled", (_, example) => {
    const unlabelled = strip(example);
    // The control: stripping took every label out, so the match below is the helper's work.
    expect(labels(unlabelled)).toBe(0);
    expect(markAsTestData(unlabelled)).toEqual(example);
  });

  it("labels each resource part of a Parameters, at any depth, and the entries of a Bundle sent as a part", () => {
    const patient: Patient = { resourceType: "Patient" };
    const records: Bundle = { resourceType: "Bundle", type: "collection", entry: [{ resource: patient }, { fullUrl: "urn:uuid:no-resource" }] };
    const parameters: Parameters = {
      resourceType: "Parameters",
      parameter: [
        { name: "bundle", resource: records },
        { name: "outer", part: [{ name: "inner", part: [{ name: "resource", resource: patient }] }] },
        { name: "asOf", valueDateTime: "2026-10-28" },
      ],
    };
    const marked = markAsTestData(parameters);
    const bundle = marked.parameter?.[0]?.resource as Bundle;
    expect(security(marked)).toEqual([HTEST]);
    expect(security(bundle)).toEqual([HTEST]);
    expect(security(bundle.entry?.[0]?.resource)).toEqual([HTEST]);
    expect(security(marked.parameter?.[1]?.part?.[0]?.part?.[0]?.resource)).toEqual([HTEST]);
    expect(bundle.entry?.[1]).toEqual({ fullUrl: "urn:uuid:no-resource" });
    expect(marked.parameter?.[2]).toEqual({ name: "asOf", valueDateTime: "2026-10-28" });
    expect(labels(marked)).toBe(4);
  });

  it("leaves a contained resource to the one that contains it", () => {
    const order: MedicationRequest = {
      resourceType: "MedicationRequest",
      status: "active",
      intent: "order",
      subject: { reference: "Patient/p" },
      medicationReference: { reference: "#med" },
      contained: [{ resourceType: "Medication", id: "med" }],
    };
    const marked = markAsTestData({ resourceType: "Bundle", type: "collection", entry: [{ resource: order }] } satisfies Bundle);
    const labelledOrder = marked.entry?.[0]?.resource as MedicationRequest;
    expect(security(labelledOrder)).toEqual([HTEST]);
    expect(labelledOrder.contained?.[0]).toEqual({ resourceType: "Medication", id: "med" });
  });

  it("keeps the labels and the meta already there, and never adds a second HTEST", () => {
    const confidential = { system: "http://terminology.hl7.org/CodeSystem/v3-Confidentiality", code: "N" };
    const bundle: Bundle = {
      resourceType: "Bundle",
      type: "collection",
      meta: { security: [{ system: HTEST.system, code: "HTEST" }] },
      entry: [{ resource: { resourceType: "Patient", meta: { profile: ["http://example.org/p"], security: [confidential] } } }],
    };
    const marked = markAsTestData(bundle);
    expect(security(marked)).toEqual([{ system: HTEST.system, code: "HTEST" }]);
    expect(marked.entry?.[0]?.resource?.meta).toEqual({ profile: ["http://example.org/p"], security: [confidential, HTEST] });
  });

  it("never changes the request it is given", () => {
    const bundle: Bundle = { resourceType: "Bundle", type: "collection", entry: [{ resource: { resourceType: "Patient" } }] };
    const before = structuredClone(bundle);
    const frozen = deepFreeze(bundle);
    const marked = markAsTestData(frozen);
    expect(bundle).toEqual(before);
    expect(marked).not.toBe(bundle);
    expect(labels(marked)).toBe(2);
  });

  it("gives the same request when it marks one already marked", () => {
    const once = markAsTestData(labelledExamples[0]![1]);
    expect(markAsTestData(once)).toEqual(once);
  });

  it("labels a request of any other resource type itself", () => {
    expect(security(markAsTestData({ resourceType: "Patient" } satisfies Patient))).toEqual([HTEST]);
  });

  // A request nested deeper than JSON.stringify can serialise could not be sent anyway, so the depth
  // here is one the SDK sends, and deeper than structuredClone copies on Node 24. The copy and the
  // walk use a stack, not the call stack.
  it("labels every level of a deeply nested request", () => {
    const depth = 1_000;
    const root: Parameters = { resourceType: "Parameters", parameter: [] };
    let current = root;
    for (let i = 0; i < depth; i++) {
      const next: Parameters = { resourceType: "Parameters", parameter: [] };
      current.parameter!.push({ name: "level", resource: next });
      current = next;
    }
    const marked = markAsTestData(root);
    expect(labels(marked)).toBe(depth + 1);
    expect(() => JSON.stringify(marked)).not.toThrow();
  });

  it("copies a key named __proto__ as a key, and keeps what is not plain JSON as it is", () => {
    const parsed = JSON.parse('{"resourceType":"Patient","__proto__":{"polluted":true}}') as Patient;
    const marked = markAsTestData(parsed);
    expect(Object.getPrototypeOf(marked)).toBe(Object.prototype);
    expect(Object.keys(marked)).toContain("__proto__");
    expect(JSON.parse(JSON.stringify(marked))).toEqual({ ...JSON.parse(JSON.stringify(parsed)), meta: { security: [HTEST] } });
    const born = new Date("2000-01-01T00:00:00Z");
    const withDate = markAsTestData({ resourceType: "Patient", birthDate: born as unknown as string } satisfies Patient);
    expect(JSON.stringify(withDate.birthDate)).toBe(JSON.stringify(born));
  });
});

function deepFreeze<T>(value: T): T {
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const node = stack.pop();
    if (typeof node !== "object" || node === null || Object.isFrozen(node)) continue;
    Object.freeze(node);
    stack.push(...Object.values(node));
  }
  return value;
}
