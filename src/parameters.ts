import type { CodeableConcept, Dosage, Extension, Parameters, ParametersParameter } from "fhir/r4.js";
import { Haau3Error } from "./errors.js";

// Plain functions, with no client: they send nothing and need no key, so they read a stored answer
// and build a request wherever the code runs, a browser included. The client's methods of the same
// names call them.

// The extensions Structured Sig writes on each Dosage it answers with, as its implementation guide at
// https://fhir.haau3.com names them.
const PROFILE_BASE = "https://haau3.com/fhir/StructureDefinition";
const REVIEW_FLAG = `${PROFILE_BASE}/structured-sig-review-flag`;
const ENGINE_VERSION = `${PROFILE_BASE}/structured-sig-engine-version`;
const VOCABULARY_VERSION = `${PROFILE_BASE}/structured-sig-vocabulary-version`;
const RXNORM_RELEASE = `${PROFILE_BASE}/structured-sig-rxnorm-release`;

/** RxNorm's code system, for a medication's coding. */
export const RXNORM_SYSTEM = "http://www.nlm.nih.gov/research/umls/rxnorm";

/** The NDC's code system, for a medication's coding. */
export const NDC_SYSTEM = "http://hl7.org/fhir/sid/ndc";

/** One thing a person should check about a Dosage, as {@link reviewFlags} reads it. */
export interface ReviewFlag {
  /** The flag's code, from `https://haau3.com/fhir/CodeSystem/structured-sig-review-flag`. */
  code: string;
  /** The flag's display, such as "Route and dose form differ". */
  display: string | undefined;
  /** The words of the directions the flag is about, exactly as written, when it is about words. */
  words: string | undefined;
}

/** What {@link reviewFlags} reads from a Dosage. */
export interface DosageReview {
  /** Every flag on the Dosage, in the order the answer gives them. Empty when nothing needs checking. */
  flags: ReviewFlag[];
  /** How the directions were read, in the form `YYYY-MM-DD.vN`. */
  engineVersion: string | undefined;
  /** The codes the directions were coded with, in the form `YYYY-MM-DD.vN`. */
  vocabularyVersion: string | undefined;
  /** The RxNorm release the medication's code was looked up in, when it carried one. */
  rxnormRelease: string | undefined;
}

/** What {@link structureDosageRequest} builds a `$structure-dosage` request from. */
export interface StructureDosageInput {
  /** A prescription's directions, exactly as written. At most 1,000 characters. */
  text: string;
  /**
   * The medication's codings, RxNorm or NDC, when known: with an RxNorm code, the product's dose form
   * checks the dose's unit and the route, and supplies either when the directions name none.
   */
  medication?: CodeableConcept;
}

/**
 * The Parameters `$structure-dosage` takes, from the directions and, optionally, the medication: a
 * `text` part and a `medication` part when there is one. It checks nothing; the API refuses what it
 * does not accept, with its reason.
 *
 * ```ts
 * const answer = await haau3.structureDosage(
 *   structureDosageRequest({
 *     text: "Instill 2 drops in the affected ear twice daily",
 *     medication: { coding: [{ system: RXNORM_SYSTEM, code: "1923428" }] },
 *   }),
 * );
 * ```
 */
export function structureDosageRequest(input: StructureDosageInput): Parameters {
  const parameter: ParametersParameter[] = [{ name: "text", valueString: input.text }];
  if (input.medication !== undefined) parameter.push({ name: "medication", valueCodeableConcept: input.medication });
  return { resourceType: "Parameters", parameter };
}

/**
 * Every part of a Parameters answer with that name, in order: the way FHIR operations answer,
 * `$lookup`'s `property` parts or `$structure-dosage`'s `dosage` part. Each part holds its value in
 * the `value[x]` its operation names, so read `valueDosage`, `valueString` and so on from it. Empty
 * when there is none.
 *
 * ```ts
 * const answer = await haau3.codeSystemLookup({ system: "http://loinc.org", code: "2345-7", property: ["COMPONENT"] });
 * for (const property of parameters(answer, "property")) console.log(property.part);
 * ```
 */
export function parameters(answer: Parameters, name: string): ParametersParameter[] {
  return (answer.parameter ?? []).filter((part) => part.name === name);
}

/**
 * The one part of a Parameters answer with that name, or undefined when there is none. Throws a
 * {@link Haau3Error} when there are two, since which one is meant is then ambiguous; {@link parameters}
 * reads a name that repeats.
 *
 * ```ts
 * const answer = await haau3.codeSystemLookup({ system: "http://loinc.org", code: "2345-7" });
 * console.log(parameter(answer, "display")?.valueString);
 * ```
 */
export function parameter(answer: Parameters, name: string): ParametersParameter | undefined {
  const found = parameters(answer, name);
  if (found.length > 1) {
    throw new Haau3Error(`The Parameters holds ${found.length} parts named ${name}, so which one is meant is ambiguous. Read them with parameters().`);
  }
  return found[0];
}

const valueOf = (extensions: readonly Extension[] | undefined, url: string): string | undefined =>
  extensions?.find((extension) => extension.url === url)?.valueString;

/**
 * The review flags on a Dosage that `$structure-dosage` answered with, and the versions it names.
 * Each flag is something a person should check: its code, its display, and the words of the
 * directions it is about, when it is about words. The versions say how the directions were read and
 * coded, and which RxNorm release the medication was looked up in.
 *
 * ```ts
 * const answer = await haau3.structureDosage(structureDosageRequest({ text: "Take 1 tablet by mouth twice daily" }));
 * const dosage = parameter(answer, "dosage")?.valueDosage;
 * if (dosage) for (const flag of reviewFlags(dosage).flags) console.log(flag.code, flag.words);
 * ```
 */
export function reviewFlags(dosage: Dosage): DosageReview {
  const flags: ReviewFlag[] = [];
  for (const extension of dosage.extension ?? []) {
    if (extension.url !== REVIEW_FLAG) continue;
    const coding = extension.extension?.find((part) => part.url === "code")?.valueCoding;
    // A flag is its code; one without a code says nothing a caller could act on.
    if (coding?.code === undefined) continue;
    flags.push({ code: coding.code, display: coding.display, words: valueOf(extension.extension, "words") });
  }
  return {
    flags,
    engineVersion: valueOf(dosage.extension, ENGINE_VERSION),
    vocabularyVersion: valueOf(dosage.extension, VOCABULARY_VERSION),
    rxnormRelease: valueOf(dosage.extension, RXNORM_RELEASE),
  };
}
