// Which environment a client calls, and with which key: the key's mode picks the host, no key is
// allowed only in the Sandbox, a mismatch is refused before anything is sent, and an explicit base URL
// still decides where requests go.
import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Haau3, Haau3Error } from "../src/index.js";
import { KEY, TEST_KEY, answer, fakeFetch, fhirAnswer } from "./helpers.js";

/** A key made before test and live keys: no mode in its prefix. */
const OLDER_KEY = "haau3_sk_older_key_that_must_never_be_printed";
const PRODUCTION = "https://api.haau3.com";
const SANDBOX = "https://sandbox.haau3.com";

afterEach(() => {
  vi.unstubAllEnvs();
});

/** A client on a recording fetch that answers every request, and what it received. */
function recorded(options: ConstructorParameters<typeof Haau3>[0] = {}) {
  const { fetch, received } = fakeFetch((request) =>
    request.url.pathname.startsWith("/v1/scheduling/") ? answer({ publishers: [] }) : fhirAnswer({ resourceType: "CapabilityStatement" }),
  );
  return { haau3: new Haau3({ fetch, ...options }), received };
}

/** What a construction threw, so a test reads its message and its fields. */
function refusal(make: () => unknown): Haau3Error {
  try {
    make();
  } catch (error) {
    expect(error).toBeInstanceOf(Haau3Error);
    return error as Haau3Error;
  }
  throw new Error("the client was made");
}

describe("the key's mode picks the host", () => {
  it("sends every call on a test key to the Sandbox, and none to production", async () => {
    const { haau3, received } = recorded({ apiKey: TEST_KEY });
    expect(haau3.environment).toBe("sandbox");
    expect(haau3.baseURL).toBe(SANDBOX);
    await haau3.listPublishers();
    await haau3.fhirMetadata();
    expect(received.map((r) => r.url.origin)).toEqual([SANDBOX, SANDBOX]);
    expect(received[0]!.headers.authorization).toBe(`Bearer ${TEST_KEY}`);
  });

  it("sends a live key, and a key made before modes, to production", async () => {
    for (const apiKey of [KEY, OLDER_KEY]) {
      const { haau3, received } = recorded({ apiKey });
      expect(haau3.environment).toBe("production");
      expect(haau3.baseURL).toBe(PRODUCTION);
      await haau3.listPublishers();
      expect(received[0]!.url.origin).toBe(PRODUCTION);
    }
  });

  it("reads the key's mode from HAAU3_API_KEY too", () => {
    vi.stubEnv("HAAU3_API_KEY", TEST_KEY);
    expect(recorded().haau3.baseURL).toBe(SANDBOX);
  });
});

describe("no key", () => {
  it("calls the Sandbox with no Authorization header when the environment names it", async () => {
    vi.stubEnv("HAAU3_API_KEY", "");
    const { haau3, received } = recorded({ environment: "sandbox" });
    expect(haau3.environment).toBe("sandbox");
    expect(haau3.baseURL).toBe(SANDBOX);
    await haau3.fhirMetadata();
    expect(received[0]!.url.origin).toBe(SANDBOX);
    expect(received[0]!.headers).not.toHaveProperty("authorization");
  });

  it("takes the Sandbox from HAAU3_ENVIRONMENT, and an empty apiKey as none", async () => {
    vi.stubEnv("HAAU3_ENVIRONMENT", "sandbox");
    const { haau3, received } = recorded({ apiKey: "" });
    await haau3.fhirMetadata();
    expect(received[0]!.url.origin).toBe(SANDBOX);
    expect(received[0]!.headers).not.toHaveProperty("authorization");
  });

  it("is refused before any request with production named, or nothing named", () => {
    vi.stubEnv("HAAU3_API_KEY", "");
    const { fetch, received } = fakeFetch(() => answer({}));
    for (const options of [{}, { environment: "production" as const }, { baseURL: "http://localhost:3001" }]) {
      const error = refusal(() => new Haau3({ fetch, ...options }));
      expect(error.message).toContain("No API key. Set HAAU3_API_KEY, or pass it as new Haau3({ apiKey }).");
      expect(error.message).toContain("https://platform.haau3.com");
      expect(error.message).toContain('new Haau3({ environment: "sandbox" })');
      expect(error.message).toContain("HAAU3_ENVIRONMENT=sandbox");
    }
    expect(received).toHaveLength(0);
  });

  // Issue: an error raised before anything was sent printed `requestId: undefined` and
  // `correlationId: undefined`, which read as if a request had failed.
  it("says so in its message alone, with no request fields, since nothing was sent", () => {
    vi.stubEnv("HAAU3_API_KEY", "");
    const error = refusal(() => new Haau3());
    expect(Object.keys(error)).not.toContain("requestId");
    expect(Object.keys(error)).not.toContain("correlationId");
    expect(inspect(error)).not.toMatch(/requestId|correlationId/);
    expect(error.toJSON()).toEqual({ name: "Haau3Error", message: error.message });
    // The control: an error the API answered still carries its request id.
    const answered = new Haau3Error("answered", "6b1f3c2e-4d5a-4b6c-8d7e-9f0a1b2c3d4e", { correlationId: "a" });
    expect(Object.keys(answered)).toEqual(expect.arrayContaining(["requestId", "correlationId"]));
  });
});

