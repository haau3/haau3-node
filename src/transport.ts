import type { OperationOutcome } from "fhir/r4.js";
import { APIPromise, type ResponseMeta, type WithResponse } from "./api-promise.js";
import {
  AuthError,
  ForbiddenError,
  Haau3Error,
  NoAnswerError,
  RefusedError,
  apiErrorCode,
  type AnswerBody,
  type ClientErrorCode,
  type NoAnswerReason,
} from "./errors.js";
import type { Problem } from "./generated/types.js";
import { VERSION } from "./version.js";

/**
 * Options passed on to `fetch` with every request: anything the runtime's `RequestInit` takes, such
 * as `cache`, undici's `dispatcher`, Cloudflare's `cf` or Next.js's `next`. The SDK's own method,
 * headers, body, signal and redirect always win. `cache` and `dispatcher` are declared here because
 * Node's own `RequestInit` type leaves them out, though Node's fetch takes both.
 */
export type FetchOptions = Omit<RequestInit, "method" | "headers" | "body" | "signal" | "redirect" | "cache" | "dispatcher"> & {
  cache?: "default" | "force-cache" | "no-cache" | "no-store" | "only-if-cached" | "reload" | undefined;
  /**
   * For Node's fetch: an undici `Dispatcher`, such as a `ProxyAgent` to send through a proxy or an
   * `Agent` with its own connection settings, from whichever version of undici you install.
   */
  dispatcher?: object | undefined;
};

/**
 * Your app, named in the User-Agent after the SDK's own: a library, plugin or command line built on
 * this SDK names itself once, and every request it sends says so, as `name/version (url)`.
 */
export interface AppInfo {
  /**
   * Your app's name, such as `my-plugin`: letters, digits and the marks `- . _ ~ ! # $ % & ' * + ^ \` |`,
   * with no space or slash, as a User-Agent product name takes.
   */
  name: string;
  /** Its version, such as `1.2.0`, in the same characters. An empty string sends none. */
  version?: string | undefined;
  /** Where to find out about it: an http or https URL, such as `https://example.com/my-plugin`. An empty string sends none. */
  url?: string | undefined;
}

/**
 * The API's two environments: `production` at `https://api.haau3.com`, and `sandbox` at
 * `https://sandbox.haau3.com`, which serves production's paths with fixed answers and synthetic data,
 * to build and test against.
 */
export type Environment = "production" | "sandbox";

/** Where each environment is. */
const ENVIRONMENTS: Readonly<Record<Environment, string>> = {
  production: "https://api.haau3.com",
  sandbox: "https://sandbox.haau3.com",
};

