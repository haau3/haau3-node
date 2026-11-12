import type { OperationOutcome } from "fhir/r4.js";
import type { Problem } from "./generated/types.js";

/**
 * Why a request got no answer:
 *
 * - `timeout`: an attempt ran past its timeout, or the API answered 504.
 * - `network`: the request never reached the API, or the connection failed.
 * - `rate-limited`: the API answered 429. `retryAfter` says when to try again.
 * - `unavailable`: the API, or a source it reads, could not answer (502, 503).
 * - `server-error`: the API failed (500).
 * - `unreadable`: the API answered with something that is not an answer: a body that is not JSON,
 *   or a FHIR resource of another type than the operation answers with.
 */
export type NoAnswerReason = "timeout" | "network" | "rate-limited" | "unavailable" | "server-error" | "unreadable";

/**
 * What {@link Haau3Error.toJSON} gives: the fields that are safe to log. Never a body the API
 * answered with, never the error's `cause`. A message names the request by its method and the
 * operation's path, never by a value you sent.
 */
export interface Haau3ErrorJSON {
  name: string;
  message: string;
  status?: number;
  statusText?: string;
  code?: string;
  reason?: NoAnswerReason;
  retryAfter?: number;
  attempts?: number;
  durationMs?: number;
  requestId?: string;
  correlationId?: string;
  detail?: string;
}

/** The fields {@link Haau3Error.toJSON} copies when they are set, in this order. */
const LOGGED = [
  "status",
  "statusText",
  "code",
  "reason",
  "retryAfter",
  "attempts",
  "durationMs",
  "requestId",
  "correlationId",
  "detail",
] as const;

/**
 * Why `new Haau3()` refused to make a client, before anything was sent: the `code` of the
 * {@link Haau3Error} it throws. Branch on the code; the message says the same for a person, and
 * names where the value came from (the option or the variable).
 *
 * - `no-api-key`: no key, and the Sandbox is not named as the environment. When an env file in the
 *   current folder (`.env.local` or `.env`) sets HAAU3_API_KEY but the program never loaded it, the
 *   message names that file and how to load it. Only the variable's name is looked for, never its value.
 * - `invalid-api-key`: the key is not a string.
 * - `api-key-not-alone`: the key has something before its `haau3_sk_` prefix, such as the quotes an
 *   env file kept, or `Bearer `.
 * - `test-key-outside-sandbox`: a test key with production named. The API's own name for it.
 * - `live-key-in-sandbox`: a live key with the Sandbox named, or with the Sandbox's address as the
 *   base URL. The API's own name for it.
 * - `older-key-in-sandbox`: the same for a key made before test and live keys.
 * - `invalid-environment`: an environment other than `"production"` or `"sandbox"`.
 * - `invalid-base-url`: a base URL that is not an http or https URL with a host and no query.
 * - `environment-conflicts-with-base-url`: a named environment, and a base URL on the other
 *   environment's own address.
 * - `invalid-app-info`: an `appInfo` the User-Agent cannot carry.
 * - `no-fetch`: no `fetch` in the runtime, and none passed.
 * - `in-browser`: the client was made in a browser, where an API key is public.
 */
export type ClientErrorCode =
  | "no-api-key"
  | "invalid-api-key"
  | "api-key-not-alone"
  | "test-key-outside-sandbox"
  | "live-key-in-sandbox"
  | "older-key-in-sandbox"
  | "invalid-environment"
  | "invalid-base-url"
  | "environment-conflicts-with-base-url"
  | "invalid-app-info"
  | "no-fetch"
  | "in-browser";

/** What every error this package throws has. */
export class Haau3Error extends Error {
  override name = "Haau3Error";
  /** The `X-Request-Id` the API sent, when it answered. Quote it when you ask for help. */
  declare readonly requestId: string | undefined;
  /** The `correlationId` you sent, as the API returned it in `X-Correlation-Id`, when it answered. */
  declare readonly correlationId: string | undefined;
  /**
   * Why, as a code to branch on, when there is one: a {@link ClientErrorCode} when the client could
   * not be made, or the API's own code on a {@link ForbiddenError} or a {@link RefusedError}.
   */
  declare readonly code: string | undefined;

  constructor(
    message: string,
    requestId?: string,
    options?: ErrorOptions & { correlationId?: string | undefined; code?: ClientErrorCode | undefined },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    // Set only when there is a value, so an error raised before anything was sent prints its message
    // alone, never a `requestId: undefined` that reads as if a request had failed.
    const fields = this as { requestId?: string; correlationId?: string; code?: string };
    if (requestId !== undefined) fields.requestId = requestId;
    if (options?.correlationId !== undefined) fields.correlationId = options.correlationId;
    if (options?.code !== undefined) fields.code = options.code;
  }

