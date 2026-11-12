// What a method says when the spec marks its operation deprecated: OpenAPI's own `deprecated: true`,
// and the passage of the operation's description from "Deprecated:" to its end, which names what to
// call instead by its operationId in backticks. The method's doc comment carries the passage under
// `@deprecated`, and the description without it, so an editor strikes the method through and shows
// what to use. The spec defines the field only as `true` (or `false`), and every deprecated
// operation's description names a replacement that exists and is not itself deprecated, so anything
// else stops the generator rather than being guessed at.

type Json = Record<string, any>;

const MARK = "Deprecated:";

/** What a deprecated operation says: the description without its passage, and the passage. */
export interface Deprecation {
  description: string;
  words: string;
}

/**
 * What a deprecated operation's method carries, or nothing when the operation is not deprecated.
 * `ids` is every operationId in the spec, and `deprecated` the ones it marks deprecated; the
 * replacement must be one of the first and none of the second.
 */
export function deprecation(operation: Json, ids: ReadonlySet<string>, deprecated: ReadonlySet<string>): Deprecation | undefined {
  const id = operation.operationId as string;
  if (!("deprecated" in operation) || operation.deprecated === false) return undefined;
  const mark: unknown = operation.deprecated;
  if (mark !== true) throw new Error(`${id} carries deprecated: ${JSON.stringify(mark)}, where the spec defines only true or false.`);
  const description = typeof operation.description === "string" ? operation.description : "";
  const parts = description.split(MARK);
  if (parts.length !== 2) {
    throw new Error(`${id} is deprecated, and its description needs exactly one passage from "${MARK}" naming what to call instead.`);
  }
  const words = parts[1]!.trim().replace(/\s+/g, " ");
  const named = [...words.matchAll(/`([A-Za-z][A-Za-z0-9]*)`/g)]
    .map((match) => match[1]!)
    .filter((word) => ids.has(word) && word !== id && !deprecated.has(word));
  if (named.length === 0) {
    throw new Error(`${id} is deprecated, and its "${MARK}" passage names no operation of the spec to call instead that is not deprecated.`);
  }
  return { description: parts[0]!.trimEnd(), words: words.charAt(0).toUpperCase() + words.slice(1) };
}