/** How to construct the client. Every option has a default. */
export interface ClientOptions {
  /**
   * Your platform API key. Defaults to `process.env.HAAU3_API_KEY`. Its mode picks the environment:
   * a test key (`haau3_sk_test_…`) sends every call to the Sandbox, and a live key
   * (`haau3_sk_live_…`), or one made before test and live keys, to production. Optional only in the
   * Sandbox: with no key, name it as the `environment`.
   */
  apiKey?: string;
  /**
   * The environment to call: `"production"` or `"sandbox"`. Defaults to
   * `process.env.HAAU3_ENVIRONMENT`, then the key's mode. Name `"sandbox"` to call the Sandbox with
   * no key. A key of the other mode (for the Sandbox, a live key or one made before test and live
   * keys) is refused when the client is made, before anything is sent, and so is a `baseURL` on the
   * other environment's own address.
   */
  environment?: Environment;
  /**
   * Where the API is, for a stand-in or your own proxy. Defaults to `process.env.HAAU3_BASE_URL`,
   * then the environment's address: `https://api.haau3.com` or `https://sandbox.haau3.com`. The API
   * key is sent to this address only. The environment's rules for the key still hold.
   */
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
  /**
   * Your app's name, version and URL, sent in the User-Agent after the SDK's own:
   * `haau3-node/0.3.9 (node 24) my-plugin/1.2.0`. A value the header cannot carry is refused here,
   * before anything is sent. A `user-agent` in a call's `headers` replaces the whole value instead.
   */
  appInfo?: AppInfo;
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
 * The names of {@link RequestOptions}, which the option for a header an operation declares must not
 * shadow (scripts/generate.ts). Every name is listed, or this file does not compile.
 */
export const CALL_OPTIONS = ["timeout", "maxRetries", "signal", "correlationId", "headers", "fetchOptions"] as const satisfies readonly (keyof RequestOptions)[];
export type EveryCallOptionListed = Exclude<keyof RequestOptions, (typeof CALL_OPTIONS)[number]> extends never ? true : never;
const everyCallOptionListed: EveryCallOptionListed = true;
void everyCallOptionListed;

/**
 * A header parameter an operation declares, sent from the call's option of the same name in
 * camelCase, and checked against the parameter's schema before sending.
 */
interface DeclaredHeader {
  /** The header, as the spec names it. */
  name: string;
  /** The option it is sent from. */
  option: string;
  maxLength?: number;
  pattern?: string;
}

/**
 * The headers an operation declares, from the call's options: each one set is checked against its
 * schema and sent, lower-cased. A value the API would refuse is refused here, before anything is
 * sent, and the message names the option, never the value: a header such as `Payer-Authorization`
 * carries a credential.
 */
function declaredHeaders(call: OperationCall, options: RequestOptions): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const header of call.declared ?? []) {
    const value: unknown = (options as Record<string, unknown>)[header.option];
    if (value === undefined) continue;
    const notSent = `${call.method} ${call.path} was not sent: ${header.option}`;
    if (typeof value !== "string") throw new Haau3Error(`${notSent} must be a string.`);
    if (header.maxLength !== undefined && value.length > header.maxLength) {
      throw new Haau3Error(`${notSent} is longer than the ${header.maxLength} characters the API takes in ${header.name}.`);
    }
    if (header.pattern !== undefined && !new RegExp(header.pattern).test(value)) {
      throw new Haau3Error(`${notSent} is not in the form the API takes in ${header.name}, which the option's description gives.`);
    }
    headers[header.name.toLowerCase()] = value;
  }
  return headers;
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

/**
 * What {@link Transport.get} takes beside the path: the call's own values, and every per-call option.
 */
export interface CallOptions extends RequestOptions {
  /**
   * A value for each `{name}` in the path, such as `{ id: "Practitioner-1093209884" }` for
   * `/v1/fhir/r4/Practitioner/{id}`. Each is encoded into the path, and the path as you wrote it, its
   * `{name}` left in, is what an error's message names, so no value you send ends up in one. Every
   * `{name}` needs a value, and every value a `{name}`; either missing is refused before sending.
   */
  pathParams?: Record<string, string>;
  /** The query parameters. A list sends the parameter once per value, and `undefined` sends none. */
  query?: Record<string, QueryValue>;
  /**
   * The FHIR resource types the answer may be, such as `["Bundle"]`, as each operation's own method
   * checks them. Any other answer is a {@link NoAnswerError} with reason `unreadable`. Unset, any
   * answer the API sends is returned.
   */
  expects?: readonly string[];
}

/** What {@link Transport.post} takes beside the path: {@link CallOptions}, and the body. */
export interface PostOptions extends CallOptions {
  /** Sent as it is when it is a string, and as JSON otherwise. */
  body?: unknown;
}

/** A path's `{name}` placeholders. */
const PLACEHOLDER = /\{([^{}]*)\}/g;

/**
 * Refuses, before anything is sent, a path whose `{name}` has no value or a value with no `{name}`:
 * either would send a request to another address than the one meant. The message names the
 * placeholder, never a value.
 */
function checkPathParams(method: string, path: string, pathParams: Record<string, string> | undefined): void {
  const names = [...path.matchAll(PLACEHOLDER)].map((match) => match[1]!);
  const given = pathParams ?? {};
  const notSent = `${method} ${path} was not sent:`;
  for (const name of names) {
    if (!Object.hasOwn(given, name)) throw new Haau3Error(`${notSent} pathParams has no value for {${name}}.`);
    if (typeof given[name] !== "string") throw new Haau3Error(`${notSent} the value for {${name}} in pathParams must be a string.`);
  }
  for (const name of Object.keys(given)) {
    if (!names.includes(name)) throw new Haau3Error(`${notSent} the path has no {${name}} for pathParams' value.`);
  }
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
  /** The header parameters the operation declares, each sent from an option of the call's own. */
  declared?: readonly DeclaredHeader[];
}

interface Sent {
  response: Response;
  text: string;
  attempts: number;
  durationMs: number;
}

