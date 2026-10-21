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
  reason?: NoAnswerReason;
  retryAfter?: number;
  attempts?: number;
  durationMs?: number;
  requestId?: string;
  correlationId?: string;
  detail?: string;
}

/** The fields {@link Haau3Error.toJSON} copies when they are set, in this order. */
const LOGGED = ["status", "reason", "retryAfter", "attempts", "durationMs", "requestId", "correlationId", "detail"] as const;

/** What every error this package throws has. */
export class Haau3Error extends Error {
  override name = "Haau3Error";
  /** The `X-Request-Id` the API sent, when it answered. Quote it when you ask for help. */
  readonly requestId: string | undefined;
  /** The `correlationId` you sent, as the API returned it in `X-Correlation-Id`, when it answered. */
  readonly correlationId: string | undefined;

  constructor(message: string, requestId?: string, options?: ErrorOptions & { correlationId?: string | undefined }) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.requestId = requestId;
    this.correlationId = options?.correlationId;
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

/** How long an answered request took, in how many attempts, and the correlation id it came back with. */
export interface Timing {
  attempts: number;
  durationMs: number;
  correlationId?: string | undefined;
}

/**
 * The API refused the request because of the key. A 401 means the key itself: none was sent, it is
 * not one the API knows, or it was revoked. A 403 is a {@link ForbiddenError}, this class's subclass:
 * the key was accepted, and its organization may not make the request.
 */
export class AuthError extends Haau3Error {
  override name = "AuthError";
  readonly status: number;
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
    this.attempts = timing?.attempts ?? 1;
    this.durationMs = timing?.durationMs;
    attachBody(this, body);
  }
}

/**
 * The API accepted the key and refused the request for the key's organization (403): an operation
 * the organization may not use, or one not yet open to it. The key itself is fine, so there is
 * nothing to rotate; `outcome` (or `problem`) says why, in the API's words. A subclass of
 * {@link AuthError}, so code that catches `AuthError` still catches it.
 */
export class ForbiddenError extends AuthError {
  override name = "ForbiddenError";
}

/**
 * The API answered and refused the request: a parameter it does not take, a record that does not
 * exist (404), a page that no longer exists (410), a body that is too large (413). `status` says
 * which, and the body says why.
 */
export class RefusedError extends Haau3Error {
  override name = "RefusedError";
  readonly status: number;
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
    this.retryAfter = details.retryAfter;
    this.attempts = details.attempts;
    this.durationMs = details.durationMs;
    this.detail = details.detail;
    attachBody(this, details.body);
  }
}
