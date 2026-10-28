import type * as fhir4 from "fhir/r4.js";

/**
 * A resource a request carries: one of @types/fhir's resources, checked as the type its
 * `resourceType` names, or any other resource as it is. So a record written inline gets its own
 * type's fields, and a typo in one is an error, while a resource typed by any FHIR client passes
 * with no cast.
 */
export type RequestResource = RequestBundle | RequestParameters | fhir4.FhirResource | fhir4.Resource;

/** A Bundle entry in a request, its resource a {@link RequestResource}. */
export interface RequestBundleEntry extends Omit<fhir4.BundleEntry, "resource"> {
  resource?: RequestResource;
}

/**
 * A Bundle a request carries, such as a pharmacy benefit check's message or MedList's records:
 * @types/fhir's `Bundle`, with each entry's resource a {@link RequestResource}. A `fhir4.Bundle`
 * passes as it is.
 */
export interface RequestBundle extends Omit<fhir4.Bundle, "entry"> {
  entry?: RequestBundleEntry[];
}

/** A Parameters parameter in a request, its resource and its parts' resources each a {@link RequestResource}. */
export interface RequestParameter extends Omit<fhir4.ParametersParameter, "resource" | "part"> {
  resource?: RequestResource;
  part?: RequestParameter[];
}

/**
 * A Parameters a request carries, such as MedList's: @types/fhir's `Parameters`, with each resource
 * part, at any depth, a {@link RequestResource}. A `fhir4.Parameters` passes as it is.
 */
export interface RequestParameters extends Omit<fhir4.Parameters, "parameter"> {
  parameter?: RequestParameter[];
}
