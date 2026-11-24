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
 * `system|code` token: escaping would make it one literal value.
 */
export function escapeSearchValue(value: string): string {
  return value.replace(/[\\,$|]/g, (character) => `\\${character}`);
}
