// Timeouts, retries, Retry-After and the per-call options.
import { describe, expect, it } from "vitest";
import { Haau3, NoAnswerError } from "../src/index.js";
import { KEY, answer, fakeFetch, fhirAnswer } from "./helpers.js";

const PLAN = { resourceType: "InsurancePlan", id: "H2406-013-000" };

describe("retries", () => {
  it("retries a 5xx once by default and returns the answer that followed", async () => {
    const { fetch, received } = fakeFetch((_, n) =>
      n === 1 ? fhirAnswer({ resourceType: "OperationOutcome", issue: [] }, 503) : fhirAnswer(PLAN),
    );
    const haau3 = new Haau3({ apiKey: KEY, fetch });
    await expect(haau3.readInsurancePlan("H2406-013-000")).resolves.toEqual(PLAN);
    expect(received).toHaveLength(2);
  });

  it("retries a network failure, a 429 and a timeout, and gives up after maxRetries", async () => {
    const network = fakeFetch(() => {
      throw new TypeError("fetch failed");
    });
    const error = await new Haau3({ apiKey: KEY, fetch: network.fetch })
      .readInsurancePlan("x")
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NoAnswerError);
    expect(error).toMatchObject({ reason: "network", attempts: 2 });
    expect(network.received).toHaveLength(2);

    const limited = fakeFetch(() => answer({ type: "x", status: 429 }, 429, { "retry-after": "0" }));
    await expect(new Haau3({ apiKey: KEY, fetch: limited.fetch }).listPublishers()).rejects.toMatchObject({
      reason: "rate-limited",
      status: 429,
      retryAfter: 0,
      attempts: 2,
    });
  });

  it("sends once with maxRetries 0, on the client or on one call", async () => {
    const failing = () => fakeFetch(() => fhirAnswer({ resourceType: "OperationOutcome", issue: [] }, 500));
    const a = failing();
    await expect(new Haau3({ apiKey: KEY, fetch: a.fetch, maxRetries: 0 }).readInsurancePlan("x")).rejects.toMatchObject({
      reason: "server-error",
      attempts: 1,
    });
    expect(a.received).toHaveLength(1);
    const b = failing();
    await expect(new Haau3({ apiKey: KEY, fetch: b.fetch }).readInsurancePlan("x", { maxRetries: 0 })).rejects.toMatchObject({
      attempts: 1,
    });
    expect(b.received).toHaveLength(1);
  });

  it("never retries an answer that refuses the request (the control)", async () => {
    const { fetch, received } = fakeFetch(() => fhirAnswer({ resourceType: "OperationOutcome", issue: [] }, 404));
    await expect(new Haau3({ apiKey: KEY, fetch }).readInsurancePlan("x")).rejects.toMatchObject({ status: 404 });
    expect(received).toHaveLength(1);
  });
});

describe("Retry-After", () => {
  it("waits out a short Retry-After", async () => {
    const { fetch, received } = fakeFetch((_, n) => (n === 1 ? answer({}, 503, { "retry-after": "1" }) : answer({ publishers: [] })));
    const started = Date.now();
    await expect(new Haau3({ apiKey: KEY, fetch }).listPublishers()).resolves.toEqual({ publishers: [] });
    expect(Date.now() - started).toBeGreaterThanOrEqual(950);
    expect(received).toHaveLength(2);
  });

  it("fails at once on one longer than 60 seconds, saying when to try again", async () => {
    // The Developer plan's monthly limit answers with the seconds until next month.
    const { fetch, received } = fakeFetch(() => answer({ type: "x", status: 429 }, 429, { "retry-after": "86400" }));
    const started = Date.now();
    await expect(new Haau3({ apiKey: KEY, fetch }).listPublishers()).rejects.toMatchObject({
      reason: "rate-limited",
      retryAfter: 86400,
      attempts: 1,
    });
    expect(received).toHaveLength(1);
    expect(Date.now() - started).toBeLessThan(500);
  });
});

describe("timeouts and aborts", () => {
  // A fetch that answers only when its signal aborts, like a server that never responds.
  const hanging = () =>
    fakeFetch(
      (request) =>
        new Promise<Response>((_, reject) => {
          request.signal?.addEventListener("abort", () => reject(request.signal!.reason));
        }),
    );

  it("ends an attempt at its timeout and says so", async () => {
    const { fetch } = hanging();
    await expect(new Haau3({ apiKey: KEY, fetch, timeout: 20, maxRetries: 0 }).readInsurancePlan("x")).rejects.toMatchObject({
      name: "NoAnswerError",
      reason: "timeout",
    });
  });

  it("takes a timeout per call", async () => {
    const { fetch } = hanging();
    const haau3 = new Haau3({ apiKey: KEY, fetch });
    await expect(haau3.readInsurancePlan("x", { timeout: 20, maxRetries: 0 })).rejects.toMatchObject({ reason: "timeout" });
  });

  it("throws the caller's abort as it is, without retrying", async () => {
    const { fetch, received } = hanging();
    const controller = new AbortController();
    const call = new Haau3({ apiKey: KEY, fetch }).readInsurancePlan("x", { signal: controller.signal });
    const reason = new Error("the caller stopped");
    controller.abort(reason);
    await expect(call).rejects.toBe(reason);
    expect(received).toHaveLength(1);
  });

  it("defaults to 65 seconds per attempt and one retry", () => {
    const haau3 = new Haau3({ apiKey: KEY, fetch: fakeFetch(() => answer({})).fetch });
    expect(haau3.timeout).toBe(65_000);
    expect(haau3.maxRetries).toBe(1);
    expect(haau3.baseURL).toBe("https://api.haau3.com");
  });
});

describe("per-call headers", () => {
  it("sends them, such as MedList's X-Request-Id, beside the client's own", async () => {
    const { fetch, received } = fakeFetch(() => fhirAnswer({ resourceType: "Bundle", type: "collection" }));
    await new Haau3({ apiKey: KEY, fetch }).reconcileMedications(
      { resourceType: "Bundle", type: "collection", entry: [] },
      { headers: { "X-Request-Id": "0b6f2d4e-8c1a-4e3b-9f5d-2a7c6e1b4d90" } },
    );
    expect(received[0]!.headers["x-request-id"]).toBe("0b6f2d4e-8c1a-4e3b-9f5d-2a7c6e1b4d90");
    expect(received[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
  });
});