const DEFAULT_TIMEOUT = 65_000;
const DEFAULT_MAX_RETRIES = 1;
/** The longest `Retry-After` the client waits out. A longer one fails at once and says when. */
const LONGEST_WAIT_SECONDS = 60;
const FHIR_JSON = "application/fhir+json";
/**
 * The FHIR bases: production's, and the Sandbox's, which serves the same paths with synthetic data.
 * A path equal to or under either speaks FHIR, as the API reads it.
 */
const FHIR_BASES = ["/v1/fhir", "/v1/sandbox/fhir"];
const speaksFHIR = (path: string) => FHIR_BASES.some((base) => path === base || path.startsWith(`${base}/`));

/**
 * The runtime the SDK runs on, as the User-Agent names it: `node 24`, `bun 1.3.2`, `deno 2.5.6`.
 * With the language in the product name, it tells the API's own logs which SDK, and where, a
 * request came from.
 */
function runtime(): string {
  const g = globalThis as {
    process?: { versions?: Record<string, string | undefined> };
    Deno?: { version?: { deno?: string } };
  };
  const versions = g.process?.versions;
  if (versions?.bun) return `bun ${versions.bun}`;
  if (g.Deno?.version?.deno) return `deno ${g.Deno.version.deno}`;
  if (versions?.node) return `node ${versions.node.split(".")[0]}`;
  return "unknown runtime";
}

const USER_AGENT = `haau3-node/${VERSION} (${runtime()})`;

/** RFC 9110's `token`, which a User-Agent's product name and version each are. */
const TOKEN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/;
/** What a User-Agent's comment can carry of a URL: printable ASCII with no space, parenthesis or backslash. */
const COMMENT_TEXT = /^[\x21-\x27\x2A-\x5B\x5D-\x7E]+$/;
const APP_INFO_FIELDS = ["name", "version", "url"];
const TOKEN_MARKS = "letters, digits and the marks - . _ ~ ! # $ % & ' * + ^ ` |, with no space or slash";

/** A value as a message shows it: a string quoted, anything else by its type. */
const shown = (value: unknown) => (typeof value === "string" ? JSON.stringify(value) : value === null ? "null" : `a ${typeof value}`);

/** A refusal raised while the client is made, carrying the code a caller branches on. */
const refusal = (code: ClientErrorCode, message: string) => new Haau3Error(message, undefined, { code });

/**
 * The SDK's User-Agent with the caller's app after it, as `name/version (url)`. Each field is checked
 * here, so a value the header cannot carry is refused before anything is sent, naming the field.
 */
function userAgentOf(appInfo: AppInfo | undefined): string {
  if (appInfo === undefined) return USER_AGENT;
  if (appInfo === null || typeof appInfo !== "object" || Array.isArray(appInfo)) {
    throw refusal("invalid-app-info", `appInfo takes an object with a name, such as { name: "my-plugin", version: "1.2.0" }: ${shown(appInfo)} is not one.`);
  }
  const unknown = Object.keys(appInfo).filter((key) => !APP_INFO_FIELDS.includes(key));
  if (unknown.length > 0) {
    throw refusal("invalid-app-info", `appInfo takes name, version and url only: ${unknown.map((key) => JSON.stringify(key)).join(", ")} is not one of them.`);
  }
  const { name, version, url } = appInfo as { name?: unknown; version?: unknown; url?: unknown };
  if (name === undefined || name === "") throw refusal("invalid-app-info", `appInfo.name is required: your app's name, such as "my-plugin".`);
  if (typeof name !== "string" || !TOKEN.test(name)) {
    throw refusal("invalid-app-info", `appInfo.name takes ${TOKEN_MARKS}, such as "my-plugin": ${shown(name)} is not one.`);
  }
  let product = name;
  if (version !== undefined && version !== "") {
    if (typeof version !== "string" || !TOKEN.test(version)) {
      throw refusal("invalid-app-info", `appInfo.version takes ${TOKEN_MARKS}, such as "1.2.0": ${shown(version)} is not one.`);
    }
    product += `/${version}`;
  }
  if (url !== undefined && url !== "") {
    if (typeof url !== "string" || !COMMENT_TEXT.test(url) || !isWebURL(url)) {
      throw refusal("invalid-app-info",
        `appInfo.url takes an http or https URL with a host and no space, parenthesis or backslash, such as "https://example.com/my-plugin": ${shown(url)} is not one.`,
      );
    }
    product += ` (${url})`;
  }
  return `${USER_AGENT} ${product}`;
}

