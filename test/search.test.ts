// escapeSearchValue(): a value a person typed, with FHIR's special characters escaped.
// searchToken(): a coding as the value a token search parameter takes.
import { describe, expect, it } from "vitest";
import { escapeSearchValue, Haau3, Haau3Error, searchToken, type fhir4 } from "../src/index.js";
import { EMPTY_SEARCH, fakeFetch, fhirAnswer, KEY } from "./helpers.js";

describe("escapeSearchValue()", () => {
  it("puts a backslash before each of FHIR's special characters", () => {
    expect(escapeSearchValue("Austin,")).toBe("Austin\\,");
    expect(escapeSearchValue("a|b")).toBe("a\\|b");
    expect(escapeSearchValue("$5")).toBe("\\$5");
    expect(escapeSearchValue("C:\\temp")).toBe("C:\\\\temp");
    expect(escapeSearchValue("Austin, TX | $ \\")).toBe("Austin\\, TX \\| \\$ \\\\");
  });

  it("leaves every other character as it is", () => {
    const plain = "San José St. Mary's (East) 123-456 ü 😀";
    expect(escapeSearchValue(plain)).toBe(plain);
    expect(escapeSearchValue("")).toBe("");
  });

  it("escapes a backslash once, so an escaped value is never escaped half-way", () => {
    expect(escapeSearchValue("\\,")).toBe("\\\\\\,");
  });

  it("reaches the API as the escaped value, encoded once", async () => {
    const { fetch, received } = fakeFetch(() => fhirAnswer(EMPTY_SEARCH));
    await new Haau3({ apiKey: KEY, fetch }).searchSlot({ "location-address-city": escapeSearchValue("Austin, TX") });
    expect(received[0]!.url.searchParams.get("location-address-city")).toBe("Austin\\, TX");
    expect(received[0]!.url.search).toContain("location-address-city=Austin%5C%2C+TX");
  });
});

describe("searchToken()", () => {
  const HL7 = "http://terminology.hl7.org/CodeSystem/service-type";

  it("writes a coding as system|code", () => {
    expect(searchToken({ system: HL7, code: "124" })).toBe(`${HL7}|124`);
  });

  it("takes a Coding and an expansion entry as they come, display and all", () => {
    const coding: fhir4.Coding = { system: HL7, code: "124", display: "General Practice", version: "1" };
    const entry: fhir4.ValueSetExpansionContains = { system: HL7, code: "124", display: "General Practice" };
    expect(searchToken(coding)).toBe(`${HL7}|124`);
    expect(searchToken(entry)).toBe(`${HL7}|124`);
  });

  it("escapes each part, so a code's comma, | or $ is part of the code, and leaves the | between them", () => {
    expect(searchToken({ system: "urn:a|b", code: "x,y$z\\w" })).toBe("urn:a\\|b|x\\,y\\$z\\\\w");
  });

  it("is any of several codings, their tokens joined by commas in the order given", () => {
    expect(searchToken({ system: HL7, code: "124" }, { system: "urn:a", code: "1,2" })).toBe(`${HL7}|124,urn:a|1\\,2`);
    const entries: fhir4.ValueSetExpansionContains[] = [
      { system: HL7, code: "124" },
      { system: HL7, code: "57" },
    ];
    expect(searchToken(entries[0]!, ...entries.slice(1))).toBe(`${HL7}|124,${HL7}|57`);
  });

  it("throws, naming what is missing, for a coding with no system or no code", () => {
    expect(() => searchToken({ code: "124" })).toThrow(new Haau3Error("searchToken() needs a system: the coding has none."));
    expect(() => searchToken({ system: HL7 })).toThrow(new Haau3Error("searchToken() needs a code: the coding has none."));
    expect(() => searchToken({ system: "", code: "124" })).toThrow(Haau3Error);
    expect(() => searchToken({ system: HL7, code: "124" }, { system: HL7, code: "" })).toThrow(
      new Haau3Error("searchToken() needs a code: coding 2 has none."),
    );
  });

  it("reaches the API as one token, encoded once", async () => {
    const { fetch, received } = fakeFetch(() => fhirAnswer(EMPTY_SEARCH));
    await new Haau3({ apiKey: KEY, fetch }).searchSlot({ "schedule.service-type": searchToken({ system: "urn:a", code: "1,2" }) });
    expect(received[0]!.url.searchParams.getAll("schedule.service-type")).toEqual(["urn:a|1\\,2"]);
    expect(received[0]!.url.search).toContain("schedule.service-type=urn%3Aa%7C1%5C%2C2");
  });
});
