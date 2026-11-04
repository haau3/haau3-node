import type { Coding, Parameters, ParametersParameter } from "fhir/r4.js";
import { Haau3Error } from "./errors.js";

// Typed readers for the answers of the terminology operations, as FHIR's own SDKs give them in Java
// (HAPI's LookupCodeResult and CodeValidationResult, LinuxForHealth's LookupOutcome, Firely's
// ValidateCodeResult). Plain functions, with no client, as the readers in parameters.ts are. A part
// a reader does not know is kept, verbatim, in the `other` list of the level it was found at, so
// nothing a server sent is lost and nothing is guessed at.

/** How a designation is used: a code from a code system, saying what the name is for. */
export interface DesignationUse {
  /** The code system the use's code is from. */
  readonly system: string;
  /** The use's code. */
  readonly code: string;
  /** The code's display, when the answer gives one. */
  readonly display: string | undefined;
}

/**
 * The use of a name preferred for its language among several, HL7 Terminology's
 * `preferredForLanguage`. Every answer from a code system haau3 holds names the display again with
 * this use.
 */
export const PREFERRED_FOR_LANGUAGE_USE: DesignationUse = Object.freeze({
  system: "http://terminology.hl7.org/CodeSystem/hl7TermMaintInfra",
  code: "preferredForLanguage",
  display: "Preferred For Language",
});

/**
 * The use of a variant name that is also fit for display, the FHIR terminology ecosystem's
 * `synonym`. ICD-10-CM's short title has this use, where it differs from the display.
 */
export const SYNONYM_USE: DesignationUse = Object.freeze({
  system: "http://fhir.org/packages/fhir.tx.support/CodeSystem/designation-usage",
  code: "synonym",
  display: "Synonym",
});

/** One name for a code, as {@link lookupResult} reads it. */
export interface Designation {
  /** The name's language, such as `en`, when the answer says. */
  language: string | undefined;
  /** What the name is for, when the answer says. A name with no use is fit for display. */
  use: DesignationUse | undefined;
  /** The name. */
  value: string;
  /** The designation's parts this reader does not read, such as R5's `additionalUse`, verbatim. */
  other: ParametersParameter[];
}

/** What every {@link Property} has, whatever its value's type. */
export interface PropertyParts {
  /** The property's code, in the code system's own words, such as `notSelectable` or `TTY`. */
  code: string;
  /** The property's description, when the answer gives one. */
  description: string | undefined;
  /** The property's subproperties, in answer order. Empty when there are none. */
  subproperties: Property[];
  /** The property's parts this reader does not read, verbatim. */
  other: ParametersParameter[];
}

/**
 * One property of a code. `type` names the FHIR data type of its value, as `$lookup` allows them,
 * so checking `type` narrows `value`.
 *
 * ```ts
 * for (const property of lookupResult(answer).properties) {
 *   if (property.type === "Coding") console.log(property.code, property.value.code);
 * }
 * ```
 */
export type Property = PropertyParts &
  (
    | { type: "code" | "string" | "dateTime"; value: string }
    | { type: "integer" | "decimal"; value: number }
    | { type: "boolean"; value: boolean }
    | { type: "Coding"; value: Coding }
  );

/** What {@link lookupResult} reads from a `$lookup` answer. */
export interface LookupResult {
  /** The code system's name, such as `ICD-10-CM`. */
  name: string | undefined;
  /** The code. */
  code: string | undefined;
  /** The code system. */
  system: string | undefined;
  /** The code system's version the answer is from. */
  version: string | undefined;
  /** The code's display. */
  display: string | undefined;
  /** Whether the code is abstract, not for use, such as an ICD-10-CM header. */
  abstract: boolean | undefined;
  /**
   * What the answer warns of: for a code system haau3 holds, that another language was asked for
   * and the answer is in English.
   */
  warning: string | undefined;
  /** Every designation, in answer order. {@link designations} finds one by use and language. */
  designations: Designation[];
  /** Every property, in answer order. */
  properties: Property[];
  /** The answer's parts this reader does not read, verbatim. */
  other: ParametersParameter[];
}

/** What {@link validationResult} reads from a `$validate-code` answer. */
export interface ValidationResult {
  /** Whether the code is valid, with the display when one was sent. */
  result: boolean | undefined;
  /** The code's display, given even when a display sent did not match it. */
  display: string | undefined;
  /** What the server says about the answer, in its words. */
  message: string | undefined;
  /** The answer's parts this reader does not read, verbatim. */
  other: ParametersParameter[];
}