function isWebURL(text: string): boolean {
  try {
    const url = new URL(text);
    return (url.protocol === "http:" || url.protocol === "https:") && url.hostname !== "";
  } catch {
    return false;
  }
}

/** The standard text of each status (RFC 9110), for an answer that came with none, as HTTP/2 answers do. */
const STATUS_TEXT: Record<number, string> = {
  100: "Continue", 101: "Switching Protocols", 200: "OK", 201: "Created", 202: "Accepted",
  203: "Non-Authoritative Information", 204: "No Content", 205: "Reset Content", 206: "Partial Content",
  300: "Multiple Choices", 301: "Moved Permanently", 302: "Found", 303: "See Other", 304: "Not Modified",
  307: "Temporary Redirect", 308: "Permanent Redirect", 400: "Bad Request", 401: "Unauthorized",
  402: "Payment Required", 403: "Forbidden", 404: "Not Found", 405: "Method Not Allowed", 406: "Not Acceptable",
  407: "Proxy Authentication Required", 408: "Request Timeout", 409: "Conflict", 410: "Gone",
  411: "Length Required", 412: "Precondition Failed", 413: "Content Too Large", 414: "URI Too Long",
  415: "Unsupported Media Type", 416: "Range Not Satisfiable", 417: "Expectation Failed",
  421: "Misdirected Request", 422: "Unprocessable Content", 426: "Upgrade Required",
  428: "Precondition Required", 429: "Too Many Requests", 431: "Request Header Fields Too Large",
  451: "Unavailable For Legal Reasons", 500: "Internal Server Error", 501: "Not Implemented",
  502: "Bad Gateway", 503: "Service Unavailable", 504: "Gateway Timeout", 505: "HTTP Version Not Supported",
};

/** A status's text: the one the answer came with, else the standard one, else none. */
export const statusTextOf = (status: number, sent?: string) => sent || STATUS_TEXT[status] || "";

/**
 * Why the API refused a request with a 403, in the words of each message: the reasons the API names
 * by a code of its own. Any other 403, or one without a code, keeps the general sentence.
 */
const FORBIDDEN_REASONS: Record<string, string> = {
  "test-key-outside-sandbox": "this is a test key, which works only in the Sandbox",
  "live-key-in-sandbox": "this is a live key, which does not work in the Sandbox",
  "phi-agreement-required": "its organization may not send patient data, and not every resource in this request is labelled as test data",
  "not-open-to-customers": "the operation is not yet open to customers",
};
const FORBIDDEN_GENERAL = "the API key was accepted, and its organization may not make this request";

/**
 * What failed, safe to log: the system's code for it (`ECONNREFUSED`, `ENOTFOUND`, `UND_ERR_SOCKET`,
 * `CERT_HAS_EXPIRED`) when the error or anything under it has one, else the deepest error's name
 * (`TimeoutError`). Never a message: Node's, for one, names the address. A refused connection to a
 * host with two addresses is an AggregateError whose own code is the answer.
 */
export function failureDetail(error: unknown): string {
  const seen = new Set<unknown>();
  const queue: unknown[] = [error];
  let deepest = "Error";
  while (queue.length > 0 && seen.size < 32) {
    const current = queue.shift();
    if (current === null || typeof current !== "object" || seen.has(current)) continue;
    seen.add(current);
    const { code, name } = current as { code?: unknown; name?: unknown };
    if (typeof code === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(code)) return code;
    if (typeof name === "string" && /^[A-Za-z]{1,64}$/.test(name)) deepest = name;
    if (current instanceof AggregateError) queue.push(...(current.errors as unknown[]));
    queue.push((current as { cause?: unknown }).cause);
  }
  return deepest;
}

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

/**
 * A base URL without its trailing slashes, refused unless it is an http or https URL with a host and
 * no query or fragment. The error names where the URL came from, the option or the variable.
 */
