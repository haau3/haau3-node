import type { Dosage, Extension, Parameters, ParametersParameter } from "fhir/r4.js";
import { Haau3Error } from "./errors.js";

// The extensions Structured Sig writes on each Dosage it answers with, as its implementation guide at
// https://fhir.haau3.com names them.
const PROFILE_BASE = "https://haau3.com/fhir/StructureDefinition";
const REVIEW_FLAG = `${PROFILE_BASE}/structured-sig-review-flag`;
const ENGINE_VERSION = `${PROFILE_BASE}/structured-sig-engine-version`;
const VOCABULARY_VERSION = `${PROFILE_BASE}/structured-sig-vocabulary-version`;
const RXNORM_RELEASE = `${PROFILE_BASE}/structured-sig-rxnorm-release`;

/** One thing a person should check about a Dosage, as {@link Haau3.reviewFlags} reads it. */
export interface ReviewFlag {
  /** The flag's code, from `https://haau3.com/fhir/CodeSystem/structured-sig-review-flag`. */
  code: string;
  /** The flag's display, such as "Route and dose form differ". */
  display: string | undefined;
  /** The words of the directions the flag is about, exactly as written, when it is about words. */
  words: string | undefined;
}

/** What {@link Haau3.reviewFlags} reads from a Dosage. */
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

export function partsNamed(answer: Parameters, name: string): ParametersParameter[] {
  return (answer.parameter ?? []).filter((part) => part.name === name);
}

export function onePartNamed(answer: Parameters, name: string): ParametersParameter | undefined {
  const found = partsNamed(answer, name);
  if (found.length > 1) {
    throw new Haau3Error(`The Parameters holds ${found.length} parts named ${name}, so which one is meant is ambiguous. Read them with parameters().`);
  }
  return found[0];
}

const valueOf = (extensions: readonly Extension[] | undefined, url: string): string | undefined =>
  extensions?.find((extension) => extension.url === url)?.valueString;

export function reviewOf(dosage: Dosage): DosageReview {
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
