// What a code sample says beside its client: which key HAAU3_API_KEY must hold for the operation,
// read from the operation's security in the spec. An operation without security of its own takes
// the document's, a live key (`bearerAuth`); the Sandbox's operations name `testKeyAuth`, a test key.
// Any other security, none (`[]`) included, stops the generator, so a new scheme gets its own words
// here instead of a sample that sends the wrong key.

type Json = Record<string, any>;

const COMMENT: Record<string, string> = {
  bearerAuth: "reads HAAU3_API_KEY",
  testKeyAuth: "reads HAAU3_API_KEY, a test key",
};

/** The comment for an operation's client line, from its security or else the document's. */
export function keyComment(spec: Json, operation: Json): string {
  const security = (operation.security ?? spec.security) as Json[] | undefined;
  const schemes = security?.length === 1 ? Object.keys(security[0]!) : [];
  const comment = schemes.length === 1 ? COMMENT[schemes[0]!] : undefined;
  if (comment === undefined) {
    throw new Error(`${operation.operationId}: security ${JSON.stringify(security)} names no key a sample knows.`);
  }
  return comment;
}
