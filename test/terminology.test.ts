// lookupResult(), validationResult() and designations(): a terminology answer, typed, with no request,
// as client methods and as plain functions. The spec's own examples are read with "every part is typed
// or kept" checks, so a change to their values cannot break these tests and a change to their shape
// does. The answers of a code system the API holds are written here, as the API writes them: an
// ICD-10-CM code with its short title, and a made-up drug in RxNorm's shape.
import type { Parameters, ParametersParameter } from "fhir/r4.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  designations,
  Haau3,
  Haau3Error,
  lookupResult,
  PREFERRED_FOR_LANGUAGE_USE,
  RXNORM_SYSTEM,
  SYNONYM_USE,
  validationResult,
  type LookupResult,
} from "../src/index.js";
import { fakeFetch, KEY, spec } from "./helpers.js";

const example = (path: string): Parameters =>
  (Object.values(spec.paths[path]!.get.responses["200"].content["application/fhir+json"].examples) as Array<{ value: Parameters }>)[0]!.value;

const ICD10CM = "http://hl7.org/fhir/sid/icd-10-cm";
const LONG = "Diabetes mellitus due to underlying condition with diabetic macular edema, resolved following treatment, right eye";
const SHORT = "Diab with diabetic macular edema, resolved fol trtmt, r eye";
const use = (coding: { system: string; code: string; display: string | undefined }): ParametersParameter => ({
  name: "use",
  valueCoding: { system: coding.system, code: coding.code, display: coding.display },
});

/** An ICD-10-CM lookup, as the API answers one: the head, both titles, then notSelectable. */
const icd10cm: Parameters = {
  resourceType: "Parameters",
  parameter: [
    { name: "name", valueString: "ICD-10-CM" },
    { name: "code", valueCode: "E08.37X1" },
    { name: "system", valueUri: ICD10CM },
    { name: "version", valueString: "2026-10-01" },
    { name: "display", valueString: LONG },
    { name: "abstract", valueBoolean: false },
    { name: "designation", part: [{ name: "language", valueCode: "en" }, use(PREFERRED_FOR_LANGUAGE_USE), { name: "value", valueString: LONG }] },
    { name: "designation", part: [{ name: "language", valueCode: "en" }, use(SYNONYM_USE), { name: "value", valueString: SHORT }] },
    { name: "property", part: [{ name: "code", valueCode: "notSelectable" }, { name: "value", valueBoolean: false }] },
  ],
};

/** A made-up drug in RxNorm's shape: names with no use, and properties of three types. */
const rxnorm: Parameters = {
  resourceType: "Parameters",
  parameter: [
    { name: "name", valueString: "RxNorm" },
    { name: "code", valueCode: "R1000" },
    { name: "system", valueUri: RXNORM_SYSTEM },
    { name: "version", valueString: "09082026" },
    { name: "display", valueString: "fake drug 10 mg tablet" },
    { name: "abstract", valueBoolean: false },
    { name: "warning", valueString: "RxNorm is held in English only, so the display and designations are in English." },
    { name: "designation", part: [{ name: "language", valueCode: "en" }, use(PREFERRED_FOR_LANGUAGE_USE), { name: "value", valueString: "fake drug 10 mg tablet" }] },
    { name: "designation", part: [{ name: "language", valueCode: "en" }, { name: "value", valueString: "fake drug 10 mg" }] },
    { name: "property", part: [{ name: "code", valueCode: "TTY" }, { name: "value", valueCode: "SCD" }] },
    { name: "property", part: [{ name: "code", valueCode: "inactive" }, { name: "value", valueBoolean: false }] },
    {
      name: "property",
      part: [{ name: "code", valueCode: "has_dose_form" }, { name: "value", valueCoding: { system: RXNORM_SYSTEM, code: "R1002", display: "fake form" } }],
    },
  ],
};

const lookup = (...parameter: ParametersParameter[]): Parameters => ({ resourceType: "Parameters", parameter });

/** Every top-level part of an answer, as the reader typed or kept it, so none is lost. */
function partsAccountedFor(answer: Parameters, read: LookupResult | ReturnType<typeof validationResult>): number {
  const typed = Object.entries(read).filter(([key, value]) => !["designations", "properties", "other"].includes(key) && value !== undefined).length;
  const lists = "designations" in read ? read.designations.length + read.properties.length : 0;
  return typed + lists + read.other.length;
}

function client() {
  const { fetch, received } = fakeFetch(() => {
    throw new Error("lookupResult(), validationResult() and designations() send nothing");
  });
  return { haau3: new Haau3({ apiKey: KEY, fetch }), received };
}