/** Which designations {@link designations} finds. A field left out matches every designation. */
export interface DesignationFilter {
  /** A use, matched by its system and code together. */
  use?: DesignationUse | undefined;
  /** A language range, matched as RFC 4647's basic filtering does: `en` matches `en` and `en-US`. */
  language?: string | undefined;
}

// The `value[x]` a part can hold its text in.
const STRING_VALUES = ["valueString", "valueCode", "valueUri", "valueCanonical"] as const;

// The `value[x]` a property's value can be, and its FHIR data type.
const PROPERTY_VALUES = {
  valueCode: "code",
  valueCoding: "Coding",
  valueString: "string",
  valueInteger: "integer",
  valueBoolean: "boolean",
  valueDateTime: "dateTime",
  valueDecimal: "decimal",
} as const;

type ValueKey = keyof ParametersParameter & `value${string}`;

// The value[x] keys a part carries, ignoring a key whose value is absent.
const valueKeys = (part: ParametersParameter): ValueKey[] =>
  (Object.keys(part) as Array<keyof ParametersParameter>).filter(
    (key): key is ValueKey => key.startsWith("value") && part[key] !== undefined && part[key] !== null,
  );

const textOf = (part: ParametersParameter): string | undefined => {
  const keys = valueKeys(part);
  const key = keys.length === 1 ? STRING_VALUES.find((name) => name === keys[0]) : undefined;
  const value = key === undefined ? undefined : part[key];
  return typeof value === "string" ? value : undefined;
};

const booleanOf = (part: ParametersParameter): boolean | undefined =>
  valueKeys(part).length === 1 && typeof part.valueBoolean === "boolean" ? part.valueBoolean : undefined;

type Readers = Record<string, (part: ParametersParameter) => unknown>;
type ReadValues<R extends Readers> = { [K in keyof R]: Exclude<ReturnType<R[K]>, undefined> | undefined };

/**
 * One level's parts, in order: each part named by `readers` is read by its reader, and `each` takes
 * the repeating parts it knows. A part neither reads goes to `other`, in place. Two parts with the
 * name of one FHIR allows once are ambiguous, and throw.
 */
function readParts<R extends Readers>(
  where: string,
  parts: readonly ParametersParameter[] | undefined,
  readers: R,
  each: (part: ParametersParameter) => boolean = () => false,
): { values: ReadValues<R>; other: ParametersParameter[] } {
  const counts = new Map<string, number>();
  for (const part of parts ?? []) {
    if (part.name !== undefined && Object.hasOwn(readers, part.name)) counts.set(part.name, (counts.get(part.name) ?? 0) + 1);
  }
  for (const [name, count] of counts) {
    if (count > 1) {
      const hint = where === "The Parameters" ? " Read them with parameters()." : "";
      throw new Haau3Error(`${where} holds ${count} parts named ${name}, so which one is meant is ambiguous.${hint}`);
    }
  }
  const values: Record<string, unknown> = {};
  const other: ParametersParameter[] = [];
  for (const part of parts ?? []) {
    if (part.name !== undefined && Object.hasOwn(readers, part.name)) {
      const value = readers[part.name]!(part);
      if (value === undefined) other.push(part);
      else values[part.name] = value;
    } else if (!each(part)) {
      other.push(part);
    }
  }
  return { values: values as ReadValues<R>, other };
}

function readUse(part: ParametersParameter): DesignationUse | undefined {
  const coding = valueKeys(part).length === 1 ? part.valueCoding : undefined;
  if (typeof coding?.system !== "string" || typeof coding.code !== "string") return undefined;
  return { system: coding.system, code: coding.code, display: coding.display };
}

function readDesignation(part: ParametersParameter): Designation | undefined {
  const { values, other } = readParts("A designation", part.part, { language: textOf, use: readUse, value: textOf });
  if (values.value === undefined) return undefined;
  return { language: values.language, use: values.use, value: values.value, other };
}