  /**
   * The error as a plain object that is safe to log: its name, its message and every field that is
   * set, and never the body the API answered with (`outcome`, `problem`) or the `cause`.
   * `JSON.stringify(error)` and loggers that call `toJSON` print this.
   *
   * ```ts
   * logger.warn({ error: error.toJSON() }, "the plan read failed");
   * ```
   */
  toJSON(): Haau3ErrorJSON {
    const json: Record<string, unknown> = { name: this.name, message: this.message };
    const fields = this as unknown as Record<string, unknown>;
    for (const key of LOGGED) if (fields[key] !== undefined) json[key] = fields[key];
    return json as unknown as Haau3ErrorJSON;
  }
}

/**
 * Attaches the body the API answered with, readable by code but never printed: the property is
 * not enumerable, so `console.log(error)`, `util.inspect` and `JSON.stringify` leave it out. A body
 * can repeat what the request carried, and for some operations that is a patient's data.
 */
function attachBody(error: Haau3Error, body: AnswerBody | undefined): void {
  if (!body) return;
  const key = body.kind === "outcome" ? "outcome" : "problem";
  Object.defineProperty(error, key, { value: body.value, enumerable: false, writable: false, configurable: false });
}

/** An error body as the SDK read it: an OperationOutcome under the FHIR base, a Problem elsewhere. */
export type AnswerBody = { kind: "outcome"; value: OperationOutcome } | { kind: "problem"; value: Problem };

/** The code system the API names its own reasons in, inside an OperationOutcome's `details.coding`. */
export const API_ERROR_SYSTEM = "https://haau3.com/fhir/CodeSystem/api-error";

/**
 * The API's own code for why it refused a request, when it names one: the `api-error` coding of an
 * OperationOutcome's first issue that has one, or a problem's `code`. A code, never words, so it is
 * safe to log.
 */
export function apiErrorCode(body: AnswerBody | undefined): string | undefined {
  return codeIn(body, [API_ERROR_SYSTEM]);
}

/** The Sandbox's own code system: `not-the-example`, for a request that is not an operation's documented example. */
export const SANDBOX_ERROR_SYSTEM = "https://haau3.com/fhir/CodeSystem/sandbox-error";

/**
 * The API's own code for why it refused a request with any other 4xx, when it names one: an
 * `api-error` or `sandbox-error` coding of an OperationOutcome's first issue that has one, or a
 * problem's `code`. A code, never words, so it is safe to log.
 */
export function refusalCode(body: AnswerBody | undefined): string | undefined {
  return codeIn(body, [API_ERROR_SYSTEM, SANDBOX_ERROR_SYSTEM]);
}

function codeIn(body: AnswerBody | undefined, systems: readonly string[]): string | undefined {
  if (!body) return undefined;
  if (body.kind === "problem") return typeof body.value.code === "string" ? body.value.code : undefined;
  for (const issue of body.value.issue ?? []) {
    const coding = issue.details?.coding?.find((c) => c.system !== undefined && systems.includes(c.system) && typeof c.code === "string");
    if (coding) return coding.code;
  }
  return undefined;
}

/**
 * How long an answered request took, in how many attempts, the correlation id it came back with,
 * and its status's text.
 */
export interface Timing {
  attempts: number;
  durationMs: number;
  correlationId?: string | undefined;
  statusText?: string | undefined;
}

/**
 * The API did not accept the key (401): none was sent, it is not one the API knows, or it was
 * revoked. A 403 is never this error: the key was accepted, and the answer is a
 * {@link ForbiddenError}.
 */
export class AuthError extends Haau3Error {
  override name = "AuthError";
  readonly status: number;
  /** The status's text: the answer's own, or the standard one (`"Unauthorized"`). */
  readonly statusText: string;
  /** How many attempts were made. */
  readonly attempts: number;
  /** Milliseconds from the first attempt to the answer. */
  readonly durationMs: number | undefined;
  /** The OperationOutcome the FHIR base answered with. Not enumerable, so it is never printed. */
  declare readonly outcome?: OperationOutcome;
  /** The problem the other services answered with. Not enumerable, so it is never printed. */
  declare readonly problem?: Problem;

  constructor(message: string, status: number, requestId?: string, body?: AnswerBody, timing?: Timing) {
    super(message, requestId, { correlationId: timing?.correlationId });
    this.status = status;
    this.statusText = timing?.statusText ?? "";
    this.attempts = timing?.attempts ?? 1;
    this.durationMs = timing?.durationMs;
    attachBody(this, body);
  }
}

/**
 * The API accepted the key and refused the request (403). The key itself is real, so there is
 * nothing to rotate. `code` says why when the API names it, and the message says it in words:
 *
 * - `test-key-outside-sandbox`: a test key works only in the Sandbox. Send a live key.
 * - `live-key-in-sandbox`: a live key does not work in the Sandbox. Send a test key.
 * - `phi-agreement-required`: the organization may not send patient data, and not every resource in
 *   the request is labelled as test data. `markAsTestData` labels made-up data.
 * - `not-open-to-customers`: the operation is not yet open to customers, so it did not run. An
 *   expected answer, not a fault in the request.
 *
 * Without a code, the key's organization may not make the request; `outcome` (or `problem`) says
 * why, in the API's words. Not an {@link AuthError}, which is a
 * key the API did not accept (401).
 */
