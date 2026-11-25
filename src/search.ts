import type { Coding } from "fhir/r4.js";

import { Haau3Error } from "./errors.js";

/**
 * A value for a FHIR search parameter, with FHIR's special characters escaped, so the API reads it as
 * the one value it is: `\`, `,`, `$` and `|` each take a `\` before them, as FHIR R4 says ("Escaping
 * Search Parameters", https://hl7.org/fhir/R4/search.html#escaping).
 *
 * Escape what a person typed before it goes into a search. Unescaped, a comma separates values the
 * API reads as "or" (so `Austin, TX` asks for two cities), a value with an empty part is refused (a
 * trailing comma), and a `|` splits a token's system from its code.
 *
 * ```ts
 * const page = await haau3.searchSlotWithIncludes({ "location-address-city": escapeSearchValue(typedCity) });
 * ```
 *
 * Never escape a value you built with `,` or `|` on purpose, such as a list of codes or a
 * `system|code` token: escaping would make it one literal value. Build a token with `searchToken()`.
 */
export function escapeSearchValue(value: string): string {
  return value.replace(/[\\,$|]/g, (character) => `\\${character}`);
}

/**
 * The value a FHIR token search parameter takes for a code in its code system: `system|code`, with
 * each part escaped (`escapeSearchValue`), as FHIR R4 writes a token ("token", https://hl7.org/fhir/R4/search.html#token).
 * Given several codings, it is any of them: their tokens joined by commas.
 *
 * It takes a `Coding`, an entry of a `ValueSet` expansion (`expansion.contains`), or anything with a
 * `system` and a `code`, so a code picked from an expansion goes straight into a search:
 *
 * ```ts
 * const serviceTypes = await haau3.valueSetExpand({ url: "https://fhir.haau3.com/platform/ValueSet/scheduling-service-types" });
 * const [chosen] = serviceTypes.expansion?.contains ?? [];
 * if (chosen) await haau3.searchSlotWithIncludes({ "schedule.service-type": searchToken(chosen) });
 * ```
 *
 * Each coding needs both a system and a code: it throws a `Haau3Error` naming the one missing, since
 * a token without its system would match the code in every system. For a code in any system, send
 * `escapeSearchValue(code)` instead.
 */
export function searchToken(
  coding: Pick<Coding, "system" | "code">,
  ...more: Pick<Coding, "system" | "code">[]
): string {
  return [coding, ...more]
    .map(({ system, code }, index) => {
      const which = more.length > 0 ? `coding ${index + 1}` : "the coding";
      if (!system) throw new Haau3Error(`searchToken() needs a system: ${which} has none.`);
      if (!code) throw new Haau3Error(`searchToken() needs a code: ${which} has none.`);
      return `${escapeSearchValue(system)}|${escapeSearchValue(code)}`;
    })
    .join(",");
}