function readPropertyValue(part: ParametersParameter): Pick<Property, "type" | "value"> | undefined {
  const keys = valueKeys(part);
  const key = keys.length === 1 ? keys[0]! : undefined;
  if (key === undefined || !Object.hasOwn(PROPERTY_VALUES, key)) return undefined;
  return { type: PROPERTY_VALUES[key as keyof typeof PROPERTY_VALUES], value: part[key] } as Pick<Property, "type" | "value">;
}

function readProperty(part: ParametersParameter, where = "A property"): Property | undefined {
  const subproperties: Property[] = [];
  const { values, other } = readParts(where, part.part, { code: textOf, value: readPropertyValue, description: textOf }, (sub) => {
    const read = sub.name === "subproperty" ? readProperty(sub, "A subproperty") : undefined;
    if (read !== undefined) subproperties.push(read);
    return read !== undefined;
  });
  if (values.code === undefined || values.value === undefined) return undefined;
  return { code: values.code, ...values.value, description: values.description, subproperties, other } as Property;
}

/**
 * A `CodeSystem/$lookup` answer, typed, with no request: the code, its system and version, its
 * display, whether it is abstract, every designation and every property. A part this reader does
 * not know stays in `other`. Throws a {@link Haau3Error} when a part FHIR allows once comes twice.
 *
 * ```ts
 * const answer = await haau3.codeSystemLookup({ system: "http://hl7.org/fhir/sid/icd-10-cm", code: "E08.37X1" });
 * const lookup = lookupResult(answer);
 * console.log(lookup.display, designations(lookup, { use: SYNONYM_USE })[0]?.value);
 * ```
 */
export function lookupResult(answer: Parameters): LookupResult {
  const designationList: Designation[] = [];
  const properties: Property[] = [];
  const { values, other } = readParts(
    "The Parameters",
    answer.parameter,
    { name: textOf, code: textOf, system: textOf, version: textOf, display: textOf, abstract: booleanOf, warning: textOf },
    (part) => {
      if (part.name === "designation") {
        const designation = readDesignation(part);
        if (designation !== undefined) designationList.push(designation);
        return designation !== undefined;
      }
      if (part.name === "property") {
        const property = readProperty(part);
        if (property !== undefined) properties.push(property);
        return property !== undefined;
      }
      return false;
    },
  );
  return {
    name: values.name,
    code: values.code,
    system: values.system,
    version: values.version,
    display: values.display,
    abstract: values.abstract,
    warning: values.warning,
    designations: designationList,
    properties,
    other,
  };
}

/**
 * A `$validate-code` answer, from a code system or a value set, typed, with no request: whether the
 * code is valid, its display, and the server's message. A display that did not match answers
 * `result: false` with the code's display beside it. Throws a {@link Haau3Error} when a part FHIR
 * allows once comes twice.
 *
 * ```ts
 * const answer = await haau3.valueSetValidateCode({ url: "http://hl7.org/fhir/ValueSet/observation-vitalsignresult", system: "http://loinc.org", code: "8867-4" });
 * const { result, message } = validationResult(answer);
 * ```
 */
export function validationResult(answer: Parameters): ValidationResult {
  const { values, other } = readParts("The Parameters", answer.parameter, { result: booleanOf, display: textOf, message: textOf });
  return { result: values.result, display: values.display, message: values.message, other };
}

// RFC 4647's basic filtering: a range matches a tag equal to it, or one that starts with it and a
// hyphen, ignoring case; `*` matches every tag.
const languageMatches = (tag: string, range: string): boolean => {
  const t = tag.toLowerCase();
  const r = range.toLowerCase();
  return r === "*" || t === r || t.startsWith(`${r}-`);
};

/**
 * The designations of a lookup with a use and in a language, in answer order, with no request. A
 * use matches by its system and code together. A language matches as RFC 4647's basic filtering
 * says, so `en` finds `en` and `en-US`. A field left out matches every designation; a designation
 * that names no use, or no language, is found only when that field is left out.
 *
 * ```ts
 * const shortTitle = designations(lookupResult(answer), { use: SYNONYM_USE, language: "en" })[0]?.value;
 * ```
 */
export function designations(lookup: LookupResult, filter: DesignationFilter = {}): Designation[] {
  const { use, language } = filter;
  return lookup.designations.filter(
    (designation) =>
      (use === undefined || (designation.use?.system === use.system && designation.use.code === use.code)) &&
      (language === undefined || (designation.language !== undefined && languageMatches(designation.language, language))),
  );
}
