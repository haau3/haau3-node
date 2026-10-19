import type { OperationOutcome } from "fhir/r4.js";
import { APIPromise, type ResponseMeta, type WithResponse } from "./api-promise.js";
import { AuthError, Haau3Error, NoAnswerError, RefusedError, type AnswerBody, type NoAnswerReason } from "./errors.js";
import type { Problem } from "./generated/types.js";
import { VERSION } from "./version.js";

/**
 * Options passed on to `fetch` with every request: anything the runtime's `RequestInit` takes, such
 * as `cache`, undici's `dispatcher`, Cloudflare's `cf` or Next.js's `next`. The SDK's own method,
 * headers, body, signal and redirect always win. `cache` is declared here because Node's own `RequestInit` type leaves it out,
 * though Node's fetch takes it.
 */
export type FetchOptions = Omit<RequestInit, "method" | "headers" | "body" | "signal" | "redirect" | "cache"> & {
  cache?: "default" | "force-cache" | "no-cache" | "no-store" | "only-if-cached" | "reload" | undefined;
};

/** How to construct the client. Every option has a default. */
export interface ClientOptions {
  /** Your platform API key (`haau3_sk_…`). Defaults to `process.env.HAAU3_API_KEY`. */
  apiKey?: string;
  /** Where the API is. Defaults to `https://api.haau3.com`. */
  baseURL?: string;
  /** Milliseconds one attempt may take. Defaults to 65,000. */
  timeout?: number;
  /** How many times a request is retried after a timeout, a network failure, a 429 or a 5xx. Defaults to 1. */
  maxRetries?: number;
  /** The fetch to send requests with. Defaults to the global `fetch`. */
  fetch?: typeof fetch;
  /**
   * Passed on to `fetch` with every request: anything the runtime's fetch takes, such as undici's
   * `dispatcher` for a proxy in Node, Cloudflare's `cf` or Next.js's `next`. Unless it sets `cache`
   * (or Next.js's `next`), every request is sent with `cache: "no-store"` where the runtime takes
   * the field: an API answer is live data for one key, never one a fetch cache should keep. Pass
   * `{ cache: undefined }` to send no `cache` at all.
   */
  fetchOptions?: FetchOptions;
}

/** Options for one call. Each overrides the client's own for that call only. */
export interface RequestOptions {
  /** Milliseconds one attempt may take. */
  timeout?: number;
  /** How many times this call is retried. `0` sends it once. */
  maxRetries?: number;
  /** Ends the call when it aborts. The abort's reason is thrown as it is. */
  signal?: AbortSignal;
  /**
   * An id of your own for this call, a UUID, such as your job's or your trace's. Sent as
   * `X-Request-Id`; the API keeps it with its record of the request and returns it in
   * `X-Correlation-Id`, which `.withResponse()` and every error the API answered give back as
   * `correlationId`. The API takes only a UUID and drops anything else without a word, so the SDK
   * refuses anything else before sending.
   */
  correlationId?: string;
  /** Extra headers for this call. `correlationId` is the way to send your own `X-Request-Id`. */
  headers?: Record<string, string>;
  /** Passed on to `fetch` for this call, over the client's own `fetchOptions`. */
  fetchOptions?: FetchOptions;
}

/**
 * The form the API takes for your own request id: a UUID in its usual text form, any version, as the
 * spec's `X-Request-Id` parameter declares (`format: uuid`).
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A query parameter's value. A list sends the parameter once per value. */
export type QueryValue = string | number | boolean | ReadonlyArray<string | number | boolean> | undefined;

/** A request {@link Transport.request} sends as it is given. */
export interface RawRequest extends RequestOptions {
  method: "GET" | "POST";
  /** A path such as `/v1/scheduling/slots`, or a whole URL on the client's own `baseURL`. */
  path: string;
  query?: Record<string, QueryValue>;
  /** Sent as it is when it is a string, and as JSON otherwise. */
  body?: unknown;
}

