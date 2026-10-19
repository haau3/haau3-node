// scripts/check-public-text.ts finds each kind of text this repository never publishes, and allows
// the shapes its own text uses. The samples are made up.
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { check, termRules } from "../scripts/check-public-text.js";

const found = (text: string) => check("sample", text).map((f) => f.match);

describe("the public-text check", () => {
  it.each([
    ["another repository of the organization", "see haau3/private-thing for why", "haau3/private-thing"],
    ["a project or service name", "it runs in haau3-example-project", "haau3-example-project"],
    ["a bare issue number", "decided in issue #123", "#123"],
    ["an issue number without a #", "see issue 123", "issue 123"],
    ["a work-item id", "this is ABC-4", "ABC-4"],
    ["a planning word", "part of the milestone", "milestone"],
    ["a person by role", "the owner approves it", "the owner"],
    ["how the API is run", "after each deploy", "deploy"],
    ["where secrets are kept", "the key is an org secret", "org secret"],
    ["a credential", "Iv23liEXAMPLEexample00", "Iv23liEXAMPLEexample00"],
    ["a private email address", "write to someone@personal.example-mail.net", "someone@personal.example-mail.net"],
  ])("finds %s", (_, text, match) => {
    expect(found(text)).toContain(match);
  });

  it("allows what this repository's own text uses", () => {
    const text = [
      "npm install @haau3/sdk, from haau3/haau3-node#3, opened by haau3-bot[bot] as haau3-sdk/0.1.1.",
      "Also for Python: haau3 on PyPI, from https://github.com/haau3/haau3-python (haau3-python), and haau3-go to come.",
      "PHQ-9 and UTF-8, the plan H2406-013, openapi-ts/openapi-typescript#2841 and pnpm@12.12.1.",
      "* the API's spec at 1.0.0-preview.4 ([#5](https://github.com/haau3/haau3-node/issues/5))",
      "Write to security@haau3.com. Co-Authored-By: Claude <noreply@anthropic.com>",
    ].join("\n");
    expect(found(text)).toEqual([]);
  });

  it("allows a changelog link only to this repository", () => {
    expect(found("([#5](https://github.com/haau3/haau3-node/issues/5))")).toEqual([]);
    expect(found("([#5](https://github.com/another/repository/issues/5))")).toEqual(["#5"]);
  });

  it("takes extra terms from a file of patterns, with comments", () => {
    const rules = termRules("# a comment\nsecret-codename\n\n  other\\d+  # trailing comment\n");
    expect(rules.map((r) => r.pattern.source)).toEqual(["secret-codename", "other\\d+"]);
    expect(check("sample", "the Secret-Codename and other42", rules).map((f) => f.match)).toEqual([
      "Secret-Codename",
      "other42",
    ]);
  });

  it("passes this repository's own files", () => {
    // The real run, as CI and a pull request use it: it fails on any finding.
    const run = () => execFileSync("./node_modules/.bin/tsx", ["scripts/check-public-text.ts"], { stdio: "pipe" });
    expect(run).not.toThrow();
  });
});
