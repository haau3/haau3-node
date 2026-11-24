// The first call's parameters (scripts/generate.ts): the slot search's example, less its includes,
// which searchSlotWithIncludes sends itself. The example must send exactly those includes, or the
// call the sample makes would not be the example, which is the request the Sandbox answers with no
// key, so any other set is refused here rather than written into a sample that fails there.
import { SLOT_INCLUDES } from "../src/views.js";

/** A parameter's values as a sorted list, so one value and a list of one compare equal. */
const valuesOf = (value: unknown): string[] => (value === undefined ? [] : [value].flat().map(String).sort());

export function firstCallParams(operationId: string, example: unknown): Record<string, unknown> {
  if (example === null || typeof example !== "object" || Array.isArray(example)) {
    throw new Error(`${operationId}: the first call's example sends no query parameters.`);
  }
  const { _include: include, "_include:iterate": iterate, ...rest } = example as Record<string, unknown>;
  for (const [name, sent, wanted] of [
    ["_include", include, SLOT_INCLUDES._include],
    ["_include:iterate", iterate, SLOT_INCLUDES["_include:iterate"]],
  ] as const) {
    if (JSON.stringify(valuesOf(sent)) !== JSON.stringify(valuesOf(wanted))) {
      throw new Error(`${operationId}: the example's ${name} is not what searchSlotWithIncludes sends, so the first call would not be the example.`);
    }
  }
  return rest;
}