describe("a key of the other mode", () => {
  const { fetch, received } = fakeFetch(() => answer({}));

  it.each([
    ["a test key with production named", { apiKey: TEST_KEY, environment: "production" as const }, /^The key in apiKey is a test key \(haau3_sk_test_…\), which works only in the Sandbox, and environment names production\. Use a live key there, or name the Sandbox\.$/],
    ["a live key with the Sandbox named", { apiKey: KEY, environment: "sandbox" as const }, /^The key in apiKey is a live key \(haau3_sk_live_…\), which does not work in the Sandbox, and environment names the Sandbox\. Use a test key there, or pass no key to call it with none\.$/],
    ["a key made before modes with the Sandbox named", { apiKey: OLDER_KEY, environment: "sandbox" as const }, /^The key in apiKey was made before test and live keys, so it does not work in the Sandbox/],
  ])("is refused before any request: %s", (_, options, message) => {
    const error = refusal(() => new Haau3({ fetch, ...options }));
    expect(error.message).toMatch(message);
    for (const key of [KEY, TEST_KEY, OLDER_KEY]) expect(inspect(error, { showHidden: true }) + JSON.stringify(error)).not.toContain(key);
    expect(received).toHaveLength(0);
  });

  it("names HAAU3_ENVIRONMENT when that is where the environment came from", () => {
    vi.stubEnv("HAAU3_ENVIRONMENT", "sandbox");
    expect(refusal(() => new Haau3({ fetch, apiKey: KEY })).message).toContain("and HAAU3_ENVIRONMENT names the Sandbox");
  });

  it("names HAAU3_API_KEY when that is where the key came from, and says to unset it to call with none", () => {
    vi.stubEnv("HAAU3_API_KEY", KEY);
    expect(refusal(() => new Haau3({ fetch, environment: "sandbox" })).message).toBe(
      "The key in HAAU3_API_KEY is a live key (haau3_sk_live_…), which does not work in the Sandbox, and environment names " +
        "the Sandbox. Use a test key there, or unset HAAU3_API_KEY to call it with no key.",
    );
  });

  it("takes the environment option over HAAU3_ENVIRONMENT", () => {
    vi.stubEnv("HAAU3_ENVIRONMENT", "sandbox");
    expect(new Haau3({ fetch, apiKey: KEY, environment: "production" }).environment).toBe("production");
  });

  it("goes together with a key of the same mode (the control)", () => {
    expect(new Haau3({ fetch, apiKey: TEST_KEY, environment: "sandbox" }).baseURL).toBe(SANDBOX);
    expect(new Haau3({ fetch, apiKey: KEY, environment: "production" }).baseURL).toBe(PRODUCTION);
    expect(new Haau3({ fetch, apiKey: OLDER_KEY, environment: "production" }).baseURL).toBe(PRODUCTION);
  });
});

describe("an environment that is neither", () => {
  it("is refused by the name it came in, without repeating it", () => {
    const { fetch } = fakeFetch(() => answer({}));
    const fromOption = refusal(() => new Haau3({ fetch, apiKey: KEY, environment: "staging" as never }));
    expect(fromOption.message).toBe('environment takes "production" or "sandbox", and this is neither.');
    vi.stubEnv("HAAU3_ENVIRONMENT", TEST_KEY);
    const fromVariable = refusal(() => new Haau3({ fetch, apiKey: KEY }));
    expect(fromVariable.message).toBe('HAAU3_ENVIRONMENT takes "production" or "sandbox", and this is neither.');
    expect(fromVariable.message).not.toContain(TEST_KEY);
  });
});