function checkedBaseURL(base: string, source: "baseURL" | "HAAU3_BASE_URL"): string {
  const stripped = base.replace(/\/+$/, "");
  let url: URL | undefined;
  try {
    url = new URL(stripped);
  } catch {
    url = undefined;
  }
  if (!url || !["http:", "https:"].includes(url.protocol) || !url.hostname || url.search || url.hash) {
    throw refusal("invalid-base-url",
      `${source} takes an http or https URL with a host, such as https://api.haau3.com: ${JSON.stringify(base)} is not one.`,
    );
  }
  return stripped;
}

/** A value from `process.env`, where the runtime has one. Empty counts as unset. */
function env(name: "HAAU3_API_KEY" | "HAAU3_BASE_URL" | "HAAU3_ENVIRONMENT"): string | undefined {
  const g = globalThis as { process?: { env?: Record<string, string | undefined> } };
  return g.process?.env?.[name] || undefined;
}

/**
 * An environment, refused unless it is one of the two. The variable is read trimmed and in any case,
 * as a shell or an env file may write it; the option is typed and taken as it is. The value is never
 * repeated, since a variable set by mistake can hold anything.
 */
function checkedEnvironment(value: unknown, source: "environment" | "HAAU3_ENVIRONMENT"): Environment {
  const read = source === "HAAU3_ENVIRONMENT" && typeof value === "string" ? value.trim().toLowerCase() : value;
  if (read === "production" || read === "sandbox") return read;
  throw refusal("invalid-environment", `${source} takes "production" or "sandbox", and this is neither.`);
}

/**
 * The key, trimmed, from the option or else the variable, with where it came from; undefined when
 * there is none. A value that is not a string, or that carries anything before its `haau3_sk_`
 * prefix (quotes an env file kept, or "Bearer "), is refused, naming only where it came from.
 */
function keyOf(options: ClientOptions): { key: string | undefined; from: "apiKey" | "HAAU3_API_KEY" } {
  const from = options.apiKey !== undefined && options.apiKey !== null ? "apiKey" : "HAAU3_API_KEY";
  const given: unknown = from === "apiKey" ? options.apiKey : env("HAAU3_API_KEY");
  if (given !== undefined && typeof given !== "string") throw refusal("invalid-api-key", `${from} takes a string.`);
  const key = (given ?? "").trim();
  if (key.indexOf("haau3_sk_") > 0) {
    throw refusal("api-key-not-alone", `The key in ${from} has something before its haau3_sk_ prefix, such as quotes or "Bearer ". Set the key alone.`);
  }
  return { key: key || undefined, from };
}

/** The environment whose own address a base URL is, by its origin, or undefined for any other host. */
function environmentAt(baseURL: string): Environment | undefined {
  const origin = new URL(baseURL).origin;
  return (Object.keys(ENVIRONMENTS) as Environment[]).find((name) => new URL(ENVIRONMENTS[name]).origin === origin);
}

const ADDRESS_OF: Readonly<Record<Environment, string>> = {
  production: "production's address, https://api.haau3.com",
  sandbox: "the Sandbox's address, https://sandbox.haau3.com",
};
const NAMED: Readonly<Record<Environment, string>> = { production: "production", sandbox: "the Sandbox" };

/** A key's mode, from its prefix alone: the API checks the rest. */
type KeyMode = "live" | "test" | "older";
function keyModeOf(key: string): KeyMode {
  if (key.startsWith("haau3_sk_test_")) return "test";
  if (key.startsWith("haau3_sk_live_")) return "live";
  return "older";
}

/**
 * What the client says when it has no key: both ways to give one, where one comes from, and the
 * Sandbox's way to call with none.
 */
const NO_KEY =
  "No API key. Set HAAU3_API_KEY, or pass it as new Haau3({ apiKey }). Create a free key at " +
  "https://platform.haau3.com (see https://docs.haau3.com/authentication). To call the Sandbox " +
  'with no key, set HAAU3_ENVIRONMENT=sandbox, or pass new Haau3({ environment: "sandbox" }).';

/**
 * Why a key and a named environment cannot go together, or nothing when they can. The key is named by
 * where it came from and its kind, never by its value, and the way to call with no key is the one its
 * source needs.
 */
