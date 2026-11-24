// The first call's parameters (scripts/first-call.ts): the slot search's example less its includes,
// which the example must send exactly as searchSlotWithIncludes does, so the sample is the request
// the Sandbox answers.
import { describe, expect, it } from "vitest";
import { firstCallParams } from "../scripts/first-call.js";

const NPI = { "provider-identifier": "http://hl7.org/fhir/sid/us-npi|2900000227", _count: 1 };
const HELPERS = {
  _include: "Slot:schedule",
  "_include:iterate": ["Schedule:actor", "PractitionerRole:practitioner", "HealthcareService:location"],
};

describe("the first call's parameters", () => {
  it("are the example's, less the includes the helper sends", () => {
    expect(firstCallParams("searchSlot", { ...NPI, ...HELPERS })).toEqual(NPI);
  });

  it("take the includes in any order, one value or a list", () => {
    const reordered = { ...NPI, _include: ["Slot:schedule"], "_include:iterate": [...HELPERS["_include:iterate"]].reverse() };
    expect(firstCallParams("searchSlot", reordered)).toEqual(NPI);
  });

  it("are refused when the example sends one include fewer, or one more, than the helper", () => {
    const fewer = { ...NPI, ...HELPERS, "_include:iterate": ["Schedule:actor", "PractitionerRole:practitioner"] };
    expect(() => firstCallParams("searchSlot", fewer)).toThrow(
      "searchSlot: the example's _include:iterate is not what searchSlotWithIncludes sends, so the first call would not be the example.",
    );
    const more = { ...NPI, ...HELPERS, _include: ["Slot:schedule", "Slot:other"] };
    expect(() => firstCallParams("searchSlot", more)).toThrow(/the example's _include is not/);
    expect(() => firstCallParams("searchSlot", NPI)).toThrow(/the example's _include is not/);
  });
});
