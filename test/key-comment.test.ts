// Which key a code sample's client line says it reads (scripts/key-comment.ts): from the operation's
// security, or the document's when it has none of its own.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { keyComment } from "../scripts/key-comment.js";
import { spec } from "./helpers.js";

const document = { security: [{ bearerAuth: [] }] };

describe("a sample's key comment", () => {
  it("reads a live key for an operation that takes the document's security", () => {
    expect(keyComment(document, { operationId: "searchSlots" })).toBe("reads HAAU3_API_KEY");
  });

  it("reads a test key for an operation that names testKeyAuth", () => {
    const sandbox = { operationId: "sandboxProcessMessage", security: [{ testKeyAuth: [] }] };
    expect(keyComment(document, sandbox)).toBe("reads HAAU3_API_KEY, a test key");
  });

  it("stops on a scheme it has no words for, on no key, and on more than one", () => {
    const refused = [[{ apiKeyAuth: [] }], [], [{ bearerAuth: [] }, { testKeyAuth: [] }], [{ bearerAuth: [], testKeyAuth: [] }]];
    for (const security of refused) {
      expect(() => keyComment(document, { operationId: "someOperation", security }), JSON.stringify(security)).toThrow(
        /^someOperation: security .* names no key a sample knows\.$/,
      );
    }
    expect(() => keyComment({}, { operationId: "someOperation" })).toThrow(/^someOperation: security undefined/);
  });

  it("is what every committed sample says", () => {
    const overlay = JSON.parse(readFileSync(new URL("../openapi/code-samples.json", import.meta.url), "utf8")) as {
      actions: { target: string; update: { "x-codeSamples": { source: string }[] } }[];
    };
    const operations = Object.entries(spec.paths).flatMap(([path, item]) =>
      ["get", "post"].filter((method) => item[method]).map((method) => [`$.paths['${path}'].${method}`, item[method]] as const),
    );
    expect(overlay.actions).toHaveLength(operations.length);
    for (const [target, operation] of operations) {
      const source = overlay.actions.find((action) => action.target === target)!.update["x-codeSamples"][0]!.source;
      expect(source, target).toContain(`const haau3 = new Haau3(); // ${keyComment(spec, operation)}\n`);
    }
  });
});
