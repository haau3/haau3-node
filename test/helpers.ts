import { readFileSync } from "node:fs";

export const KEY = "haau3_sk_test_key_that_must_never_be_printed";

/** One request the fake fetch received, as the API would see it. */
export interface Received {
  url: URL;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
  signal: AbortSignal | undefined;
}

/** A fetch that records each request and answers with `answer`. */
export function fakeFetch(answer: (request: Received, count: number) => Response | Promise<Response>) {
  const received: Received[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const request: Received = {
      url: new URL(String(input)),
      method: init?.method ?? "GET",
      headers: Object.fromEntries(new Headers(init?.headers).entries()),
      body: typeof init?.body === "string" ? init.body : undefined,
      signal: init?.signal ?? undefined,
    };
    received.push(request);
    return answer(request, received.length);
  }) as typeof globalThis.fetch;
  return { fetch, received };
}

export const FHIR_JSON = "application/fhir+json; fhirVersion=4.0";

export function answer(body: unknown, status = 200, headers: Record<string, string> = {}, type = "application/json") {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": type, "x-request-id": "6b1f3c2e-4d5a-4b6c-8d7e-9f0a1b2c3d4e", ...headers },
  });
}

export const fhirAnswer = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  answer(body, status, headers, FHIR_JSON);

/** The pinned spec the SDK is generated from. */
export const spec = JSON.parse(readFileSync(new URL("../openapi/openapi.json", import.meta.url), "utf8")) as {
  info: { version: string };
  paths: Record<string, Record<string, any>>;
};