export class ForbiddenError extends Haau3Error {
  override name = "ForbiddenError";
  readonly status: number;
  /** The status's text: the answer's own, or the standard one (`"Forbidden"`). */
  readonly statusText: string;
  /** The API's code for why, from its `api-error` code system, when it names one. */
  readonly code: string | undefined;
  /** How many attempts were made. */
  readonly attempts: number;
  /** Milliseconds from the first attempt to the answer. */
  readonly durationMs: number | undefined;
  /** The OperationOutcome the FHIR base answered with. Not enumerable, so it is never printed. */
  declare readonly outcome?: OperationOutcome;
  /** The problem the other services answered with. Not enumerable, so it is never printed. */
  declare readonly problem?: Problem;

  constructor(message: string, status: number, requestId?: string, body?: AnswerBody, timing?: Timing) {
    super(message, requestId, { correlationId: timing?.correlationId });
    this.status = status;
    this.statusText = timing?.statusText ?? "";
    this.code = apiErrorCode(body);
    this.attempts = timing?.attempts ?? 1;
    this.durationMs = timing?.durationMs;
    attachBody(this, body);
  }
}

/**
 * The API answered and refused the request: a parameter it does not take, a record that does not
 * exist (404), a page that no longer exists (410), a body that is too large (413). `status` says
 * which, and the body says why.
 */
export class RefusedError extends Haau3Error {
  override name = "RefusedError";
  readonly status: number;
  /** The status's text: the answer's own, or the standard one (`"Not Found"`). */
  readonly statusText: string;
  /**
   * The API's code for why, when it names one: `not-the-example` from the Sandbox, which answers an
   * operation's documented example only and refuses anything else with a 400 naming it.
   */
  readonly code: string | undefined;
  /** How many attempts were made. */
  readonly attempts: number;
  /** Milliseconds from the first attempt to the answer. */
  readonly durationMs: number | undefined;
  /** The OperationOutcome the FHIR base answered with. Not enumerable, so it is never printed. */
  declare readonly outcome?: OperationOutcome;
  /** The problem the other services answered with. Not enumerable, so it is never printed. */
  declare readonly problem?: Problem;

  constructor(message: string, status: number, requestId?: string, body?: AnswerBody, timing?: Timing) {
    super(message, requestId, { correlationId: timing?.correlationId });
    this.status = status;
    this.statusText = timing?.statusText ?? "";
    this.code = refusalCode(body);
    this.attempts = timing?.attempts ?? 1;
    this.durationMs = timing?.durationMs;
    attachBody(this, body);
  }
}

/**
 * The request got no answer, after every attempt the client was allowed. This never means "no
 * results": an empty search answers with an empty Bundle or list, not with this error.
 */
export class NoAnswerError extends Haau3Error {
  override name = "NoAnswerError";
  readonly reason: NoAnswerReason;
  /** The last status the API answered with, when it answered at all. */
  readonly status: number | undefined;
  /** That status's text, the answer's own or the standard one, when it answered at all. */
  readonly statusText: string | undefined;
  /** Seconds to wait before trying again, when the API said. */
  readonly retryAfter: number | undefined;
  /** How many attempts were made. */
  readonly attempts: number;
  /** Milliseconds from the first attempt to the last failure, waits between attempts included. */
  readonly durationMs: number | undefined;
  /**
   * For a timeout or a network failure, what failed, safe to log: the system's code for it
   * (`"ECONNREFUSED"`, `"ENOTFOUND"`, `"CERT_HAS_EXPIRED"`) or the failing error's name
   * (`"TimeoutError"`). Never a message, which can name the address.
   */
  readonly detail: string | undefined;
  /** The OperationOutcome the FHIR base answered with. Not enumerable, so it is never printed. */
  declare readonly outcome?: OperationOutcome;
  /** The problem the other services answered with. Not enumerable, so it is never printed. */
  declare readonly problem?: Problem;

  constructor(
    message: string,
    details: {
      reason: NoAnswerReason;
      attempts: number;
      durationMs?: number;
      status?: number;
      statusText?: string | undefined;
      retryAfter?: number;
      requestId?: string;
      correlationId?: string | undefined;
      detail?: string;
      body?: AnswerBody;
      cause?: unknown;
    },
  ) {
    super(message, details.requestId, { cause: details.cause, correlationId: details.correlationId });
    this.reason = details.reason;
    this.status = details.status;
    this.statusText = details.status === undefined ? undefined : details.statusText;
    this.retryAfter = details.retryAfter;
    this.attempts = details.attempts;
    this.durationMs = details.durationMs;
    this.detail = details.detail;
    attachBody(this, details.body);
  }
}
