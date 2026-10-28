import type { Bundle, Parameters } from "fhir/r4.js";
import type { operations } from "./generated/openapi.js";
import type { RequestBundle, RequestParameters } from "./request.js";

/** Every operation's id, as the spec names it. Each one is a method on {@link Haau3}. */
export type OperationId = keyof operations;

type ParametersOf<Op extends OperationId> = operations[Op]["parameters"];

/** An operation's query parameters. */
export type QueryOf<Op extends OperationId> =
  ParametersOf<Op> extends { query?: infer Query } ? NonNullable<Query> : never;

/** An operation's header parameters. */
export type HeaderOf<Op extends OperationId> =
  ParametersOf<Op> extends { header?: infer Header } ? NonNullable<Header> : never;

/**
 * A body as a request carries it: a Bundle or a Parameters as the request types in request.ts, so
 * each resource in it is checked as the type its `resourceType` names, and anything else as the spec
 * gives it.
 */
type AsRequest<Body> = Body extends Bundle ? RequestBundle : Body extends Parameters ? RequestParameters : Body;

/**
 * An operation's request body. A FHIR Bundle or Parameters takes a record written inline, checked as
 * its own type, and any `fhir4.Bundle` or `fhir4.Parameters` as it is.
 */
export type BodyOf<Op extends OperationId> = operations[Op] extends {
  requestBody: { content: infer Content };
}
  ? AsRequest<Content[keyof Content]>
  : never;

/** What an operation answers when it succeeds. */
export type ResponseOf<Op extends OperationId> = operations[Op]["responses"] extends {
  200: { content: infer Content };
}
  ? Content[keyof Content]
  : never;
