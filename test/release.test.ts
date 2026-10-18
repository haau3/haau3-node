// release-please's configuration holds the release rules CONTRIBUTING.md states.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), "utf8");
const config = JSON.parse(read("release-please-config.json")) as Record<string, any>;
const manifest = JSON.parse(read(".release-please-manifest.json")) as Record<string, string>;
const pkg = JSON.parse(read("package.json")) as { version: string };

describe("release-please", () => {
  it("bumps the minor for a breaking change and the patch for a feature while the SDK is 0.y.z", () => {
    expect(config["bump-minor-pre-major"]).toBe(true);
    expect(config["bump-patch-for-minor-pre-major"]).toBe(true);
    expect(config["release-type"]).toBe("node");
  });

  it("tags v<version>, which it finds only with the component left out of the tag", () => {
    expect(config["include-component-in-tag"]).toBe(false);
    expect(config["include-v-in-tag"]).toBe(true);
  });

  it("titles its PR Release <version>", () => {
    expect(config["pull-request-title-pattern"]).toBe("Release ${version}");
  });

  it("is one package at the root, whose version is package.json's", () => {
    expect(Object.keys(config.packages)).toEqual(["."]);
    expect(manifest).toEqual({ ".": pkg.version });
  });

  it("updates src/version.ts, whose version line carries its annotation", () => {
    expect(config.packages["."]["extra-files"]).toEqual(["src/version.ts"]);
    expect(read("src/version.ts")).toMatch(/^export const VERSION = "\d+\.\d+\.\d+"; \/\/ x-release-please-version$/m);
  });

  it("writes CHANGELOG.md, which already starts with every earlier release", () => {
    const changelog = read("CHANGELOG.md");
    expect(changelog.startsWith("# Changelog\n")).toBe(true);
    expect(changelog).toContain("## [0.1.1](https://github.com/haau3/haau3-node/compare/v0.1.0...v0.1.1)");
    expect(changelog).toContain("## 0.1.0 ");
    expect(changelog).not.toContain("—");
  });
});
