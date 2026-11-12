// What a method says when the spec marks its operation deprecated (scripts/deprecation.ts): the
// description's passage from "Deprecated:", which names what to call instead.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { deprecation } from "../scripts/deprecation.js";
import { spec } from "./helpers.js";

const ids = new Set(["oldThing", "newThing"]);
const operation = (fields: Record<string, unknown>) => ({ operationId: "oldThing", description: "Does a thing.", ...fields });

describe("a deprecated operation's words", () => {
  it("are nothing when the operation is not deprecated", () => {
    expect(deprecation(operation({}), ids)).toBeUndefined();
    expect(deprecation(operation({ deprecated: false }), ids)).toBeUndefined();
  });

  it("are the passage from Deprecated:, capitalised, on one line", () => {
    const words = deprecation(operation({ deprecated: true, description: "Does a thing. Deprecated: call `newThing`\ninstead." }), ids);
    expect(words).toBe("Call `newThing` instead.");
  });

  it("stop the generator on any other value, on no passage or two, and on a passage naming no operation", () => {
    expect(() => deprecation(operation({ deprecated: "yes" }), ids)).toThrow(/^oldThing carries deprecated: "yes", where the spec defines only true\.$/);
    expect(() => deprecation(operation({ deprecated: true }), ids)).toThrow(/needs exactly one passage/);
    expect(() => deprecation(operation({ deprecated: true, description: "Deprecated: a. Deprecated: `newThing`." }), ids)).toThrow(
      /needs exactly one passage/,
    );
    expect(() => deprecation(operation({ deprecated: true, description: "Deprecated: call `somethingElse`." }), ids)).toThrow(
      /names no operation of the spec/,
    );
  });

  it("are on every method the spec deprecates, and on no other", () => {
    const methods = readFileSync(new URL("../src/generated/methods.ts", import.meta.url), "utf8");
    const all = new Set(
      Object.values(spec.paths).flatMap((item) => ["get", "post"].filter((m) => item[m]).map((m) => item[m].operationId as string)),
    );
    const marked = Object.values(spec.paths).flatMap((item) =>
      ["get", "post"].filter((m) => item[m]?.deprecated === true).map((m) => item[m]),
    );
    expect(marked.length).toBeGreaterThan(0);
    for (const op of marked) {
      const words = deprecation(op, all)!;
      expect(methods).toContain(`   * @deprecated ${words}\n   */\n  ${op.operationId}(`);
    }
    expect(methods.match(/@deprecated/g)).toHaveLength(marked.length);
  });
});
