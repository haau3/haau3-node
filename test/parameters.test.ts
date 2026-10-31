// parameters(), parameter() and reviewFlags(): a Parameters answer's named parts, and the review flags
// on a structured Dosage, with no request. Read from the spec's own example of $structure-dosage's
// answer, so a change to that answer's shape fails here.
import type { Dosage, Parameters } from "fhir/r4.js";
import { describe, expect, it } from "vitest";
import { Haau3, Haau3Error } from "../src/index.js";
import { fakeFetch, KEY, spec } from "./helpers.js";

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