function mismatch(mode: KeyMode, keyFrom: "apiKey" | "HAAU3_API_KEY", environment: Environment, namedIn: string): Haau3Error | undefined {
  const withNoKey = keyFrom === "HAAU3_API_KEY" ? "unset HAAU3_API_KEY to call it with no key" : "pass no key to call it with none";
  if (environment === "production" && mode === "test") {
    return refusal(
      "test-key-outside-sandbox",
      `The key in ${keyFrom} is a test key (haau3_sk_test_…), which works only in the Sandbox, and ${namedIn} names production. Use a live key there, or name the Sandbox.`,
    );
  }
  if (environment === "sandbox" && mode === "live") {
    return refusal(
      "live-key-in-sandbox",
      `The key in ${keyFrom} is a live key (haau3_sk_live_…), which does not work in the Sandbox, and ${namedIn} names the Sandbox. Use a test key there, or ${withNoKey}.`,
    );
  }
  if (environment === "sandbox" && mode === "older") {
    return refusal(
      "older-key-in-sandbox",
      `The key in ${keyFrom} was made before test and live keys, so it does not work in the Sandbox, and ${namedIn} names the Sandbox. Create a test key at https://platform.haau3.com, or ${withNoKey}.`,
    );
  }
  return undefined;
}

/**
 * The Sandbox's first address, which its own host does not serve: there, an operation of the first
 * address goes to the same operation at production's path, which answers it the same way.
 */
const FIRST_ADDRESS = "/v1/sandbox/fhir/r4";

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

/**
 * Appends a query to a URL's parameters: a list sends the parameter once per value, and `undefined`
 * or `null` sends none (code that is not typed can pass a `null`, which would otherwise go out as the
 * text "null").
 */
export function appendQuery(params: URLSearchParams, query: Record<string, QueryValue> | undefined): void {
  for (const [name, value] of Object.entries(query ?? {}) as [string, unknown][]) {
    if (value === undefined || value === null) continue;
    for (const item of Array.isArray(value) ? (value as unknown[]) : [value]) {
      if (item !== undefined && item !== null) params.append(name, String(item));
    }
  }
}

