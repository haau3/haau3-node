// What a method says when the spec marks its operation deprecated: OpenAPI's own `deprecated: true`,
// and the passage of the operation's description from "Deprecated:" to its end, which names what to
// call instead by its operationId in backticks. The method's doc comment carries the passage under
// `@deprecated`, so an editor strikes the method through and shows what to use. The spec defines the
// field only as `true`, and every deprecated operation's description names a replacement that exists,
// so anything else stops the generator rather than being guessed at.

type Json = Record<string, any>;

const MARK = "Deprecated:";

/**
 * The words a deprecated operation's method carries, or nothing when the operation is not deprecated.
 * `ids` is every operationId in the spec; the replacement must be one of them.
 */
export function deprecation(operation: Json, ids: ReadonlySet<string>): string | undefined {
  const id = operation.operationId as string;
  const mark: unknown = operation.deprecated;
  if (mark === undefined || mark === false) return undefined;
  if (mark !== true) throw new Error(`${id} carries deprecated: ${JSON.stringify(mark)}, where the spec defines only true.`);
  const description = typeof operation.description === "string" ? operation.description : "";
  const parts = description.split(MARK);
  if (parts.length !== 2) {
    throw new Error(`${id} is deprecated, and its description needs exactly one passage from "${MARK}" naming what to call instead.`);
  }
  const words = parts[1]!.trim().replace(/\s+/g, " ");
  const passage = words.charAt(0).toUpperCase() + words.slice(1);
  const named = [...passage.matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g)].map((match) => match[1]!).filter((word) => ids.has(word));
  if (named.length === 0) {
    throw new Error(`${id} is deprecated, and its "${MARK}" passage names no operation of the spec to call instead.`);
  }
  return passage;
}
