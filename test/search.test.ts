// escapeSearchValue(): a value a person typed, with FHIR's special characters escaped.
import { describe, expect, it } from "vitest";
import { escapeSearchValue, Haau3 } from "../src/index.js";
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
