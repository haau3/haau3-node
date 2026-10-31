// parameters(), parameter() and reviewFlags(): a Parameters answer's named parts, and the review flags
// on a structured Dosage, with no request, as client methods and as plain functions; and
// structureDosageRequest(), the request $structure-dosage takes. Read from the spec's own example of $structure-dosage's
// answer, so a change to that answer's shape fails here.
import type { Dosage, Parameters } from "fhir/r4.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Haau3, Haau3Error, NDC_SYSTEM, parameter, parameters, reviewFlags, RXNORM_SYSTEM, structureDosageRequest } from "../src/index.js";
import { fakeFetch, fhirAnswer, KEY, spec } from "./helpers.js";

const examples = spec.paths["/v1/fhir/r4/$structure-dosage"]!.post.responses["200"].content["application/fhir+json"].examples;
const answer = (Object.values(examples) as Array<{ value: Parameters }>)[0]!.value;

function client() {
  const { fetch, received } = fakeFetch(() => {
    throw new Error("parameters(), parameter() and reviewFlags() send nothing");
  });
  return { haau3: new Haau3({ apiKey: KEY, fetch }), received };
}

describe("parameters() and parameter()", () => {
  it("give the parts with a name, and the one", () => {
    const { haau3, received } = client();
    expect(haau3.parameters(answer, "dosage")).toHaveLength(1);
    expect(haau3.parameter(answer, "dosage")?.valueDosage?.text).toBe("Instill 2 drops in the affected ear twice daily");
    expect(received).toHaveLength(0);
  });

  it("give nothing for a name the answer does not hold", () => {
    const { haau3 } = client();
    expect(haau3.parameters(answer, "display")).toEqual([]);
    expect(haau3.parameter(answer, "display")).toBeUndefined();
    expect(haau3.parameters({ resourceType: "Parameters" }, "dosage")).toEqual([]);
  });

  it("parameter() throws when two parts share the name, and parameters() gives both", () => {
    const { haau3 } = client();
    const two: Parameters = { resourceType: "Parameters", parameter: [{ name: "property", valueString: "a" }, { name: "property", valueString: "b" }] };
    expect(() => haau3.parameter(two, "property")).toThrow(Haau3Error);
    expect(haau3.parameters(two, "property").map((part) => part.valueString)).toEqual(["a", "b"]);
  });
});

describe("reviewFlags()", () => {
  it("reads the example's flag, with its words, and its versions", () => {
    const { haau3 } = client();
    const review = haau3.reviewFlags(haau3.parameter(answer, "dosage")!.valueDosage!);
    expect(review.flags).toEqual([{ code: "route-form-mismatch", display: "Route and dose form differ", words: "in the affected ear" }]);
    expect(review.engineVersion).toMatch(/^\d{4}-\d{2}-\d{2}\.v\d+$/);
    expect(review.vocabularyVersion).toMatch(/^\d{4}-\d{2}-\d{2}\.v\d+$/);
    expect(review.rxnormRelease).toMatch(/^\d{8}$/);
  });

  it("gives no flags and no versions for a Dosage that carries none (the control)", () => {
    const { haau3 } = client();
    expect(haau3.reviewFlags({ text: "Take 1 tablet daily" })).toEqual({ flags: [], engineVersion: undefined, vocabularyVersion: undefined, rxnormRelease: undefined });
  });

  it("leaves out other extensions, and a flag with no code", () => {
    const { haau3 } = client();
    const dosage: Dosage = {
      extension: [
        { url: "https://example.org/other", valueString: "x" },
        { url: "https://haau3.com/fhir/StructureDefinition/structured-sig-review-flag", extension: [{ url: "words", valueString: "x" }] },
        {
          url: "https://haau3.com/fhir/StructureDefinition/structured-sig-review-flag",
          extension: [{ url: "code", valueCoding: { code: "as-directed", display: "As directed" } }],
        },
      ],
    };
    expect(haau3.reviewFlags(dosage).flags).toEqual([{ code: "as-directed", display: "As directed", words: undefined }]);
  });
});

