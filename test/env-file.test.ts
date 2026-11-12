// A client refused for having no key names an env file in the current folder that sets
// HAAU3_API_KEY, when the program never loaded it, and says how to load it. Only the variable's name
// is looked for: the value is never in the message or anywhere on the error. Anything unexpected
// leaves the refusal as it was, and nothing is read unless the client is refused for having no key.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspect } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ENV_FILE_LIMIT, unloadedEnvFile } from "../src/env-file.js";
import { Haau3, Haau3Error } from "../src/index.js";
import { KEY, fakeFetch, fhirAnswer } from "./helpers.js";

/** A made-up key planted in the files, which must never be repeated. */
const PLANTED = "haau3_sk_live_PLANTEDmarkerNEVERshown000000000000000000";
const MARKER = "PLANTEDmarker";
const { fetch } = fakeFetch(() => fhirAnswer({ resourceType: "CapabilityStatement" }));

const folders: string[] = [];
/** A new folder holding these files. */
function folder(files: Record<string, string> = {}): string {
  const dir = mkdtempSync(join(tmpdir(), "sdk-env-file-"));
  folders.push(dir);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
  return dir;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  for (const dir of folders.splice(0)) {
    try {
      chmodSync(join(dir, ".env"), 0o600);
    } catch {
      // Not every folder holds one.
    }
    rmSync(dir, { recursive: true, force: true });
  }
});

/** What a construction threw, made in `dir` as the current folder. */
function refusedIn(dir: string, options: ConstructorParameters<typeof Haau3>[0] = {}): Haau3Error {
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  vi.stubEnv("HAAU3_API_KEY", "");
  try {
    new Haau3({ fetch, ...options });
  } catch (error) {
    expect(error).toBeInstanceOf(Haau3Error);
    return error as Haau3Error;
  }
  throw new Error("the client was made");
}

/** Every way an error can be shown, as one text. */
const shown = (error: Haau3Error) =>
  [error.message, String(error), inspect(error, { depth: 10 }), JSON.stringify(error), JSON.stringify(Object.entries(error))].join("\n");

