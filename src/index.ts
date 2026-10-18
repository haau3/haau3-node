export { Haau3 } from "./client.js";
export { AuthError, Haau3Error, NoAnswerError, RefusedError, type NoAnswerReason } from "./errors.js";
export type { ClientOptions, QueryValue, RawRequest, RawResponse, RequestOptions } from "./transport.js";
export type { OperationId } from "./operations.js";
export type * from "./generated/types.js";
export { VERSION } from "./version.js";
/** @types/fhir's R4 types, as `fhir4.InsurancePlan` and so on, which every FHIR answer is typed with. */
export type * as fhir4 from "fhir/r4.js";
