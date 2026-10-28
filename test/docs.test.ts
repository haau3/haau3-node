// The README and api.md name only methods that exist, and api.md names every one once.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Haau3 } from "../src/index.js";
import { BatchBuilder } from "../src/generated/batch.js";
import { spec } from "./helpers.js";

const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const isMethod = (name: string) => typeof (Haau3.prototype as unknown as Record<string, unknown>)[name] === "function";

const operationIds = Object.values(spec.paths).flatMap((item) =>
  ["get", "post"].filter((m) => item[m]).map((m) => item[m].operationId as string),
);

describe("the README", () => {
  it("calls only methods Haau3 has", () => {
    const called = [...read("README.md").matchAll(/\bhaau3\.([a-zA-Z]+)\(/g)].map((m) => m[1]!);
    expect(called.length).toBeGreaterThan(10);
    expect(called.filter((name) => !isMethod(name))).toEqual([]);
  });

  it("calls one operation of each service", () => {
    // A service is a tag of the spec. The FHIR base's own operations, its metadata and the batch, are none.
    const serviceOf = new Map<string, string>(
      Object.values(spec.paths).flatMap((item) =>
        ["get", "post"].filter((m) => item[m]).map((m) => [item[m].operationId as string, item[m].tags[0] as string] as const),
      ),
    );
    const services = new Set([...serviceOf.values()].filter((tag) => tag !== "FHIR base"));
    const shown = new Set([...read("README.md").matchAll(/\bhaau3\.([a-zA-Z]+)\(/g)].map((m) => serviceOf.get(m[1]!)));
    expect(services.size).toBeGreaterThan(5);
    expect([...services].filter((service) => !shown.has(service))).toEqual([]);
  });

  it("shows a batch, built from the builder's methods", () => {
    const readme = read("README.md");
    expect(readme).toContain("haau3.batch((b) =>");
    const built = [...readme.matchAll(/\bb\.([a-zA-Z]+)\(/g)].map((m) => m[1]!);
    expect(built.length).toBeGreaterThan(0);
    expect(built.filter((name) => typeof (BatchBuilder.prototype as unknown as Record<string, unknown>)[name] !== "function")).toEqual([]);
  });
});

describe("what this repository publishes", () => {
  it.each(["README.md", "CONTRIBUTING.md", "SECURITY.md", "api.md"])("%s holds no em or en dash", (name) => {
    // api.md is generated from the spec's own words, and published beside the README.
    expect(read(name)).not.toMatch(/[\u2014\u2013]/);
  });
});

describe("api.md", () => {
  const rows = [...read("api.md").matchAll(/^\| \[`([a-zA-Z]+)\([^)]*\)`\]\((https:\/\/docs\.haau3\.com\/[^)]+)\)/gm)];

  it("lists every operation once, and nothing else", () => {
    expect(rows.map((m) => m[1]).sort()).toEqual([...operationIds].sort());
    expect(rows.map((m) => m[1]).filter((name) => !isMethod(name!))).toEqual([]);
  });

  it("links each to its own page on docs.haau3.com", () => {
    const links = rows.map((m) => m[2]);
    expect(new Set(links).size).toBe(links.length);
    expect(links.every((link) => link!.startsWith("https://docs.haau3.com/api-reference/"))).toBe(true);
  });

  it("says which operations a batch cannot carry: the batch, and the ones the spec marks x-haau3-batchable: false", () => {
    const refused = Object.values(spec.paths as Record<string, Record<string, any>>)
      .flatMap((item) => Object.values(item))
      .filter((op) => op["x-haau3-batchable"] === false)
      .map((op) => `\`${op.operationId}\``);
    expect(refused).toContain("`reconcileMedications`");
    const names = ["`fhirBatch`", ...refused];
    expect(read("api.md")).toContain(`except ${names.slice(0, -1).join(", ")} and ${names.at(-1)}:`);
  });

  it("names the spec version it was generated from", () => {
    expect(read("api.md")).toContain(`(\`${spec.info.version}\`)`);
  });
});