describe("an explicit base URL", () => {
  it("decides where requests go, whatever the key's mode", async () => {
    const { haau3, received } = recorded({ apiKey: TEST_KEY, baseURL: "http://localhost:3001" });
    expect(haau3.environment).toBe("sandbox");
    await haau3.listPublishers();
    expect(received[0]!.url.origin).toBe("http://localhost:3001");
  });

  it("wins from HAAU3_BASE_URL too", async () => {
    vi.stubEnv("HAAU3_BASE_URL", "http://localhost:3001");
    const { haau3 } = recorded({ apiKey: TEST_KEY });
    expect(haau3.baseURL).toBe("http://localhost:3001");
  });

  it("still keeps the environment's rules for the key", () => {
    const { fetch } = fakeFetch(() => answer({}));
    expect(refusal(() => new Haau3({ fetch, apiKey: KEY, environment: "sandbox", baseURL: "http://localhost:3001" })).message).toMatch(
      /^The key in apiKey is a live key/,
    );
    vi.stubEnv("HAAU3_API_KEY", "");
    const sandbox = new Haau3({ fetch, environment: "sandbox", baseURL: "http://localhost:3001" });
    expect(sandbox.baseURL).toBe("http://localhost:3001");
  });
});

describe("the first address's deprecated methods", () => {
  const message = { resourceType: "Bundle", type: "message" };
  const bundle = () => fakeFetch(() => fhirAnswer({ resourceType: "Bundle", type: "message" }));

  it("call the same operations at production's paths on the Sandbox's own host, with their headers", async () => {
    const { fetch, received } = bundle();
    const haau3 = new Haau3({ fetch, apiKey: TEST_KEY });
    await haau3.sandboxProcessMessage(message as never, { payerAuthorization: "Bearer abc" });
    expect(received[0]!.method).toBe("POST");
    expect(received[0]!.url.href).toBe(`${SANDBOX}/v1/fhir/r4/$process-message`);
    expect(received[0]!.headers["payer-authorization"]).toBe("Bearer abc");
    const metadata = fakeFetch(() => fhirAnswer({ resourceType: "CapabilityStatement" }));
    await new Haau3({ fetch: metadata.fetch, apiKey: TEST_KEY }).sandboxMetadata();
    expect(metadata.received[0]!.url.href).toBe(`${SANDBOX}/v1/fhir/r4/metadata`);
  });

  it("do the same with no key, and on a stand-in named with the Sandbox as the environment", async () => {
    vi.stubEnv("HAAU3_API_KEY", "");
    for (const [options, origin] of [
      [{ environment: "sandbox" as const }, SANDBOX],
      [{ environment: "sandbox" as const, baseURL: "http://localhost:3001" }, "http://localhost:3001"],
    ] as const) {
      const { fetch, received } = bundle();
      await new Haau3({ fetch, ...options }).sandboxProcessMessage(message as never);
      expect(received[0]!.url.href).toBe(`${origin}/v1/fhir/r4/$process-message`);
    }
  });

  it("keep the first address for a live key, a key made before modes, and a base URL with no environment named", async () => {
    for (const options of [{ apiKey: KEY }, { apiKey: OLDER_KEY }, { apiKey: TEST_KEY, baseURL: PRODUCTION }]) {
      const { fetch, received } = bundle();
      await new Haau3({ fetch, ...options }).sandboxProcessMessage(message as never);
      expect(received[0]!.url.href, JSON.stringify(Object.keys(options))).toBe(`${PRODUCTION}/v1/sandbox/fhir/r4/$process-message`);
    }
  });

  it("name the path they sent to when refused", async () => {
    const { fetch } = fakeFetch(() => fhirAnswer({ resourceType: "OperationOutcome", issue: [] }, 400));
    const refused = await new Haau3({ fetch, apiKey: TEST_KEY }).sandboxProcessMessage(message as never).catch((e: unknown) => e);
    expect((refused as Error).message).toBe("POST /v1/fhir/r4/$process-message was refused (400).");
  });

  it("leave request() as it is given (the control)", async () => {
    const { fetch, received } = bundle();
    await new Haau3({ fetch, apiKey: TEST_KEY }).request({ method: "POST", path: "/v1/sandbox/fhir/r4/$process-message", body: message });
    expect(received[0]!.url.href).toBe(`${SANDBOX}/v1/sandbox/fhir/r4/$process-message`);
  });
});

describe("a client with no key", () => {
  it("prints nothing of a key, and says where it sends", () => {
    vi.stubEnv("HAAU3_API_KEY", "");
    const haau3 = new Haau3({ environment: "sandbox", fetch: fakeFetch(() => answer({})).fetch });
    expect(inspect(haau3, { depth: 10, showHidden: true })).toContain(SANDBOX);
    expect(inspect(haau3, { depth: 10, showHidden: true })).not.toMatch(/Bearer|haau3_sk_/);
  });
});