describe("lookupResult()", () => {
  it("reads an ICD-10-CM lookup: the head, both titles and notSelectable", () => {
    const { haau3, received } = client();
    const read = haau3.lookupResult(icd10cm);
    expect(read).toEqual({
      name: "ICD-10-CM",
      code: "E08.37X1",
      system: ICD10CM,
      version: "2026-10-01",
      display: LONG,
      abstract: false,
      warning: undefined,
      designations: [
        { language: "en", use: PREFERRED_FOR_LANGUAGE_USE, value: LONG, other: [] },
        { language: "en", use: SYNONYM_USE, value: SHORT, other: [] },
      ],
      properties: [{ code: "notSelectable", type: "boolean", value: false, description: undefined, subproperties: [], other: [] }],
      other: [],
    });
    expect(received).toHaveLength(0);
  });

  it("types each property's value by its value[x], and reads the warning", () => {
    const read = lookupResult(rxnorm);
    expect(read.warning).toBe("RxNorm is held in English only, so the display and designations are in English.");
    expect(read.properties.map(({ code, type, value }) => ({ code, type, value }))).toEqual([
      { code: "TTY", type: "code", value: "SCD" },
      { code: "inactive", type: "boolean", value: false },
      { code: "has_dose_form", type: "Coding", value: { system: RXNORM_SYSTEM, code: "R1002", display: "fake form" } },
    ]);
    const form = read.properties[2]!;
    // Checking type narrows value, with no cast.
    if (form.type === "Coding") expect(form.value.code).toBe("R1002");
    expect(read.designations[1]).toEqual({ language: "en", use: undefined, value: "fake drug 10 mg", other: [] });
  });

  it("reads the spec's own lookup example, typing or keeping every part", () => {
    const answer = example("/v1/fhir/r4/CodeSystem/$lookup");
    const read = lookupResult(answer);
    expect(partsAccountedFor(answer, read)).toBe(answer.parameter!.length);
    expect(read.code).toBe(answer.parameter!.find((part) => part.name === "code")?.valueCode);
    // The example names its system as a valueString, which reads as the system all the same.
    expect(read.system).toBe("http://loinc.org");
  });

  it("reads subproperties, a description, and the parts it does not know", () => {
    const read = lookupResult(
      lookup(
        { name: "definition", valueString: "A made-up definition" },
        {
          name: "designation",
          part: [
            { name: "language", valueCode: "en" },
            { name: "additionalUse", valueCoding: { system: "http://example.org/use", code: "extra" } },
            { name: "value", valueString: "a name" },
          ],
        },
        {
          name: "property",
          part: [
            { name: "code", valueCode: "parent" },
            { name: "value", valueInteger: 3 },
            { name: "description", valueString: "how many" },
            { name: "source", valueUri: "http://example.org/source" },
            { name: "subproperty", part: [{ name: "code", valueCode: "child" }, { name: "value", valueDecimal: 1.5 }] },
            { name: "subproperty", part: [{ name: "code", valueCode: "dated" }, { name: "value", valueDateTime: "2026-11-04" }] },
          ],
        },
      ),
    );
    expect(read.other).toEqual([{ name: "definition", valueString: "A made-up definition" }]);
    expect(read.designations[0]!.other).toEqual([{ name: "additionalUse", valueCoding: { system: "http://example.org/use", code: "extra" } }]);
    expect(read.properties[0]).toEqual({
      code: "parent",
      type: "integer",
      value: 3,
      description: "how many",
      subproperties: [
        { code: "child", type: "decimal", value: 1.5, description: undefined, subproperties: [], other: [] },
        { code: "dated", type: "dateTime", value: "2026-11-04", description: undefined, subproperties: [], other: [] },
      ],
      other: [{ name: "source", valueUri: "http://example.org/source" }],
    });
  });

  it("keeps a part it cannot read in `other`, in answer order, and guesses at nothing", () => {
    const noValue: ParametersParameter = { name: "designation", part: [{ name: "language", valueCode: "en" }] };
    const otherType: ParametersParameter = { name: "property", part: [{ name: "code", valueCode: "x" }, { name: "value", valueAttachment: {} }] };
    const noCode: ParametersParameter = { name: "property", part: [{ name: "value", valueString: "y" }] };
    const textAbstract: ParametersParameter = { name: "abstract", valueString: "false" };
    const read = lookupResult(lookup(noValue, { name: "display", valueString: "A" }, otherType, textAbstract, noCode));
    expect(read.other).toEqual([noValue, otherType, textAbstract, noCode]);
    expect(read.abstract).toBeUndefined();
    expect(read.display).toBe("A");
    expect(read.designations).toEqual([]);
    expect(read.properties).toEqual([]);
  });

  it("keeps a use with no code in the designation's `other`", () => {
    const noCode: ParametersParameter = { name: "use", valueCoding: { system: "http://example.org/use" } };
    const read = lookupResult(lookup({ name: "designation", part: [noCode, { name: "value", valueString: "a name" }] }));
    expect(read.designations).toEqual([{ language: undefined, use: undefined, value: "a name", other: [noCode] }]);
  });

  it("reads a missing part as undefined", () => {
    expect(lookupResult(lookup())).toEqual({
      name: undefined,
      code: undefined,
      system: undefined,
      version: undefined,
      display: undefined,
      abstract: undefined,
      warning: undefined,
      designations: [],
      properties: [],
      other: [],
    });
  });

  it("throws when a part FHIR allows once comes twice, since which one is meant is ambiguous", () => {
    const two = lookup({ name: "display", valueString: "A" }, { name: "display", valueString: "B" });
    expect(() => lookupResult(two)).toThrow(Haau3Error);
    expect(() => lookupResult(two)).toThrow("The Parameters holds 2 parts named display, so which one is meant is ambiguous. Read them with parameters().");
    const twoValues = lookup({ name: "designation", part: [{ name: "value", valueString: "A" }, { name: "value", valueString: "B" }] });
    expect(() => lookupResult(twoValues)).toThrow("A designation holds 2 parts named value, so which one is meant is ambiguous.");
  });
});

