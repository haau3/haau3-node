// A header an operation declares is an option of the call's own: processMessage's
// payerAuthorization, sent as Payer-Authorization. It is checked against the spec's schema before
// anything is sent, it wins over the same header in `headers`, and no error carries its value.

import { inspect } from "node:util";

import type { Bundle } from "fhir/r4.js";
import { describe, expect, it } from "vitest";

import { Haau3, Haau3Error, RefusedError, type ProcessMessageOptions } from "../src/index.js";
import { fakeFetch, fhirAnswer, KEY } from "./helpers.js";

const MESSAGE: Bundle = { resourceType: "Bundle", type: "message", entry: [] };
const ANSWER = { resourceType: "Bundle", type: "message", entry: [] };
/** A token no error, message or printout may ever carry. */
const TOKEN = "eyJ0b2tlbi10aGF0LW11c3QtbmV2ZXItYmUtcHJpbnRlZA";

function client(answer: () => Response = () => fhirAnswer(ANSWER)) {
  const { fetch, received } = fakeFetch(answer);
  return { haau3: new Haau3({ apiKey: KEY, fetch, maxRetries: 0 }), received };
}

describe("processMessage's payerAuthorization", () => {
  it("is sent as Payer-Authorization, beside the key's own Authorization", async () => {
    const { haau3, received } = client();
    await haau3.processMessage(MESSAGE, { payerAuthorization: `Bearer ${TOKEN}` });
    expect(received[0]!.headers["payer-authorization"]).toBe(`Bearer ${TOKEN}`);
    expect(received[0]!.headers.authorization).toBe(`Bearer ${KEY}`);
  });

  it("sends no Payer-Authorization when it is not given (control)", async () => {
    const { haau3, received } = client();
    await haau3.processMessage(MESSAGE);
    await haau3.processMessage(MESSAGE, { timeout: 5_000 });
    expect(received).toHaveLength(2);
    for (const request of received) expect(request.headers).not.toHaveProperty("payer-authorization");
  });

  it("takes any case of the scheme and more than one space, as the API does", async () => {
    const { haau3, received } = client();
    await haau3.processMessage(MESSAGE, { payerAuthorization: `bearer  ${TOKEN}` });
    expect(received[0]!.headers["payer-authorization"]).toBe(`bearer  ${TOKEN}`);
  });

  it.each([
    ["a bare token", TOKEN, "is not in the form the API takes in Payer-Authorization"],
    ["another scheme", `Basic ${TOKEN}`, "is not in the form the API takes in Payer-Authorization"],
    ["an empty value", "", "is not in the form the API takes in Payer-Authorization"],
    ["a value over 4,096 characters", `Bearer ${"a".repeat(4_090)}`, "is longer than the 4096 characters the API takes in Payer-Authorization"],
  ])("refuses %s before anything is sent, never repeating it", async (_what, value, words) => {
    const { haau3, received } = client();
    const error = await haau3.processMessage(MESSAGE, { payerAuthorization: value }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(Haau3Error);
    expect(received).toHaveLength(0);
    const message = (error as Haau3Error).message;
    expect(message).toContain("POST /v1/fhir/r4/$process-message was not sent: payerAuthorization");
    expect(message).toContain(words);
    if (value !== "") expect(inspect(error, { depth: 10, showHidden: true })).not.toContain(value.slice(-20));
    expect(JSON.stringify(error)).not.toContain(TOKEN);
  });

  it("takes 4,096 characters, the API's own limit, and no more (control at the limit)", async () => {
    const { haau3, received } = client();
    const atLimit = `Bearer ${"a".repeat(4_089)}`;
    expect(atLimit).toHaveLength(4_096);
    await haau3.processMessage(MESSAGE, { payerAuthorization: atLimit });
    expect(received[0]!.headers["payer-authorization"]).toBe(atLimit);
  });

  it("wins over a Payer-Authorization in headers, in any case", async () => {
    const { haau3, received } = client();
    await haau3.processMessage(MESSAGE, {
      headers: { "PAYER-AUTHORIZATION": "Bearer from-headers" },
      payerAuthorization: `Bearer ${TOKEN}`,
    });
    expect(received[0]!.headers["payer-authorization"]).toBe(`Bearer ${TOKEN}`);
  });

  it("is sent again on a retry", async () => {
    let count = 0;
    const { fetch, received } = fakeFetch(() => (++count === 1 ? new Response("", { status: 503 }) : fhirAnswer(ANSWER)));
    const haau3 = new Haau3({ apiKey: KEY, fetch, maxRetries: 1 });
    await haau3.processMessage(MESSAGE, { payerAuthorization: `Bearer ${TOKEN}` });
    expect(received).toHaveLength(2);
    expect(received.map((r) => r.headers["payer-authorization"])).toEqual([`Bearer ${TOKEN}`, `Bearer ${TOKEN}`]);
  });

  it("is in no error the API's answer gives, however it is printed", async () => {
    const problem = { resourceType: "OperationOutcome", issue: [{ severity: "error", code: "invalid" }] };
    const { haau3 } = client(() => fhirAnswer(problem, 400));
    const error = await haau3.processMessage(MESSAGE, { payerAuthorization: `Bearer ${TOKEN}` }).then(
      () => undefined,
      (e: unknown) => e,
    );
    expect(error).toBeInstanceOf(RefusedError);
    for (const printed of [inspect(error, { depth: 10, showHidden: true }), JSON.stringify(error), String(error)]) {
      expect(printed).not.toContain(TOKEN);
    }
  });

  it("is typed from the spec, and only on the operation that declares it", () => {
    const options: ProcessMessageOptions = { payerAuthorization: `Bearer ${TOKEN}`, timeout: 1_000 };
    expect(options.payerAuthorization).toBeDefined();
    const { haau3 } = client();
    // @ts-expect-error A call whose operation declares no such header has no such option.
    void haau3.reconcileMedications({ resourceType: "Bundle", type: "collection", entry: [] }, { payerAuthorization: "Bearer x" }).catch(() => {});
  });
});