describe("the plain functions", () => {
  const dosage = (Object.values(examples) as Array<{ value: Parameters }>)[0]!.value.parameter![0]!.valueDosage!;

  it("read what the client's methods read, with no client", () => {
    const { haau3 } = client();
    expect(parameters(answer, "dosage")).toEqual(haau3.parameters(answer, "dosage"));
    expect(parameter(answer, "dosage")).toEqual(haau3.parameter(answer, "dosage"));
    expect(reviewFlags(dosage)).toEqual(haau3.reviewFlags(dosage));
    const two: Parameters = { resourceType: "Parameters", parameter: [{ name: "property" }, { name: "property" }] };
    expect(() => parameter(two, "property")).toThrow(Haau3Error);
  });

  describe("in a browser, where the client refuses to start", () => {
    beforeEach(() => {
      vi.stubGlobal("window", {});
      vi.stubGlobal("document", {});
      vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh) Chrome/141.0" });
    });
    afterEach(() => vi.unstubAllGlobals());

    it("the client refuses (the control)", () => {
      expect(() => new Haau3({ apiKey: KEY })).toThrow(/server only/);
    });

    it("the functions read a stored answer and build a request", () => {
      expect(reviewFlags(parameter(answer, "dosage")!.valueDosage!).flags.map((flag) => flag.code)).toEqual(["route-form-mismatch"]);
      expect(structureDosageRequest({ text: "Take 1 tablet daily" }).parameter).toHaveLength(1);
    });
  });
});

describe("structureDosageRequest()", () => {
  const requestExamples = spec.paths["/v1/fhir/r4/$structure-dosage"]!.post.requestBody.content["application/fhir+json"].examples;
  const exampleRequest = (Object.values(requestExamples) as Array<{ value: Parameters }>)[0]!.value;

  it("builds the spec's own example request from its directions and medication", () => {
    const text = exampleRequest.parameter!.find((part) => part.name === "text")!.valueString!;
    const medication = exampleRequest.parameter!.find((part) => part.name === "medication")!.valueCodeableConcept!;
    expect(medication.coding![0]!.system).toBe(RXNORM_SYSTEM);
    expect(structureDosageRequest({ text, medication })).toEqual({ ...exampleRequest, id: undefined });
  });

  it("sends a text part alone when there is no medication", () => {
    expect(structureDosageRequest({ text: "Take 1 tablet by mouth twice daily" })).toEqual({
      resourceType: "Parameters",
      parameter: [{ name: "text", valueString: "Take 1 tablet by mouth twice daily" }],
    });
  });

  it("keeps every coding of the medication, an NDC included", () => {
    const medication = { coding: [{ system: NDC_SYSTEM, code: "0378-0018-01" }, { system: RXNORM_SYSTEM, code: "197361" }] };
    expect(structureDosageRequest({ text: "Take 1 tablet daily", medication }).parameter![1]).toEqual({ name: "medication", valueCodeableConcept: medication });
  });

  it("checks nothing: the API's refusals are the one rule", () => {
    expect(structureDosageRequest({ text: "" }).parameter).toEqual([{ name: "text", valueString: "" }]);
  });

  it("is what structureDosage sends, alone and as a batch entry", async () => {
    const body = structureDosageRequest({ text: "Take 1 tablet by mouth twice daily" });
    const { fetch, received } = fakeFetch((request) =>
      request.url.pathname.endsWith("$structure-dosage")
        ? fhirAnswer(answer)
        : fhirAnswer({ resourceType: "Bundle", type: "batch-response", entry: [{ response: { status: "200" }, resource: answer }] }),
    );
    const haau3 = new Haau3({ apiKey: KEY, fetch });
    await haau3.structureDosage(body);
    const [entry] = await haau3.batch((b) => [b.structureDosage(body)]);
    expect(JSON.parse(received[0]!.body!)).toEqual(body);
    const batch = JSON.parse(received[1]!.body!) as { entry: Array<{ request: { url: string }; resource: unknown }> };
    expect(batch.entry[0]!.request.url).toBe("$structure-dosage");
    expect(batch.entry[0]!.resource).toEqual(body);
    expect(entry!.ok).toBe(true);
  });
});