/** What the API answered, whatever its status. */
export interface RawResponse extends ResponseMeta {
  /** The body, parsed when it is JSON, else its text. */
  body: unknown;
}

/** What a generated method passes to {@link Transport.operation}. */
interface OperationCall {
  method: "GET" | "POST";
  path: string;
  pathParams?: Record<string, string>;
  query?: object;
  body?: unknown;
  /** The FHIR resource types the operation answers with, from the spec. Unset for other answers. */
  expects?: readonly string[];
}

interface Sent {
  response: Response;
  text: string;
  attempts: number;
  durationMs: number;
}

const DEFAULT_BASE_URL = "https://api.haau3.com";
const DEFAULT_TIMEOUT = 65_000;
const DEFAULT_MAX_RETRIES = 1;
/** The longest `Retry-After` the client waits out. A longer one fails at once and says when. */
const LONGEST_WAIT_SECONDS = 60;
const FHIR_JSON = "application/fhir+json";

/**
 * True in a browser. A key in a browser is public, and the API answers no browser anyway (it sends
 * no CORS headers). jsdom, which test runners use to render components on a server, is not one.
 */
function inBrowser(): boolean {
  const g = globalThis as { window?: unknown; document?: unknown; navigator?: { userAgent?: string } };
  return (
    typeof g.window !== "undefined" &&
    typeof g.document !== "undefined" &&
    !(g.navigator?.userAgent ?? "").includes("jsdom")
  );
}

/**
 * Whether this runtime's fetch takes a `cache` field. Node's does. Some edge runtimes have refused
 * the field outright, so the no-store default is sent only where it is taken.
 */
function cacheFieldTaken(): boolean {
  try {
    new Request("https://api.haau3.com/", { cache: "no-store" });
    return true;
  } catch {
    return false;
  }
}

function envKey(): string | undefined {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return g.process?.env?.HAAU3_API_KEY || undefined;
}

/** Seconds from a `Retry-After` header, when it holds a number of seconds. */
function retryAfterSeconds(headers: Headers): number | undefined {
  const value = headers.get("retry-after");
  if (value === null || !/^\d+$/.test(value.trim())) return undefined;
  return Number(value.trim());
}

