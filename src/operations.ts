import type { operations } from "./generated/openapi.js";

/** Every operation's id, as the spec names it. Each one is a method on {@link Haau3}. */
export type OperationId = keyof operations;

type ParametersOf<Op extends OperationId> = operations[Op]["parameters"];

/** An operation's query parameters. */
export type QueryOf<Op extends OperationId> =
  ParametersOf<Op> extends { query?: infer Query } ? NonNullable<Query> : never;

/** An operation's request body. */
export type BodyOf<Op extends OperationId> = operations[Op] extends {
  requestBody: { content: infer Content };
}
  ? Content[keyof Content]
  : never;

/** What an operation answers when it succeeds. */
export type ResponseOf<Op extends OperationId> = operations[Op]["responses"] extends {
  200: { content: infer Content };
}
  ? Content[keyof Content]
  : never;