describe("which file sets the key", () => {
  it.each([
    ["a plain line", `${"HAAU3_API_KEY"}=${PLANTED}\n`],
    ["after export", `export HAAU3_API_KEY=${PLANTED}\n`],
    ["with spaces and double quotes", `  HAAU3_API_KEY = "${PLANTED}"\n`],
    ["in single quotes", `HAAU3_API_KEY='${PLANTED}'\n`],
    ["after other lines, with CRLF", `# keys\r\nOTHER=1\r\nHAAU3_API_KEY=${PLANTED}\r\n`],
    ["after a byte-order mark", `\uFEFFHAAU3_API_KEY=${PLANTED}\n`],
    ["with no line ending", `HAAU3_API_KEY=${PLANTED}`],
  ])("finds %s", (_name, text) => {
    expect(unloadedEnvFile(folder({ ".env": text }))).toBe(".env");
  });

  it.each([
    ["an empty value", "HAAU3_API_KEY=\n"],
    ["empty double quotes", 'HAAU3_API_KEY=""\n'],
    ["empty single quotes", "HAAU3_API_KEY=''\n"],
    ["a comment for a value", "HAAU3_API_KEY= # later\n"],
    ["a commented-out line", `# HAAU3_API_KEY=${PLANTED}\n`],
    ["a longer name", `HAAU3_API_KEY_OLD=${PLANTED}\n`],
    ["a name that ends in it", `MY_HAAU3_API_KEY=${PLANTED}\n`],
    ["only other variables", "HAAU3_ENVIRONMENT=sandbox\n"],
  ])("does not count %s", (_name, text) => {
    expect(unloadedEnvFile(folder({ ".env": text }))).toBeUndefined();
  });

  it("names .env.local before .env, as Next.js, Vite and the command line read them", () => {
    const both = { ".env.local": `HAAU3_API_KEY=${PLANTED}\n`, ".env": `HAAU3_API_KEY=${PLANTED}\n` };
    expect(unloadedEnvFile(folder(both))).toBe(".env.local");
    expect(unloadedEnvFile(folder({ ".env.local": "OTHER=1\n", ".env": `HAAU3_API_KEY=${PLANTED}\n` }))).toBe(".env");
  });

  it("finds nothing in a folder with neither file", () => {
    expect(unloadedEnvFile(folder({ "other.env": `HAAU3_API_KEY=${PLANTED}\n` }))).toBeUndefined();
  });

  it("reads at most 1 MiB of a file", () => {
    const padding = `# ${"x".repeat(1022)}\n`.repeat(ENV_FILE_LIMIT / 1024);
    expect(unloadedEnvFile(folder({ ".env": `${padding}HAAU3_API_KEY=${PLANTED}\n` }))).toBeUndefined();
    expect(unloadedEnvFile(folder({ ".env": `HAAU3_API_KEY=${PLANTED}\n${padding}` }))).toBe(".env");
  });

  it("asks only a regular file: a folder named .env is not one, and the next file is still asked", () => {
    const dir = folder({ ".env": `HAAU3_API_KEY=${PLANTED}\n` });
    mkdirSync(join(dir, ".env.local"));
    expect(unloadedEnvFile(dir)).toBe(".env");
  });

  it.skipIf(process.platform === "win32")("never waits on a named pipe called .env", () => {
    const dir = folder();
    execFileSync("mkfifo", [join(dir, ".env")]);
    const started = Date.now();
    expect(unloadedEnvFile(dir)).toBeUndefined();
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)("takes a file it cannot read as no file", () => {
    const dir = folder({ ".env": `HAAU3_API_KEY=${PLANTED}\n` });
    chmodSync(join(dir, ".env"), 0o000);
    expect(unloadedEnvFile(dir)).toBeUndefined();
  });

  it("asks nothing where the runtime has no file system to reach", () => {
    const dir = folder({ ".env": `HAAU3_API_KEY=${PLANTED}\n` });
    vi.spyOn(process, "getBuiltinModule").mockReturnValue(undefined as never);
    expect(unloadedEnvFile(dir)).toBeUndefined();
  });

  it("asks nothing in Deno, which would ask the person for permission to read", () => {
    const dir = folder({ ".env": `HAAU3_API_KEY=${PLANTED}\n` });
    vi.stubGlobal("Deno", {});
    expect(unloadedEnvFile(dir)).toBeUndefined();
  });

  it("takes a current folder that has gone as no file", () => {
    vi.spyOn(process, "cwd").mockImplementation(() => {
      throw new Error("ENOENT: the current folder has gone");
    });
    expect(unloadedEnvFile()).toBeUndefined();
  });
});

describe("the refusal for no key", () => {
  it("names the env file that sets the key and how to load it, and never the key", () => {
    const error = refusedIn(folder({ ".env": `OTHER=1\nHAAU3_API_KEY=${PLANTED}\n` }));
    expect(error.code).toBe("no-api-key");
    expect(error.message).toBe(
      "No API key. HAAU3_API_KEY is not set, but .env in this folder sets it, and this program has not loaded that file. " +
        'Load it first: run node --env-file=.env, or call process.loadEnvFile(".env") before new Haau3().',
    );
    expect(shown(error)).not.toContain(MARKER);
  });

  it("names .env.local when that is the file", () => {
    const error = refusedIn(folder({ ".env.local": `HAAU3_API_KEY=${PLANTED}\n` }));
    expect(error.message).toContain("but .env.local in this folder sets it");
    expect(error.message).toContain("node --env-file=.env.local");
    expect(shown(error)).not.toContain(MARKER);
  });

  it("with no such file, says where a key comes from, the command line among them, and the Sandbox's way", () => {
    const error = refusedIn(folder({ ".env": "HAAU3_ENVIRONMENT=\n" }));
    expect(error.code).toBe("no-api-key");
    expect(error.message).toBe(
      "No API key. Set HAAU3_API_KEY, or pass it as new Haau3({ apiKey }). Create a free key at https://platform.haau3.com, " +
        "or run npx haau3 login, then npx haau3 keys create, which writes one to this project's env file " +
        "(see https://docs.haau3.com/authentication). To call the Sandbox with no key, set HAAU3_ENVIRONMENT=sandbox, " +
        'or pass new Haau3({ environment: "sandbox" }).',
    );
  });

  it("asks no file when a key is given or the Sandbox is named (the control)", () => {
    const dir = folder({ ".env": `HAAU3_API_KEY=${PLANTED}\n` });
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    const asked = vi.spyOn(process, "getBuiltinModule");
    vi.stubEnv("HAAU3_API_KEY", "");
    expect(new Haau3({ fetch, apiKey: KEY }).environment).toBe("production");
    expect(new Haau3({ fetch, environment: "sandbox" }).environment).toBe("sandbox");
    vi.stubEnv("HAAU3_ENVIRONMENT", "sandbox");
    expect(new Haau3({ fetch }).environment).toBe("sandbox");
    expect(asked).not.toHaveBeenCalled();
  });
});