/** What came with an answer, for {@link judge}. */
export interface AnswerContext {
  requestId: string | undefined;
  /** The `X-Correlation-Id` the answer came back with. */
  correlationId?: string | undefined;
  /** The status's text the answer came with; unset or empty means the standard one. */
  statusText?: string | undefined;
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
  /** The request carried no key, so a 401 says that rather than that a key was refused. */
  noKey?: boolean;
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
): { ok: true; data: T } | { ok: false; error: AuthError | ForbiddenError | RefusedError | NoAnswerError } {
  const { requestId, attempts, durationMs, expects } = context;
  const timing = { attempts, durationMs, correlationId: context.correlationId, statusText: statusTextOf(status, context.statusText) };
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
  if (status === 401 && !context.entry) {
    return {
      ok: false,
      error: new AuthError(
        `${name} was refused: ${context.noKey ? "it was sent with no API key" : "the API key was not accepted"} (401).`,
        status,
        requestId,
        errorBody,
        timing,
      ),
    };
  }
  if (status === 403 && !context.entry) {
    const code = apiErrorCode(errorBody);
    const why = (code !== undefined && FORBIDDEN_REASONS[code]) || FORBIDDEN_GENERAL;
    return {
      ok: false,
      error: new ForbiddenError(`${name} was refused: ${why} (403).`, status, requestId, errorBody, timing),
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
  readonly #apiKey: string | undefined;
  /** Whether requests go to the Sandbox's own host, which does not serve its first address. */
  readonly #onTheSandboxHost: boolean;
  readonly #fetch: typeof fetch;
  readonly #fetchOptions: FetchOptions;
  readonly #noStoreTaken: boolean;
  /** The SDK's User-Agent, with the caller's `appInfo` after it. */
  readonly #userAgent: string;
  /** Where requests go. */
  readonly baseURL: string;
  /** The environment the client calls: the one named, else the key's mode. */
  readonly environment: Environment;
  /** Milliseconds one attempt may take. */
  readonly timeout: number;
  /** How many times a request is retried. */
  readonly maxRetries: number;

  constructor(options: ClientOptions = {}) {
    if (inBrowser()) {
      throw refusal("in-browser",
        "@haau3/sdk runs on a server only: an API key in a browser is public. Call the API from your server.",
      );
    }
    const { key: apiKey, from: keyFrom } = keyOf(options);
    const namedIn = options.environment !== undefined ? "environment" : "HAAU3_ENVIRONMENT";
    // The variable is read only when no option names the environment, so a stray one never stops a
    // client that says what it calls.
    const fromEnvironment = options.environment === undefined ? env("HAAU3_ENVIRONMENT") : undefined;
    const named =
      options.environment !== undefined
        ? checkedEnvironment(options.environment, "environment")
        : fromEnvironment !== undefined
          ? checkedEnvironment(fromEnvironment, "HAAU3_ENVIRONMENT")
          : undefined;
    if (apiKey === undefined && named !== "sandbox") throw refusal("no-api-key", NO_KEY);
    const mode = apiKey === undefined ? undefined : keyModeOf(apiKey);
    const refused = mode !== undefined && named !== undefined ? mismatch(mode, keyFrom, named, namedIn) : undefined;
    if (refused !== undefined) throw refused;
    const fetchImpl = options.fetch ?? (globalThis as { fetch?: typeof fetch }).fetch;
    if (!fetchImpl) throw refusal("no-fetch", "No fetch: pass one as the fetch option. Node 22 and newer have one.");
    this.#apiKey = apiKey;
    this.#fetch = fetchImpl;
    this.#fetchOptions = options.fetchOptions ?? {};
    this.#noStoreTaken = cacheFieldTaken();
    const chosen = named ?? (mode === "test" ? "sandbox" : "production");
    const fromEnv = env("HAAU3_BASE_URL");
    const baseFrom = options.baseURL !== undefined ? "baseURL" : "HAAU3_BASE_URL";
    this.baseURL =
      options.baseURL !== undefined
        ? checkedBaseURL(options.baseURL, "baseURL")
        : fromEnv !== undefined
          ? checkedBaseURL(fromEnv, "HAAU3_BASE_URL")
          : ENVIRONMENTS[chosen];
    // A base URL that is one environment's own address is that environment. A named environment
    // must agree with it, and the Sandbox's address takes test keys only. Production's still takes a
    // test key, at the Sandbox's first address, until that address goes.
    const at = environmentAt(this.baseURL);
    if (at !== undefined && named !== undefined && named !== at) {
      throw refusal("environment-conflicts-with-base-url", `${namedIn} names ${NAMED[named]}, and ${baseFrom} is ${ADDRESS_OF[at]}. Name one environment, or a base URL that is neither's.`);
    }
    if (at === "sandbox" && mode !== undefined && mode !== "test") {
      const kind = mode === "live" ? "is a live key (haau3_sk_live_…)" : "was made before test and live keys";
      throw refusal(
        mode === "live" ? "live-key-in-sandbox" : "older-key-in-sandbox",
        `The key in ${keyFrom} ${kind}, and ${baseFrom} is ${ADDRESS_OF.sandbox}, which takes test keys only. Use a test key there.`,
      );
    }
    this.environment = at ?? chosen;
    // The Sandbox's own host, which does not serve its first address: its address, or a stand-in
    // named with the Sandbox as the environment.
    this.#onTheSandboxHost = at === "sandbox" || (at === undefined && named === "sandbox");
    this.#userAgent = userAgentOf(options.appInfo);
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
      statusText: statusTextOf(sent.response.status, sent.response.statusText),
      headers: sent.response.headers,
      body: parseBody(sent.text, sent.response.headers.get("content-type")) ?? sent.text,
      requestId: sent.response.headers.get("x-request-id") ?? undefined,
      correlationId: sent.response.headers.get("x-correlation-id") ?? undefined,
      attempts: sent.attempts,
      durationMs: sent.durationMs,
    };
  }

  /**
   * Sends a GET to a path on the API and returns its answer, or throws the errors every operation's
   * own method throws: {@link AuthError}, {@link ForbiddenError}, {@link RefusedError} or
   * {@link NoAnswerError}. For an operation this version of the SDK has no method for, or one you
   * call by its path. Its `.withResponse()` gives the request id and timing too.
   *
   * ```ts
   * const practitioner = await haau3.get("/v1/fhir/r4/Practitioner/{id}", {
   *   pathParams: { id: "Practitioner-1093209884" },
   *   expects: ["Practitioner"],
   * });
   * ```
   */
  get<T = unknown>(path: string, options: CallOptions = {}): APIPromise<T> {
    return this.#call<T>("GET", path, options);
  }

  /**
   * Sends a POST to a path on the API, with a body, and returns its answer or throws, as
   * {@link Transport.get} does.
   *
   * ```ts
   * const dosage = await haau3.post("/v1/fhir/r4/$structure-dosage", { body: parameters, expects: ["Parameters"] });
   * ```
   */
  post<T = unknown>(path: string, options: PostOptions = {}): APIPromise<T> {
    return this.#call<T>("POST", path, options);
  }

  #call<T>(method: "GET" | "POST", path: string, options: PostOptions): APIPromise<T> {
    const { pathParams, query, expects, body, ...callOptions } = options;
    try {
      checkPathParams(method, path, pathParams);
    } catch (error) {
      return new APIPromise<T>(Promise.reject(error));
    }
    return this.operation<T>({ method, path, pathParams, query, body, expects }, callOptions);
  }

  /**
   * Runs one operation of the spec and returns its answer, or throws one of the three errors. The
   * answer's `.withResponse()` gives its request id and timing too.
   */
  protected operation<T>(call: OperationCall, options: RequestOptions = {}): APIPromise<T> {
    const label =
      this.#onTheSandboxHost && call.path.startsWith(`${FIRST_ADDRESS}/`)
        ? `/v1/fhir/r4${call.path.slice(FIRST_ADDRESS.length)}`
        : call.path;
    let path = label;
    for (const [name, value] of Object.entries(call.pathParams ?? {})) {
      path = path.replace(`{${name}}`, encodeURIComponent(value));
    }
    // A URL that cannot be made rejects the call rather than throwing at it. The request itself
    // starts now, as the call is made, so an abort right after it reaches the fetch.
    let url: URL;
    let declared: Record<string, string>;
    try {
      url = this.#url(path, call.query as Record<string, QueryValue>);
      declared = declaredHeaders(call, options);
    } catch (error) {
      return new APIPromise<T>(Promise.reject(error));
    }
    return new APIPromise(this.respond<T>(call.method, url, call.body, options, label, call.expects, declared));
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
    declared?: Record<string, string>,
  ): Promise<WithResponse<T>> {
    const sent = await this.#send(method, url, body, options, label, declared);
    const { response, text, attempts, durationMs } = sent;
    const status = response.status;
    const requestId = response.headers.get("x-request-id") ?? undefined;
    const correlationId = response.headers.get("x-correlation-id") ?? undefined;
    const verdict = judge<T>(`${method} ${label}`, status, parseBody(text, response.headers.get("content-type")), {
      requestId,
      correlationId,
      statusText: response.statusText,
      attempts,
      durationMs,
      retryAfter: retryAfterSeconds(response.headers),
      expects,
      missing: "a body that is not JSON",
      noKey: this.#apiKey === undefined,
    });
    if (!verdict.ok) throw verdict.error;
    const statusText = statusTextOf(status, response.statusText);
    return { data: verdict.data, requestId, correlationId, durationMs, attempts, status, statusText, headers: response.headers };
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
      const what = this.#apiKey === undefined ? "a request" : "the API key";
      throw new Haau3Error(`Refusing to send ${what} to ${url.origin}: the client's baseURL is ${base.origin}.`);
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
    declared: Record<string, string> = {},
  ): Promise<Sent> {
    // The path after the base's own, so a baseURL with a path of its own still asks for FHIR JSON.
    const basePath = new URL(this.baseURL).pathname.replace(/\/$/, "");
    const path = basePath && url.pathname.startsWith(basePath) ? url.pathname.slice(basePath.length) : url.pathname;
    const fhir = speaksFHIR(path);
    const headers: Record<string, string> = {
      accept: fhir ? FHIR_JSON : "application/json",
      ...(this.#apiKey === undefined ? {} : { authorization: `Bearer ${this.#apiKey}` }),
      "user-agent": this.#userAgent,
    };
    let payload: string | undefined;
    if (body !== undefined) {
      payload = typeof body === "string" ? body : JSON.stringify(body);
      headers["content-type"] = fhir ? FHIR_JSON : "application/json";
    }
    for (const [name, value] of Object.entries(options.headers ?? {})) headers[name.toLowerCase()] = value;
    // A header the operation declares is sent from its own option, over the same header in `headers`.
    Object.assign(headers, declared);
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
          detail: failureDetail(error),
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