describe("validationResult()", () => {
  it("reads a display that did not match: false, with the code's display", () => {
    const { haau3 } = client();
    const answer = lookup(
      { name: "result", valueBoolean: false },
      { name: "display", valueString: "Heart rate" },
      { name: "message", valueString: "The display sent is not the code's." },
    );
    expect(haau3.validationResult(answer)).toEqual({ result: false, display: "Heart rate", message: "The display sent is not the code's.", other: [] });
  });

  it("reads the spec's own examples, typing or keeping every part", () => {
    for (const path of ["/v1/fhir/r4/CodeSystem/$validate-code", "/v1/fhir/r4/ValueSet/$validate-code"]) {
      const answer = example(path);
      const read = validationResult(answer);
      expect(read.result).toBe(true);
      expect(partsAccountedFor(answer, read)).toBe(answer.parameter!.length);
    }
  });

  it("throws on two results", () => {
    expect(() => validationResult(lookup({ name: "result", valueBoolean: true }, { name: "result", valueBoolean: false }))).toThrow(Haau3Error);
  });
});

describe("designations()", () => {
  const read = lookupResult(icd10cm);

  it("finds the short title by its use and language", () => {
    expect(designations(read, { use: SYNONYM_USE, language: "en" }).map((designation) => designation.value)).toEqual([SHORT]);
    expect(designations(read, { use: PREFERRED_FOR_LANGUAGE_USE })[0]?.value).toBe(LONG);
  });

  it("finds every designation when no field is given", () => {
    expect(designations(read)).toEqual(read.designations);
  });

  it("matches a use by its system and code together, never the code alone", () => {
    expect(designations(read, { use: { system: "http://snomed.info/sct", code: "synonym", display: undefined } })).toEqual([]);
    expect(designations(read, { use: { ...SYNONYM_USE, display: "another display" } })).toHaveLength(1);
  });

  it("matches a language as RFC 4647's basic filtering does", () => {
    const languages = lookupResult(
      lookup(
        ...["en", "en-US", "EN-gb", "eng", "de"].map((language) => ({
          name: "designation",
          part: [{ name: "language", valueCode: language }, { name: "value", valueString: language }],
        })),
        { name: "designation", part: [{ name: "value", valueString: "no language" }] },
      ),
    );
    const found = (language: string) => designations(languages, { language }).map((designation) => designation.value);
    expect(found("en")).toEqual(["en", "en-US", "EN-gb"]);
    expect(found("EN-US")).toEqual(["en-US"]);
    expect(found("*")).toEqual(["en", "en-US", "EN-gb", "eng", "de"]);
    expect(designations(languages).map((designation) => designation.value)).toContain("no language");
  });

  it("finds a designation with no use only when no use is asked for", () => {
    const drug = lookupResult(rxnorm);
    expect(designations(drug, { language: "en" }).map((designation) => designation.value)).toContain("fake drug 10 mg");
    expect(designations(drug, { use: SYNONYM_USE })).toEqual([]);
  });
});

describe("the plain functions", () => {
  it("read what the client's methods read, with no client", () => {
    const { haau3, received } = client();
    expect(lookupResult(icd10cm)).toEqual(haau3.lookupResult(icd10cm));
    expect(validationResult(icd10cm)).toEqual(haau3.validationResult(icd10cm));
    const read = lookupResult(icd10cm);
    expect(designations(read, { use: SYNONYM_USE })).toEqual(haau3.designations(read, { use: SYNONYM_USE }));
    expect(received).toHaveLength(0);
  });

  it("keep the constants as they are", () => {
    expect(Object.isFrozen(SYNONYM_USE) && Object.isFrozen(PREFERRED_FOR_LANGUAGE_USE)).toBe(true);
  });

  describe("in a browser, where the client refuses to start", () => {
    beforeEach(() => {
      vi.stubGlobal("window", {});
      vi.stubGlobal("document", {});
      vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh) Chrome/141.0" });
    });
    afterEach(() => vi.unstubAllGlobals());

    it("read a stored answer", () => {
      expect(() => new Haau3({ apiKey: KEY })).toThrow(/server only/);
      expect(designations(lookupResult(icd10cm), { use: SYNONYM_USE })[0]?.value).toBe(SHORT);
    });
  });
});
