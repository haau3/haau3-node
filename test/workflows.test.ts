// The two workflows that change the repository or publish: what npm's trusted publisher depends on,
// and what keeps haau3-bot's token and oasdiff's download honest.
import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const dir = new URL("../.github/workflows/", import.meta.url);
const workflow = (name: string) => parse(readFileSync(new URL(name, dir), "utf8")) as Record<string, any>;
const release = workflow("release.yml");
const regenerate = workflow("regenerate.yml");

describe("release.yml", () => {
  it("runs on a push to main and on nothing else, so a version is staged once", () => {
    expect(release.on).toEqual({ push: { branches: ["main"] } });
  });

  it("stages only a release release-please reports it made, at its tag", () => {
    const stage = release.jobs.stage;
    expect(stage.needs).toBe("release");
    expect(stage.if).toContain("needs.release.outputs.release_created == 'true'");
    expect(release.jobs.release.outputs.release_created).toBe("${{ steps.release.outputs.release_created }}");
    expect(stage.steps[0].with.ref).toBe("${{ needs.release.outputs.tag_name }}");
  });

  it("stages in the npm environment, the one npm's trusted publisher names, with the OIDC token there alone", () => {
    expect(release.jobs.stage.environment).toBe("npm");
    expect(release.jobs.stage.permissions).toEqual({ contents: "read", "id-token": "write" });
    expect(release.jobs.release.permissions).toBeUndefined();
    expect(release.permissions).toEqual({ contents: "read" });
    const run = release.jobs.stage.steps.map((s: any) => s.run).filter(Boolean);
    expect(run).toContain("npm stage publish --access public");
  });

  it("gives release-please haau3-bot's token and the repository's config", () => {
    const steps = release.jobs.release.steps;
    const please = steps.find((s: any) => String(s.uses).startsWith("googleapis/release-please-action@"));
    expect(please.with).toEqual({
      token: "${{ steps.token.outputs.token }}",
      "config-file": "release-please-config.json",
      "manifest-file": ".release-please-manifest.json",
    });
  });
});

describe("regenerate.yml", () => {
  const steps = regenerate.jobs.regenerate.steps as Record<string, any>[];
  const index = (match: (s: Record<string, any>) => boolean) => steps.findIndex(match);

  it("runs every morning at 06:17 Eastern and by hand, with the live spec as the default", () => {
    expect(regenerate.on.schedule).toEqual([{ cron: "17 6 * * *", timezone: "America/New_York" }]);
    expect(regenerate.on.workflow_dispatch.inputs["spec-url"].default).toBe("https://api.haau3.com/openapi.json");
  });

  it("mints haau3-bot's token only after the install and the generator have run", () => {
    const token = index((s) => String(s.uses).startsWith("actions/create-github-app-token@"));
    expect(token).toBeGreaterThan(index((s) => s.run === "pnpm install --frozen-lockfile"));
    expect(token).toBeGreaterThan(index((s) => s.run === "pnpm generate"));
    expect(token).toBeGreaterThan(index((s) => String(s.run).includes("describe-regeneration.ts")));
    expect(steps[0]!.with["persist-credentials"]).toBe(false);
    expect(regenerate.permissions).toEqual({ contents: "read" });
  });

  it("runs oasdiff only from a download it checked, with the repository's levels and no external refs", () => {
    expect(regenerate.env.OASDIFF_SHA256).toMatch(/^[0-9a-f]{64}$/);
    const oasdiff = steps.find((s) => s.name === "Ask oasdiff what changed for callers")!.run as string;
    const check = oasdiff.indexOf('sha256sum --check --strict');
    expect(check).toBeGreaterThan(-1);
    expect(oasdiff.indexOf('"$RUNNER_TEMP/oasdiff" changelog')).toBeGreaterThan(check);
    expect(oasdiff).toContain("${OASDIFF_SHA256}");
    expect(oasdiff).toContain("--allow-external-refs=false");
    expect(oasdiff).toContain("--severity-levels openapi/oasdiff-levels.txt");
  });

  it("never pipes into grep under pipefail, where a grep that stops early fails the command feeding it", () => {
    const script = steps.find((s) => String(s.run).includes("set -euo pipefail"))!.run as string;
    expect(script).not.toMatch(/\|\s*grep/);
  });
});

describe("public-text.yml", () => {
  const publicText = workflow("public-text.yml");
  const run = publicText.jobs.check.steps.at(-1).run as string;

  it("runs on every pull request to main, again when its title or description is edited", () => {
    expect(publicText.on.pull_request.branches).toEqual(["main"]);
    expect(publicText.on.pull_request.types).toEqual(expect.arrayContaining(["opened", "edited", "synchronize"]));
    // pull_request, never pull_request_target: a fork's pull request gets no write token.
    expect(Object.keys(publicText.on)).toEqual(["pull_request"]);
  });

  it("checks the files, the commits the PR brings, and its title and description", () => {
    expect(run).toContain('--commits "$BASE..$HEAD" --text-env PR_TITLE --text-env PR_BODY');
    // The title and description reach the script as variables, never as text in the script.
    expect(run).not.toContain("github.event");
  });
});

describe("every workflow", () => {
  const files = readdirSync(dir).filter((name) => name.endsWith(".yml"));

  it("is one of the four this repository runs", () => {
    expect(files.sort()).toEqual(["ci.yml", "public-text.yml", "regenerate.yml", "release.yml"]);
  });

  it("calls fromJSON in no step's env, which GitHub evaluates even when the step's if is false", () => {
    for (const name of files) {
      const jobs = Object.values(workflow(name).jobs) as { steps: { name?: string; env?: Record<string, string> }[] }[];
      for (const step of jobs.flatMap((job) => job.steps)) {
        for (const value of Object.values(step.env ?? {})) {
          expect(String(value), `${name}: ${step.name}`).not.toMatch(/fromJSON\(/i);
        }
      }
    }
  });

  it("pins every action it uses by commit", () => {
    for (const name of files) {
      const jobs = Object.values(workflow(name).jobs) as { steps: { uses?: string }[] }[];
      for (const uses of jobs.flatMap((job) => job.steps.map((s) => s.uses).filter(Boolean))) {
        expect(uses, `${name}: ${uses}`).toMatch(/^[\w.-]+\/[\w./-]+@[0-9a-f]{40}$/);
      }
    }
  });
});
