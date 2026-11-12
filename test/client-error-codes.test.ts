// Why a client could not be made, as a code: every refusal `new Haau3()` raises before anything is
// sent carries one, so a caller branches on the code and never on the message. The messages are the
// ones the client gave before the codes, and refusals raised by a call carry none.
import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError, Haau3, Haau3Error, type ClientErrorCode } from "../src/index.js";
import { KEY, TEST_KEY, answer, fakeFetch, fhirAnswer } from "./helpers.js";

/** A key made before test and live keys: no mode in its prefix. */
const OLDER_KEY = "haau3_sk_older_key_that_must_never_be_printed";
const SANDBOX = "https://sandbox.haau3.com";
const { fetch } = fakeFetch(() => fhirAnswer({ resourceType: "CapabilityStatement" }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

/** What a construction threw. */
function refusal(make: () => unknown): Haau3Error {
  try {
    make();
  } catch (error) {
    expect(error).toBeInstanceOf(Haau3Error);
    return error as Haau3Error;
  }
  throw new Error("the client was made");
}

type Case = { name: string; code: ClientErrorCode; make: () => unknown; message?: string | RegExp };

/** One construction per way a client can be refused, each with the code it must carry. */
const CASES: Case[] = [
  {
    name: "no key, and the Sandbox not named",
    code: "no-api-key",
    make: () => {
      vi.stubEnv("HAAU3_API_KEY", "");
      return new Haau3({ fetch });
    },
    message: /^No API key\. Set HAAU3_API_KEY, or pass it as new Haau3\(\{ apiKey \}\)\./,
  },
  { name: "a key that is not a string", code: "invalid-api-key", make: () => new Haau3({ fetch, apiKey: 42 as unknown as string }), message: "apiKey takes a string." },
  {
    name: "quotes an env file kept around the key",
    code: "api-key-not-alone",
    make: () => new Haau3({ fetch, apiKey: `"${KEY}"` }),
    message: 'The key in apiKey has something before its haau3_sk_ prefix, such as quotes or "Bearer ". Set the key alone.',
  },
  { name: "Bearer before the key, from the variable", code: "api-key-not-alone", make: () => (vi.stubEnv("HAAU3_API_KEY", `Bearer ${KEY}`), new Haau3({ fetch })), message: /^The key in HAAU3_API_KEY / },
  {
    name: "a test key with production named",
    code: "test-key-outside-sandbox",
    make: () => new Haau3({ fetch, apiKey: TEST_KEY, environment: "production" }),
    message:
      "The key in apiKey is a test key (haau3_sk_test_…), which works only in the Sandbox, and environment names production. Use a live key there, or name the Sandbox.",
  },
  {
    name: "a test key with HAAU3_ENVIRONMENT naming production",
    code: "test-key-outside-sandbox",
    make: () => (vi.stubEnv("HAAU3_ENVIRONMENT", "production"), new Haau3({ fetch, apiKey: TEST_KEY })),
    message: /and HAAU3_ENVIRONMENT names production/,
  },
  { name: "a live key with the Sandbox named", code: "live-key-in-sandbox", make: () => new Haau3({ fetch, apiKey: KEY, environment: "sandbox" }), message: /is a live key \(haau3_sk_live_…\)/ },
  { name: "a live key at the Sandbox's address", code: "live-key-in-sandbox", make: () => new Haau3({ fetch, apiKey: KEY, baseURL: SANDBOX }), message: /which takes test keys only/ },
  { name: "an older key with the Sandbox named", code: "older-key-in-sandbox", make: () => new Haau3({ fetch, apiKey: OLDER_KEY, environment: "sandbox" }), message: /was made before test and live keys/ },
  { name: "an older key at the Sandbox's address", code: "older-key-in-sandbox", make: () => new Haau3({ fetch, apiKey: OLDER_KEY, baseURL: SANDBOX }), message: /which takes test keys only/ },
  {
    name: "an environment that is neither",
    code: "invalid-environment",
    make: () => new Haau3({ fetch, apiKey: KEY, environment: "staging" as unknown as "sandbox" }),
    message: 'environment takes "production" or "sandbox", and this is neither.',
  },
  { name: "HAAU3_ENVIRONMENT that is neither", code: "invalid-environment", make: () => (vi.stubEnv("HAAU3_ENVIRONMENT", "staging"), new Haau3({ fetch, apiKey: KEY })), message: /^HAAU3_ENVIRONMENT takes/ },
  { name: "a base URL that is not http or https", code: "invalid-base-url", make: () => new Haau3({ fetch, apiKey: KEY, baseURL: "ftp://api.example.com" }), message: /^baseURL takes an http or https URL/ },
  { name: "HAAU3_BASE_URL with a query", code: "invalid-base-url", make: () => (vi.stubEnv("HAAU3_BASE_URL", "https://proxy.example.com/?a=1"), new Haau3({ fetch, apiKey: KEY })), message: /^HAAU3_BASE_URL takes/ },
  {
    name: "production named with the Sandbox's address",
    code: "environment-conflicts-with-base-url",
    make: () => new Haau3({ fetch, apiKey: KEY, environment: "production", baseURL: SANDBOX }),
    message: "environment names production, and baseURL is the Sandbox's address, https://sandbox.haau3.com. Name one environment, or a base URL that is neither's.",
  },
  { name: "an appInfo name with a space", code: "invalid-app-info", make: () => new Haau3({ fetch, apiKey: KEY, appInfo: { name: "my plugin" } }), message: /^appInfo\.name takes/ },
  { name: "an appInfo with an unknown field", code: "invalid-app-info", make: () => new Haau3({ fetch, apiKey: KEY, appInfo: { name: "a", partner: "b" } as never }), message: /^appInfo takes name, version and url only/ },
  {
    name: "no fetch in the runtime and none passed",
    code: "no-fetch",
    make: () => (vi.stubGlobal("fetch", undefined), new Haau3({ apiKey: KEY })),
    message: "No fetch: pass one as the fetch option. Node 22 and newer have one.",
  },
  {
    name: "a client made in a browser",
    code: "in-browser",
    make: () => {
      vi.stubGlobal("window", {});
      vi.stubGlobal("document", {});
      vi.stubGlobal("navigator", { userAgent: "Mozilla/5.0 (Macintosh) Chrome/141.0" });
      return new Haau3({ fetch, apiKey: KEY });
    },
    message: /^@haau3\/sdk runs on a server only/,
  },
];

/** Every code the type lists has a case above: a code with none fails to compile here. */
const COVERED = ["no-api-key", "invalid-api-key", "api-key-not-alone", "test-key-outside-sandbox", "live-key-in-sandbox", "older-key-in-sandbox", "invalid-environment", "invalid-base-url", "environment-conflicts-with-base-url", "invalid-app-info", "no-fetch", "in-browser"] as const satisfies readonly ClientErrorCode[];
type Uncovered = Exclude<ClientErrorCode, (typeof COVERED)[number]>;
const everyCodeCovered: Uncovered extends never ? true : Uncovered = true;
void everyCodeCovered;

describe("a client that cannot be made", () => {
  it("has a case for every code, and every code is a case's", () => {
    expect(new Set(CASES.map((c) => c.code))).toEqual(new Set(COVERED));
  });

  for (const c of CASES) {
    it(`is refused with ${c.code}: ${c.name}`, () => {
      const error = refusal(c.make);
      expect(error.code).toBe(c.code);
      expect(error.name).toBe("Haau3Error");
      if (typeof c.message === "string") expect(error.message).toBe(c.message);
      else if (c.message) expect(error.message).toMatch(c.message);
    });
  }

  it("carries the code where a log reads it, and never the key", () => {
    for (const c of CASES) {
      const error = refusal(c.make);
      expect(error.toJSON()).toEqual({ name: "Haau3Error", message: error.message, code: c.code });
      expect(JSON.stringify(error)).toContain(`"code":"${c.code}"`);
      expect(inspect(error)).toContain(`code: '${c.code}'`);
      for (const text of [error.message, JSON.stringify(error), inspect(error)]) {
        expect(text).not.toContain("key_that_must_never_be_printed");
      }
      vi.unstubAllEnvs();
      vi.unstubAllGlobals();
    }
  });

  it("adds no request fields, since nothing was sent", () => {
    const error = refusal(() => new Haau3({ fetch, apiKey: KEY, environment: "sandbox" }));
    expect(Object.keys(error)).not.toContain("requestId");
    expect(Object.keys(error)).not.toContain("correlationId");
  });
});

describe("what keeps no code", () => {
  it("a refusal raised by a call, after the client was made", async () => {
    const haau3 = new Haau3({ fetch, apiKey: KEY });
    const error = await haau3.fhirMetadata({}, { correlationId: "not-a-uuid" }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Haau3Error);
    expect((error as Haau3Error).code).toBeUndefined();
    expect(Object.keys(error as object)).not.toContain("code");
    expect((error as Haau3Error).toJSON()).not.toHaveProperty("code");
  });

  it("an error made with no code prints none", () => {
    const error = new Haau3Error("made by hand");
    expect(error.code).toBeUndefined();
    expect(inspect(error)).not.toMatch(/code:/);
    expect(error.toJSON()).toEqual({ name: "Haau3Error", message: "made by hand" });
  });

  it("a 403 still carries the API's own code, not a client's", async () => {
    const { fetch: refusing } = fakeFetch(() =>
      fhirAnswer(
        {
          resourceType: "OperationOutcome",
          issue: [{ severity: "error", code: "forbidden", details: { coding: [{ system: "https://haau3.com/fhir/CodeSystem/api-error", code: "phi-agreement-required" }] } }],
        },
        403,
      ),
    );
    const error = await new Haau3({ fetch: refusing, apiKey: KEY }).fhirMetadata().then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(ForbiddenError);
    expect((error as ForbiddenError).code).toBe("phi-agreement-required");
  });

  it("a client that was made", () => {
    const made = new Haau3({ fetch: fakeFetch(() => answer({})).fetch, environment: "sandbox" });
    expect(made.environment).toBe("sandbox");
  });
});
