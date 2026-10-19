import type { Bundle, BundleEntry } from "fhir/r4.js";
import type { ResponseMeta } from "./api-promise.js";
import { Haau3Error, NoAnswerError, type RefusedError } from "./errors.js";
import { appendQuery, judge, type QueryValue } from "./transport.js";

declare const answerType: unique symbol;

/**
 * One operation, ready to go in a batch. Made by the builder {@link Haau3.batch} hands you, and
 * sent only as part of that batch. `T` is what the operation answers with.
 */
export interface BatchEntry<T> {
  readonly method: "GET" | "POST";
  /** Where the entry goes, relative to the FHIR base, as the batch sends it. */
  readonly url: string;
  /** Carries the answer's type. Never set. */
  readonly [answerType]?: T;
}

/** One entry's outcome: its answer, or the error a single call would have thrown. */
export type BatchResult<T> = { ok: true; data: T; status: number } | { ok: false; error: RefusedError | NoAnswerError };

/** One {@link BatchResult} per entry, in the order the entries were given. */
export type BatchResults<E extends readonly BatchEntry<unknown>[]> = {
  -readonly [K in keyof E]: BatchResult<E[K] extends BatchEntry<infer T> ? T : never>;
};

/** What a generated builder method passes to {@link entry}. */
export interface EntryCall {
  method: "GET" | "POST";
  /** The operation's path in the spec, such as `/v1/fhir/r4/Practitioner/{id}`. */
  path: string;
  pathParams?: Record<string, string>;
  query?: object;
  body?: unknown;
  /** The FHIR resource types the operation answers with. */
  expects?: readonly string[];
}

const FHIR_BASE = "/v1/fhir/r4/";

/** What the batch needs from each entry it sends, kept off the entry itself. */
const made = new WeakMap<object, { label: string; resource: unknown; expects: readonly string[] | undefined }>();

/** An entry for one operation. Called by the generated builder. */
export function entry<T>(call: EntryCall): BatchEntry<T> {
  let path = call.path;
  for (const [name, value] of Object.entries(call.pathParams ?? {})) {
    path = path.replace(`{${name}}`, encodeURIComponent(value));
  }
  // The same query a direct call sends, relative to the base as a batch entry's url is.
  const search = new URLSearchParams();
  appendQuery(search, call.query as Record<string, QueryValue> | undefined);
  const relative = path.slice(FHIR_BASE.length);
  const query = search.toString();
  const url = query ? `${relative}?${query}` : relative;
  const value = Object.freeze({ method: call.method, url });
  made.set(value, { label: `${call.method} ${call.path}`, resource: call.body, expects: call.expects });
  return value as BatchEntry<T>;
}

/** The batch Bundle for these entries. Throws for anything the builder did not make. */
export function batchBundle(entries: readonly BatchEntry<unknown>[]): Bundle {
  if (!Array.isArray(entries)) {
    throw new Haau3Error("batch() takes a function that returns a list of entries made by the builder it is given.");
  }
  return {
    resourceType: "Bundle",
    type: "batch",
    entry: entries.map((value, index) => {
      const internal = typeof value === "object" && value !== null ? made.get(value) : undefined;
      if (!internal) {
        throw new Haau3Error(`Entry ${index + 1} of the batch was not made by the builder batch() hands you.`);
      }
      return {
        request: { method: value.method, url: value.url },
        ...(internal.resource !== undefined ? { resource: internal.resource as BundleEntry["resource"] } : {}),
      };
    }),
  };
}

/** A batch entry's status: "200", or "200 OK" with its reason phrase, as FHIR allows. */
function entryStatus(entry: BundleEntry | undefined): number | undefined {
  const match = /^(\d{3})(?:\s|$)/.exec(entry?.response?.status ?? "");
  return match ? Number(match[1]) : undefined;
}

/**
 * Reads a batch-response into one result per entry sent. FHIR R4 says a batch-response holds one
 * entry for each entry of the request, in the same order, so each answer is paired with its request
 * by position. An answer that is not a batch-response, or holds another number of entries, cannot be
 * paired at all and is no answer.
 */
export function readBatch(entries: readonly BatchEntry<unknown>[], answer: Bundle, meta: ResponseMeta): BatchResult<unknown>[] {
  const { requestId, correlationId, attempts, durationMs, status } = meta;
  const timing = { attempts, durationMs, correlationId };
  const answered = answer.entry ?? [];
  if (answer.type !== "batch-response") {
    throw new NoAnswerError(`POST /v1/fhir/r4 answered a Bundle that is not a batch-response.`, {
      reason: "unreadable",
      status,
      requestId,
      ...timing,
    });
  }
  if (answered.length !== entries.length) {
    throw new NoAnswerError(`POST /v1/fhir/r4 answered ${answered.length} entries for a batch of ${entries.length}.`, {
      reason: "unreadable",
      status,
      requestId,
      ...timing,
    });
  }
  return entries.map((value, index) => {
    const internal = made.get(value)!;
    const name = `${internal.label} (entry ${index + 1} of ${entries.length})`;
    const answeredEntry = answered[index];
    const entryCode = entryStatus(answeredEntry);
    if (entryCode === undefined) {
      return {
        ok: false,
        error: new NoAnswerError(`${name} answered with no status.`, { reason: "unreadable", requestId, ...timing }),
      };
    }
    // A failed entry's OperationOutcome is its resource, or, as FHIR also allows, its response's outcome.
    const body = answeredEntry?.resource ?? (entryCode >= 400 ? answeredEntry?.response?.outcome : undefined);
    const verdict = judge(name, entryCode, body, {
      requestId,
      correlationId,
      attempts,
      durationMs,
      expects: internal.expects,
      missing: "no resource",
      entry: true,
    });
    return verdict.ok
      ? { ok: true, data: verdict.data, status: entryCode }
      : { ok: false, error: verdict.error as RefusedError | NoAnswerError };
  });
}