/** Exponential backoff with jitter: about 0.5 s, then 1 s, 2 s and so on, never past 8 s. */
function backoff(attempt: number): number {
  const ceiling = Math.min(8_000, 500 * 2 ** (attempt - 1));
  return ceiling * (0.5 + Math.random() * 0.5);
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function parseBody(text: string, contentType: string | null): unknown {
  if (!contentType || !/json/i.test(contentType)) return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function readErrorBody(body: unknown): AnswerBody | undefined {
  if (!body || typeof body !== "object") return undefined;
  const record = body as Record<string, unknown>;
  if (record.resourceType === "OperationOutcome") return { kind: "outcome", value: body as OperationOutcome };
  if (typeof record.type === "string" && typeof record.status === "number") return { kind: "problem", value: body as Problem };
  return undefined;
}

/** A resource type with its article: "a Bundle", "an InsurancePlan". */
const withArticle = (type: string) => `${/^[AEIOU]/.test(type) ? "an" : "a"} ${type}`;

/** How an answer is named in a message: its resource type when it has a plausible one, never a value. */
function describeAnswer(body: unknown): string {
  const type = body && typeof body === "object" ? (body as { resourceType?: unknown }).resourceType : undefined;
  return typeof type === "string" && /^[A-Z][A-Za-z]{0,63}$/.test(type) ? withArticle(type) : "something that is not a FHIR resource";
}

function noAnswerReason(status: number): NoAnswerReason {
  if (status === 429) return "rate-limited";
  if (status === 502 || status === 503) return "unavailable";
  if (status === 504) return "timeout";
  return "server-error";
}

/** Appends a query to a URL's parameters: a list sends the parameter once per value, `undefined` sends none. */
export function appendQuery(params: URLSearchParams, query: Record<string, QueryValue> | undefined): void {
  for (const [name, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(name, String(item));
  }
}

/** What came with an answer, for {@link judge}. */
export interface AnswerContext {
  requestId: string | undefined;
  /** The `X-Correlation-Id` the answer came back with. */
  correlationId?: string | undefined;
  attempts: number;
  durationMs: number;
  /** Seconds from the answer's `Retry-After`, when it had one. */
  retryAfter?: number | undefined;
  /** The FHIR resource types a success may be. Unset checks no type. */
  expects?: readonly string[] | undefined;
  /** How a success with no body is described: "a body that is not JSON", "no resource". */
  missing: string;
  /**
   * An answer inside a batch. The key is checked once for the whole batch, so a 401 or 403 on one
   * entry is a refusal of that entry, not of the key.
   */
  entry?: boolean;
}

/**
 * What one answer means: the answer itself, or the error it is. A single call and each entry of a
 * batch are judged alike. `name` says which request it was, in words that carry no value a caller
 * sent: the method and the operation's path with its `{id}` left in.
 */
export function judge<T>(
  name: string,
  status: number,
  body: unknown,
  context: AnswerContext,
): { ok: true; data: T } | { ok: false; error: AuthError | RefusedError | NoAnswerError } {
  const { requestId, attempts, durationMs, expects } = context;
  const timing = { attempts, durationMs, correlationId: context.correlationId };
  if (status >= 200 && status < 300) {
    if (body === undefined) {
      return {
        ok: false,
        error: new NoAnswerError(`${name} answered ${status} with ${context.missing}.`, { reason: "unreadable", status, requestId, ...timing }),
      };
    }
    if (expects && !expects.includes((body as { resourceType?: unknown } | null)?.resourceType as string)) {
      const wanted = expects.map(withArticle).join(" or ");
      return {
        ok: false,
        error: new NoAnswerError(`${name} answered ${describeAnswer(body)} where ${wanted} was expected.`, {
          reason: "unreadable",
          status,
          requestId,
          ...timing,
        }),
      };
    }
    return { ok: true, data: body as T };
  }
  const errorBody = readErrorBody(body);
  if ((status === 401 || status === 403) && !context.entry) {
    return {
      ok: false,
      error: new AuthError(`${name} was refused: the API key was not accepted (${status}).`, status, requestId, errorBody, timing),
    };
  }
  if (status === 429 || status >= 500) {
    const reason = noAnswerReason(status);
    return {
      ok: false,
      error: new NoAnswerError(`${name} got no answer (${reason}, ${status}) after ${attempts} attempt${attempts === 1 ? "" : "s"}.`, {
        reason,
        status,
        retryAfter: context.retryAfter,
        requestId,
        body: errorBody,
        ...timing,
      }),
    };
  }
  if (status >= 400) {
    return { ok: false, error: new RefusedError(`${name} was refused (${status}).`, status, requestId, errorBody, timing) };
  }
  return {
    ok: false,
    error: new NoAnswerError(`${name} answered ${status}, which is not an answer.`, { reason: "unreadable", status, requestId, ...timing }),
  };
}

/** The connection, retries and errors every operation shares. */
export abstract class Transport {
  readonly #apiKey: string;
  readonly #fetch: typeof fetch;
  readonly #fetchOptions: FetchOptions;
  readonly #noStoreTaken: boolean;
  /** Where requests go. */
  readonly baseURL: string;
  /** Milliseconds one attempt may take. */
  readonly timeout: number;
  /** How many times a request is retried. */
  readonly maxRetries: number;

  constructor(options: ClientOptions = {}) {
    if (inBrowser()) {
      throw new Haau3Error(
        "@haau3/sdk runs on a server only: an API key in a browser is public. Call the API from your server.",
      );
    }
    const apiKey = options.apiKey ?? envKey();
    if (!apiKey) throw new Haau3Error("No API key: pass apiKey, or set HAAU3_API_KEY.");
    const fetchImpl = options.fetch ?? (globalThis as { fetch?: typeof fetch }).fetch;
    if (!fetchImpl) throw new Haau3Error("No fetch: pass one as the fetch option. Node 22 and newer have one.");
    this.#apiKey = apiKey;
    this.#fetch = fetchImpl;
    this.#fetchOptions = options.fetchOptions ?? {};
    this.#noStoreTaken = cacheFieldTaken();
    this.baseURL = (options.baseURL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
    this.maxRetries = options.maxRetries ?? DEFAULT_MAX_RETRIES;
  }

  /**
   * Sends any request and returns what the API answered, whatever its status. Throws only when no
   * answer arrived ({@link NoAnswerError}), or for a URL that is not on the client's own `baseURL`.
   */
  async request(request: RawRequest): Promise<RawResponse> {
    const url = this.#url(request.path, request.query);
    const sent = await this.#send(request.method, url, request.body, request, url.pathname);
    return {
      status: sent.response.status,
      headers: sent.response.headers,
      body: parseBody(sent.text, sent.response.headers.get("content-type")) ?? sent.text,
      requestId: sent.response.headers.get("x-request-id") ?? undefined,
      correlationId: sent.response.headers.get("x-correlation-id") ?? undefined,
      attempts: sent.attempts,
      durationMs: sent.durationMs,
    };
  }

  /**
   * Runs one operation of the spec and returns its answer, or throws one of the three errors. The
   * answer's `.withResponse()` gives its request id and timing too.
   */
  protected operation<T>(call: OperationCall, options: RequestOptions = {}): APIPromise<T> {
    let path = call.path;
    for (const [name, value] of Object.entries(call.pathParams ?? {})) {
      path = path.replace(`{${name}}`, encodeURIComponent(value));
    }
    // A bad baseURL rejects the call rather than throwing at it. The request itself starts now,
    // as the call is made, so an abort right after it reaches the fetch.
    let url: URL;
    try {
      url = this.#url(path, call.query as Record<string, QueryValue>);
    } catch (error) {
      return new APIPromise<T>(Promise.reject(error));
    }
    return new APIPromise(this.respond<T>(call.method, url, call.body, options, call.path, call.expects));
  }

  /** Sends a request and returns its answer only. See {@link Transport.respond}. */
  protected async answer<T>(
    method: "GET" | "POST",
    url: URL,
    body: unknown,
    options: RequestOptions,
    label: string,
    expects?: readonly string[],
  ): Promise<T> {
    return (await this.respond<T>(method, url, body, options, label, expects)).data;
  }

  /**
   * Sends a request and reads its answer. `label` names the request in an error message: the
   * operation's path with its `{id}` left in, so no value a caller sent ends up in a message.
   * `expects`, when set, are the FHIR resource types the answer may be; any other is not an answer.
   */
  protected async respond<T>(
    method: "GET" | "POST",
    url: URL,
    body: unknown,
    options: RequestOptions,
    label: string,
    expects?: readonly string[],
  ): Promise<WithResponse<T>> {
    const sent = await this.#send(method, url, body, options, label);
    const { response, text, attempts, durationMs } = sent;
    const status = response.status;
    const requestId = response.headers.get("x-request-id") ?? undefined;
    const correlationId = response.headers.get("x-correlation-id") ?? undefined;
    const verdict = judge<T>(`${method} ${label}`, status, parseBody(text, response.headers.get("content-type")), {
      requestId,
      correlationId,
      attempts,
      durationMs,
      retryAfter: retryAfterSeconds(response.headers),
      expects,
      missing: "a body that is not JSON",
    });
    if (!verdict.ok) throw verdict.error;
    return { data: verdict.data, requestId, correlationId, durationMs, attempts, status, headers: response.headers };
  }

  /** A URL on this client's base, refusing any other host so the key is never sent to one. */
  protected url(pathOrUrl: string): URL {
    return this.#url(pathOrUrl, undefined);
  }

  #url(pathOrUrl: string, query: Record<string, QueryValue> | undefined): URL {
    const base = new URL(this.baseURL);
    const url = /^https?:\/\//i.test(pathOrUrl)
      ? new URL(pathOrUrl)
      : new URL(base.pathname.replace(/\/$/, "") + (pathOrUrl.startsWith("/") ? pathOrUrl : `/${pathOrUrl}`), base);
    if (url.origin !== base.origin) {
      throw new Haau3Error(`Refusing to send the API key to ${url.origin}: the client's baseURL is ${base.origin}.`);
    }
    appendQuery(url.searchParams, query);
    return url;
  }

  async #send(
    method: "GET" | "POST",
    url: URL,
    body: unknown,
    options: RequestOptions,
    label: string,
  ): Promise<Sent> {
    const fhir = url.pathname.startsWith("/v1/fhir/") || url.pathname === "/v1/fhir";
    const headers: Record<string, string> = {
      accept: fhir ? FHIR_JSON : "application/json",
      authorization: `Bearer ${this.#apiKey}`,
      "user-agent": `haau3-sdk/${VERSION}`,
    };
    let payload: string | undefined;
    if (body !== undefined) {
      payload = typeof body === "string" ? body : JSON.stringify(body);
      headers["content-type"] = fhir ? FHIR_JSON : "application/json";
    }
    for (const [name, value] of Object.entries(options.headers ?? {})) headers[name.toLowerCase()] = value;
    if (options.correlationId !== undefined) {
      if (!UUID.test(options.correlationId)) {
        throw new Haau3Error(
          `${method} ${label} was not sent: correlationId must be a UUID, which is all the API keeps (it drops anything else).`,
        );
      }
      headers["x-request-id"] = options.correlationId;
    }

    const timeout = options.timeout ?? this.timeout;
    const maxRetries = options.maxRetries ?? this.maxRetries;
    const fetchOptions: FetchOptions = { ...this.#fetchOptions, ...options.fetchOptions };
    // No-store unless the caller chose, where the runtime takes the field (see ClientOptions).
    if (this.#noStoreTaken && !("cache" in fetchOptions) && !("next" in fetchOptions)) fetchOptions.cache = "no-store";
    const started = Date.now();
    let attempt = 0;
    for (;;) {
      attempt += 1;
      const attemptSignal = AbortSignal.timeout(timeout);
      const signal = options.signal ? AbortSignal.any([options.signal, attemptSignal]) : attemptSignal;
      const canRetry = attempt <= maxRetries;
      let response: Response;
      let text: string;
      try {
        response = await this.#fetch(url, { ...fetchOptions, method, headers, body: payload, signal, redirect: "manual" });
        text = await response.text();
      } catch (error) {
        if (options.signal?.aborted) throw options.signal.reason;
        const reason: NoAnswerReason = attemptSignal.aborted ? "timeout" : "network";
        if (canRetry) {
          await sleep(backoff(attempt), options.signal);
          continue;
        }
        throw new NoAnswerError(`${method} ${label} got no answer (${reason}) after ${attempt} attempt${attempt === 1 ? "" : "s"}.`, {
          reason,
          attempts: attempt,
          durationMs: Date.now() - started,
          cause: error,
        });
      }
      const retryable = response.status === 429 || response.status >= 500;
      if (retryable && canRetry) {
        const wait = retryAfterSeconds(response.headers);
        if (wait === undefined || wait <= LONGEST_WAIT_SECONDS) {
          await sleep(wait === undefined ? backoff(attempt) : wait * 1000, options.signal);
          continue;
        }
      }
      return { response, text, attempts: attempt, durationMs: Date.now() - started };
    }
  }
}
