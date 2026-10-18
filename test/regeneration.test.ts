// What a regeneration PR says and does, over oasdiff 1.33.0's real reports (test/fixtures/oasdiff/,
// each run with openapi/oasdiff-levels.txt over two versions of the spec):
//
// - preview-2-to-3: a path removed and another added;
// - descriptions-only: two versions that differ only in descriptions;
// - additions: an optional property added;
// - method-renamed: preview.3 edited to rename an operation and drop an optional response property;
// - security-scheme-removed: a security scheme removed.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MAX_BODY, decide, type Change, type Regeneration } from "../scripts/regeneration.js";

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./fixtures/oasdiff/${name}.json`, import.meta.url), "utf8")) as Change[];

const regeneration = (changes: Change[], generatedChanged = true): Regeneration => ({
  from: "1.0.0-preview.2",
  to: "1.0.0-preview.3",
  etag: 'W/"4l7nD8I7mwiHJI4hZ8QHmqfFP1T"',
  specUrl: "https://api.haau3.com/openapi.json",
  changes,
  generatedChanged,
});

describe("a regeneration PR", () => {
  it("is breaking, a minor, when a path is removed (preview.2 to preview.3)", () => {
    const d = decide(regeneration(fixture("preview-2-to-3")));
    expect(d.title).toBe("feat!: the API's spec at 1.0.0-preview.3");
    expect(d.breaking).toBe(true);
    expect(d.releases).toBe(true);
    expect(d.body).toContain("releases a minor version");
    expect(d.body).toContain("`GET /v1/scheduling/actors`: api path removed without deprecation");
    expect(d.body).toContain("deleted the `query` request parameter `actorKey`");
  });

  it("counts the SDK's three raised rules as breaking", () => {
    const changes = fixture("method-renamed");
    expect(changes.map((c) => [c.id, c.level])).toEqual([
      ["api-operation-id-removed", 3],
      ["response-optional-property-removed", 3],
    ]);
    expect(decide(regeneration(changes)).title).toMatch(/^feat!: /);
    // The removed components of the rename are errors too, not oasdiff's default INFO.
    expect(fixture("preview-2-to-3").filter((c) => c.id === "api-schema-removed").map((c) => c.level)).toEqual([3, 3]);
  });

  it("counts a warning as breaking: a removed request parameter", () => {
    const warning = fixture("preview-2-to-3").filter((c) => c.id === "request-parameter-removed");
    expect(warning.map((c) => c.level)).toEqual([2]);
    const d = decide(regeneration(warning));
    expect(d.title).toMatch(/^feat!: /);
    expect(d.breaking).toBe(true);
  });

  it("is a feature, a patch, when oasdiff reports only additions", () => {
    const d = decide(regeneration(fixture("additions")));
    expect(d.title).toBe("feat: the API's spec at 1.0.0-preview.3");
    expect(d.breaking).toBe(false);
    expect(d.releases).toBe(true);
    expect(d.body).toContain("releases a patch version");
    expect(d.body).not.toContain("can break callers (");
  });

  it("is a fix, a patch, when only descriptions changed and the doc comments with them", () => {
    const changes = fixture("descriptions-only");
    expect(changes).toEqual([]);
    const d = decide(regeneration(changes));
    expect(d.title).toBe("fix: the API's spec at 1.0.0-preview.3");
    expect(d.releases).toBe(true);
  });

  it("releases nothing when the generated code did not change, and still says the API broke callers", () => {
    const quiet = decide(regeneration(fixture("descriptions-only"), false));
    expect(quiet.title).toBe("chore: the API's spec at 1.0.0-preview.3");
    expect(quiet.breaking).toBe(false);
    expect(quiet.releases).toBe(false);

    const broke = decide(regeneration(fixture("preview-2-to-3"), false));
    expect(broke.title).toBe("chore: the API's spec at 1.0.0-preview.3");
    expect(broke.breaking).toBe(true);
    expect(broke.releases).toBe(false);
    expect(broke.body).toContain("releases nothing");
  });

  it("does not count a removed security scheme the SDK never used", () => {
    const changes = fixture("security-scheme-removed");
    expect(changes.map((c) => c.id).sort()).toEqual(["api-global-security-removed", "api-security-component-removed"]);
    expect(decide(regeneration(changes)).breaking).toBe(false);
  });

  it("names both versions, the ETag and where the spec was read", () => {
    const { body } = decide(regeneration(fixture("additions")));
    expect(body).toContain("from `1.0.0-preview.2` to `1.0.0-preview.3`");
    expect(body).toContain('ETag `W/"4l7nD8I7mwiHJI4hZ8QHmqfFP1T"`');
    expect(body).toContain("https://api.haau3.com/openapi.json");
  });
});

describe("openapi/oasdiff-levels.txt", () => {
  it("raises the three changes that break a typed caller and turns off the three version rules", () => {
    const lines = readFileSync(new URL("../openapi/oasdiff-levels.txt", import.meta.url), "utf8").trim().split("\n");
    expect(lines).toEqual([
      "api-operation-id-removed err",
      "response-optional-property-removed err",
      "api-schema-removed err",
      "api-version-decreased none",
      "api-version-not-bumped none",
      "api-major-version-not-bumped none",
    ]);
  });
});

describe("the description, which becomes the squash commit's body", () => {
  const bodies = ["preview-2-to-3", "additions", "descriptions-only", "method-renamed", "security-scheme-removed"].flatMap(
    (name) => [true, false].map((generated) => decide(regeneration(fixture(name), generated)).body),
  );

  it("never opens a paragraph or a line the way a Conventional Commit does", () => {
    // release-please splits a commit body at any paragraph that starts like this.
    const conventional = /^(feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(\(.*\))?!?: /m;
    for (const body of bodies) expect(body).not.toMatch(conventional);
  });

  it("never names a breaking-change footer or Release-As", () => {
    for (const body of bodies) {
      expect(body).not.toMatch(/BREAKING[ -]CHANGE/i);
      expect(body).not.toMatch(/Release-As/i);
    }
  });

  it("has no em dash", () => {
    for (const body of bodies) expect(body).not.toContain("—");
  });

  it("fits GitHub's limit however many changes there are, keeping what to do", () => {
    const many: Change[] = Array.from({ length: 5_000 }, (_, i) => ({
      id: i % 2 ? "response-property-type-changed" : "endpoint-added",
      text: `the response's \`property${i}\` changed ${"in a long way ".repeat(20)}`,
      level: i % 2 ? 3 : 1,
      operation: "GET",
      path: `/v1/fhir/r4/Resource${i}`,
    }));
    const { body } = decide(regeneration(many));
    expect(body.length).toBeLessThanOrEqual(MAX_BODY + 100);
    expect(body).toContain("Push the fix to this branch");
    expect(body).toContain("Changes that can break callers (2500)");
  });
});
