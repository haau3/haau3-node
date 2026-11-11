// appInfo names the caller's app in the User-Agent, after the SDK's own, on every request the client
// sends. A value the header cannot carry is refused when the client is made, before anything is
// sent. A call's own user-agent header still replaces the whole value.

import { describe, expect, it } from "vitest";

import { Haau3, Haau3Error, VERSION, type AppInfo, type ClientOptions } from "../src/index.js";
import { answer, fakeFetch, fhirAnswer, KEY } from "./helpers.js";

/** The SDK's own part, as it is sent with no appInfo. */
const SDK = `haau3-node/${VERSION} (node ${process.versions.node.split(".")[0]})`;

function client(appInfo: AppInfo | undefined, respond: (count: number) => Response = () => answer({ publishers: [] })) {
  const { fetch, received } = fakeFetch((_, count) => respond(count));
  const options: ClientOptions = { apiKey: KEY, fetch };
  if (appInfo !== undefined) options.appInfo = appInfo;
  return { haau3: new Haau3(options), received };
}

describe("appInfo", () => {
  it("adds the app's name after the SDK's own part", async () => {
    const { haau3, received } = client({ name: "my-plugin" });
    await haau3.listPublishers();
    expect(received[0]!.headers["user-agent"]).toBe(`${SDK} my-plugin`);
  });

  it("adds its version after a slash", async () => {
    const { haau3, received } = client({ name: "my-plugin", version: "1.2.0" });
    await haau3.listPublishers();
    expect(received[0]!.headers["user-agent"]).toBe(`${SDK} my-plugin/1.2.0`);
  });

  it("adds its url in parentheses", async () => {
    const { haau3, received } = client({ name: "my-plugin", version: "1.2.0", url: "https://example.com/my-plugin" });
    await haau3.listPublishers();
    expect(received[0]!.headers["user-agent"]).toBe(`${SDK} my-plugin/1.2.0 (https://example.com/my-plugin)`);
  });

  it("takes an empty or undefined version or url as none", async () => {
    const { haau3, received } = client({ name: "my-plugin", version: "", url: undefined });
    await haau3.listPublishers();
    expect(received[0]!.headers["user-agent"]).toBe(`${SDK} my-plugin`);
  });

  it("leaves the User-Agent as the SDK's own without it (control)", async () => {
    const { haau3, received } = client(undefined);
    await haau3.listPublishers();
    expect(received[0]!.headers["user-agent"]).toBe(SDK);
  });

  it("is sent on every attempt of a retried call", async () => {
    const { fetch, received } = fakeFetch((_, count) =>
      count === 1 ? answer({}, 503, { "retry-after": "0" }) : answer({ publishers: [] }),
    );
    await new Haau3({ apiKey: KEY, fetch, maxRetries: 1, appInfo: { name: "my-plugin", version: "1.2.0" } }).listPublishers();
    expect(received).toHaveLength(2);
    expect(received.map((r) => r.headers["user-agent"])).toEqual([`${SDK} my-plugin/1.2.0`, `${SDK} my-plugin/1.2.0`]);
  });

  it("is sent by request() and batch() too", async () => {
    const { haau3, received } = client({ name: "my-plugin", version: "1.2.0" }, (count) =>
      count === 1
        ? answer({})
        : fhirAnswer({
            resourceType: "Bundle",
            type: "batch-response",
            entry: [{ resource: { resourceType: "InsurancePlan", id: "H2406-013-000" }, response: { status: "200 OK" } }],
          }),
    );
    await haau3.request({ method: "GET", path: "/v1/scheduling/publishers" });
    await haau3.batch((b) => [b.readInsurancePlan("H2406-013-000")]);
    expect(received).toHaveLength(2);
    expect(received.map((r) => r.headers["user-agent"])).toEqual([`${SDK} my-plugin/1.2.0`, `${SDK} my-plugin/1.2.0`]);
  });

  it("is replaced whole by a user-agent in a call's headers, as before", async () => {
    const { haau3, received } = client({ name: "my-plugin", version: "1.2.0" });
    await haau3.listPublishers({ headers: { "User-Agent": "something-else/9" } });
    expect(received[0]!.headers["user-agent"]).toBe("something-else/9");
  });
});

describe("appInfo that the User-Agent cannot carry", () => {
  const refused: [string, unknown, RegExp][] = [
    ["not an object", "my-plugin", /^appInfo takes an object with a name, .*: "my-plugin" is not one\.$/],
    ["null", null, /^appInfo takes an object with a name, .*: null is not one\.$/],
    ["a list", [{ name: "my-plugin" }], /^appInfo takes an object with a name/],
    ["an unknown field", { name: "my-plugin", partner_id: "pp_1" }, /^appInfo takes name, version and url only: "partner_id" is not one of them\.$/],
    ["no name", { version: "1.2.0" }, /^appInfo\.name is required: your app's name, such as "my-plugin"\.$/],
    ["an empty name", { name: "" }, /^appInfo\.name is required/],
    ["a name with a space", { name: "my plugin" }, /^appInfo\.name takes letters, digits .*: "my plugin" is not one\.$/],
    ["a name with a slash", { name: "my/plugin" }, /^appInfo\.name takes .*: "my\/plugin" is not one\.$/],
    ["a name with a line break", { name: "my-plugin\r\nX-Injected: 1" }, /^appInfo\.name takes /],
    ["a name that is not text", { name: 42 }, /^appInfo\.name takes .*: a number is not one\.$/],
    ["a version with a space", { name: "my-plugin", version: "1.2 beta" }, /^appInfo\.version takes .*such as "1\.2\.0": "1\.2 beta" is not one\.$/],
    ["a version with a slash", { name: "my-plugin", version: "1/2" }, /^appInfo\.version takes /],
    ["a url that is not http or https", { name: "my-plugin", url: "ftp://example.com" }, /^appInfo\.url takes an http or https URL .*: "ftp:\/\/example\.com" is not one\.$/],
    ["a url that is not a URL", { name: "my-plugin", url: "example.com" }, /^appInfo\.url takes /],
    ["a url with a parenthesis", { name: "my-plugin", url: "https://example.com/a(b)" }, /^appInfo\.url takes /],
    ["a url with a space", { name: "my-plugin", url: "https://example.com/a b" }, /^appInfo\.url takes /],
    ["a url with a backslash", { name: "my-plugin", url: "https://example.com/a\\b" }, /^appInfo\.url takes /],
    ["a url beyond ASCII", { name: "my-plugin", url: "https://example.com/é" }, /^appInfo\.url takes /],
  ];

  it.each(refused)("refuses %s when the client is made, sending nothing", (_, appInfo, message) => {
    const { fetch, received } = fakeFetch(() => answer({ publishers: [] }));
    let thrown: unknown;
    try {
      new Haau3({ apiKey: KEY, fetch, appInfo: appInfo as AppInfo });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(Haau3Error);
    expect((thrown as Error).message).toMatch(message);
    expect(received).toHaveLength(0);
  });

  it("takes every character a User-Agent token may hold (control)", async () => {
    const { haau3, received } = client({ name: "a-Z_0.9~!#$%&'*+^`|", version: "1.0.0-rc.1+build.5" });
    await haau3.listPublishers();
    expect(received[0]!.headers["user-agent"]).toBe(`${SDK} a-Z_0.9~!#$%&'*+^\`|/1.0.0-rc.1+build.5`);
  });
});
