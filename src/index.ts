export { Haau3 } from "./client.js";
export { APIPromise, type ResponseMeta, type WithResponse } from "./api-promise.js";
export { AuthError, ForbiddenError, Haau3Error, NoAnswerError, RefusedError, type Haau3ErrorJSON, type NoAnswerReason } from "./errors.js";
export { markAsTestData } from "./testData.js";
export type { ClientOptions, FetchOptions, QueryValue, RawRequest, RawResponse, RequestOptions } from "./transport.js";
export type { BodyOf, HeaderOf, OperationId, QueryOf, ResponseOf } from "./operations.js";
export type { RequestBundle, RequestBundleEntry, RequestParameter, RequestParameters, RequestResource } from "./request.js";
export type { BatchEntry, BatchResult, BatchResults } from "./batch.js";
export type { ResolveOptions, ResourceOf, ResourceType } from "./bundles.js";
export type { DosageReview, ReviewFlag } from "./parameters.js";
export type { BatchBuilder } from "./generated/batch.js";
export type * from "./generated/types.js";
export { VERSION } from "./version.js";
/** @types/fhir's R4 types, as `fhir4.InsurancePlan` and so on, which every FHIR answer is typed with. */
export type * as fhir4 from "fhir/r4.js";
