import type { Coding, Resource } from "fhir/r4.js";

/** HL7's label for test data, as the API's examples carry it. */
const TEST_DATA_LABEL: Readonly<Coding> = {
  system: "http://terminology.hl7.org/CodeSystem/v3-ActReason",
  code: "HTEST",
  display: "test health data",
};

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * A copy of a request with HL7's test data label (`HTEST`, from `v3-ActReason`) in `meta.security`
 * on the request and on every resource the API reads in it: each Bundle entry, each Parameters
 * resource part at any depth, and the same again inside a Bundle or Parameters found there. A
 * resource contained in another goes with the one that contains it, so it is left as it is. Labels
 * already there are kept, and a resource that already carries the label gets no second one. The
 * request you pass is never changed.
 *
 * Without an agreement for patient data, the operations that receive it accept only test data
 * labelled as such, and refuse anything else with a `ForbiddenError` whose `code` is
 * `"phi-agreement-required"`.
 *
 * Label only made-up data. The label says a record is not about a real person, and it is never a way
 * to send patient data without an agreement.
 *
 * ```ts
 * const list = await haau3.reconcileMedications(markAsTestData(records));
 * ```
 */
export function markAsTestData<T extends Resource>(body: T): T {
  const copy = copyJson(body);
  // A stack rather than recursion, as the API's own check walks it.
  const stack: unknown[] = [copy];
  while (stack.length > 0) {
    const node = stack.pop();
    if (!isObject(node)) continue;
    label(node);
    if (node.resourceType === "Bundle" && Array.isArray(node.entry)) {
      for (const entry of node.entry) if (isObject(entry)) stack.push(entry.resource);
    } else if (node.resourceType === "Parameters" && Array.isArray(node.parameter)) {
      const parameters: unknown[] = [...node.parameter];
      while (parameters.length > 0) {
        const parameter = parameters.pop();
        if (!isObject(parameter)) continue;
        stack.push(parameter.resource);
        if (Array.isArray(parameter.part)) parameters.push(...parameter.part);
      }
    }
  }
  return copy;
}

const isPlain = (value: unknown): value is Json | unknown[] =>
  Array.isArray(value) ||
  (typeof value === "object" && value !== null && [Object.prototype, null].includes(Object.getPrototypeOf(value)));

/**
 * A copy of every plain object and array in a value, made with a stack: `structuredClone` and
 * recursion both run out of call stack at a depth `JSON.stringify` still sends (measured on Node 24:
 * 873 levels of nested Parameters against 2,058). Anything else, a `Date` say, is kept as it is, so
 * the copy serialises as the original would.
 */
function copyJson<T>(value: T): T {
  if (!isPlain(value)) return value;
  const root: Json | unknown[] = Array.isArray(value) ? [] : {};
  const stack: [Json | unknown[], Json | unknown[]][] = [[value, root]];
  while (stack.length > 0) {
    const [from, to] = stack.pop()!;
    for (const [key, child] of Object.entries(from)) {
      let made: unknown = child;
      if (isPlain(child)) {
        made = Array.isArray(child) ? [] : {};
        stack.push([child, made as Json | unknown[]]);
      }
      // Defined rather than assigned, so a key named `__proto__` is copied as a key.
      Object.defineProperty(to, key, { value: made, enumerable: true, writable: true, configurable: true });
    }
  }
  return root as T;
}

function label(resource: Json): void {
  const meta = isObject(resource.meta) ? resource.meta : (resource.meta = {});
  const security = Array.isArray(meta.security) ? meta.security : (meta.security = []);
  const labelled = security.some((coding) => isObject(coding) && coding.system === TEST_DATA_LABEL.system && coding.code === TEST_DATA_LABEL.code);
  if (!labelled) security.push({ ...TEST_DATA_LABEL });
}
