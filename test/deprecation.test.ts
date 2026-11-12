// What a method says when the spec marks its operation deprecated (scripts/deprecation.ts): the
// description's passage from "Deprecated:", which names what to call instead.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deprecation } from "../scripts/deprecation.js";
import { spec } from "./helpers.js";

const ids = new Set(["oldThing", "newThing", "otherOldThing"]);
const deprecated = new Set(["oldThing", "otherOldThing"]);
const operation = (fields: Record<string, unknown>) => ({ operationId: "oldThing", description: "Does a thing.", ...fields });

describe("a deprecated operation's words", () => {
  it("are nothing when the operation is not deprecated", () => {
    expect(deprecation(operation({}), ids, deprecated)).toBeUndefined();
    expect(deprecation(operation({ deprecated: false }), ids, deprecated)).toBeUndefined();
  });

  it("are the passage from Deprecated:, capitalised, on one line, and the description without it", () => {
    const found = deprecation(operation({ deprecated: true, description: "Does a thing. Deprecated: call `newThing`\ninstead." }), ids, deprecated);
    expect(found).toEqual({ description: "Does a thing.", words: "Call `newThing` instead." });
  });

  it("stop the generator on any other value, on no passage or two, and on a passage naming nothing to call instead", () => {
    for (const mark of ["yes", null, 1]) {
      expect(() => deprecation(operation({ deprecated: mark }), ids, deprecated), String(mark)).toThrow(
        /^oldThing carries deprecated: .*, where the spec defines only true or false\.$/,
      );
    }
    expect(() => deprecation(operation({ deprecated: true }), ids, deprecated)).toThrow(/needs exactly one passage/);
    expect(() => deprecation(operation({ deprecated: true, description: "Deprecated: a. Deprecated: `newThing`." }), ids, deprecated)).toThrow(
      /needs exactly one passage/,
    );
    // An operation the spec does not have, the operation itself, or another deprecated one is no replacement.
    for (const named of ["somethingElse", "oldThing", "otherOldThing"]) {
      expect(() => deprecation(operation({ deprecated: true, description: `Deprecated: call \`${named}\`.` }), ids, deprecated), named).toThrow(
        /names no operation of the spec to call instead that is not deprecated/,
      );
    }
  });

  it("are on every method the spec deprecates, after its description without the passage, and on no other", () => {
    const methods = readFileSync(new URL("../src/generated/methods.ts", import.meta.url), "utf8");
    const operations = Object.values(spec.paths).flatMap((item) => ["get", "post"].filter((m) => item[m]).map((m) => item[m]));
    const all = new Set(operations.map((op) => op.operationId as string));
    const marked = operations.filter((op) => op.deprecated === true);
    const markedIds = new Set(marked.map((op) => op.operationId as string));
    expect([...markedIds].sort()).toEqual(["sandboxMetadata", "sandboxProcessMessage"]);
    for (const op of marked) {
      const found = deprecation(op, all, markedIds)!;
      expect(methods).toContain(`   * @deprecated ${found.words}\n   */\n  ${op.operationId}(`);
    }
    expect(methods.match(/@deprecated/g)).toHaveLength(marked.length);
    expect(methods.match(/Deprecated:/g)).toBeNull();
  });
});
