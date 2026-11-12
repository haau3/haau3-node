// A client refused for having no key from HAAU3_API_KEY names an env file in the current folder that
// sets it, and says how to load it: when the environment has no such variable, and when it has one set
// to nothing, which Node's loaders would keep. The value is never in the message, anywhere on the
// error, or on RegExp's legacy statics, and the bytes read are zeroed. Anything unexpected leaves the
// refusal as it was, nothing but a regular file is opened, and nothing is read unless the client is
// refused for having no key from the variable.
import { execFileSync, spawn } from "node:child_process";
import * as realFs from "node:fs";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
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
const LINE = `HAAU3_API_KEY=${PLANTED}\n`;
const POSIX = process.platform !== "win32";
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

/**
 * What a construction threw, made in `dir` as the current folder. `variable` is HAAU3_API_KEY's
 * state: absent from the environment, or present and empty.
 */
function refusedIn(dir: string, variable: "absent" | "empty", options: ConstructorParameters<typeof Haau3>[0] = {}): Haau3Error {
  vi.spyOn(process, "cwd").mockReturnValue(dir);
  vi.stubEnv("HAAU3_API_KEY", variable === "empty" ? "" : undefined);
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
  [error.message, String(error), inspect(error, { depth: 10 }), JSON.stringify(error), JSON.stringify(Object.entries(error)), error.stack ?? ""].join("\n");

/** RegExp's legacy statics, which a match in this process leaves holding the text it ran over. */
const regExpStatics = () => {
  const r = RegExp as unknown as Record<string, unknown>;
  return [r.input, r.lastMatch, r.leftContext, r.rightContext, r.$_].map(String).join("\n");
};

/** The real `fs`, wrapped so a test sees each call, served through `process.getBuiltinModule`. */
function spiedFs() {
  const calls = { stat: [] as string[], open: [] as { path: string; flags: number }[], read: 0, close: 0, buffers: [] as Uint8Array[] };
  const fs = {
    ...realFs,
    constants: realFs.constants,
    statSync: (path: string) => {
      calls.stat.push(path);
      return realFs.statSync(path);
    },
    openSync: (path: string, flags: number) => {
      calls.open.push({ path, flags });
      return realFs.openSync(path, flags);
    },
    readSync: (fd: number, buffer: Uint8Array, offset: number, length: number, position: number) => {
      calls.read++;
      calls.buffers.push(buffer);
      return realFs.readSync(fd, buffer, offset, length, position);
    },
    closeSync: (fd: number) => {
      calls.close++;
      realFs.closeSync(fd);
    },
  };
  vi.spyOn(process, "getBuiltinModule").mockImplementation(((id: string) => (id === "node:fs" ? fs : undefined)) as never);
  return calls;
}

describe("which file sets the key", () => {
  it.each([
    ["a plain line", LINE],
    ["after export", `export ${LINE}`],
    ["with spaces and double quotes", `  HAAU3_API_KEY = "${PLANTED}"\n`],
    ["in single quotes", `HAAU3_API_KEY='${PLANTED}'\n`],
    ["after other lines, with CRLF", `# keys\r\nOTHER=1\r\nHAAU3_API_KEY=${PLANTED}\r\n`],
    ["with no line ending", LINE.trimEnd()],
    ["set again after empty", `HAAU3_API_KEY=\n${LINE}`],
    ["after a first line behind a byte-order mark", `\uFEFFOTHER=1\n${LINE}`],
  ])("finds %s", (_name, text) => {
    expect(unloadedEnvFile(folder({ ".env": text }))).toBe(".env");
  });

  it.each([
    ["an empty value", "HAAU3_API_KEY=\n"],
    ["empty double quotes", 'HAAU3_API_KEY=""\n'],
    ["empty single quotes", "HAAU3_API_KEY=''\n"],
    ["quotes holding spaces", 'HAAU3_API_KEY="   "\n'],
    ["a comment for a value", "HAAU3_API_KEY= # later\n"],
    ["another variable", "HAAU3_API_KEY=$OTHER\n"],
    ["another variable, braced", "HAAU3_API_KEY=${OTHER}\n"],
    ["a commented-out line", `# ${LINE}`],
    ["a longer name", `HAAU3_API_KEY_OLD=${PLANTED}\n`],
    ["a name that ends in it", `MY_${LINE}`],
    ["only other variables", "HAAU3_ENVIRONMENT=sandbox\n"],
    // A loader keeps the last assignment.
    ["a key emptied after it is set", `${LINE}HAAU3_API_KEY=\n`],
    // Node's loader does not skip a byte-order mark, so a first line behind one sets nothing.
    ["a first line behind a byte-order mark", `\uFEFF${LINE}`],
  ])("does not count %s", (_name, text) => {
    expect(unloadedEnvFile(folder({ ".env": text }))).toBeUndefined();
  });

  it("names .env.local before .env, as Next.js, Vite and the command line read them", () => {
    expect(unloadedEnvFile(folder({ ".env.local": LINE, ".env": LINE }))).toBe(".env.local");
    expect(unloadedEnvFile(folder({ ".env.local": "OTHER=1\n", ".env": LINE }))).toBe(".env");
  });

  it("finds nothing in a folder with neither file", () => {
    expect(unloadedEnvFile(folder({ "other.env": LINE }))).toBeUndefined();
  });

  it("reads at most 1 MiB of a file", () => {
    const padding = `# ${"x".repeat(1022)}\n`.repeat(ENV_FILE_LIMIT / 1024);
    expect(unloadedEnvFile(folder({ ".env": `${padding}${LINE}` }))).toBeUndefined();
    expect(unloadedEnvFile(folder({ ".env": `${LINE}${padding}` }))).toBe(".env");
  });

  it("asks only a regular file: a folder named .env.local is never opened, and .env is still asked", () => {
    const dir = folder({ ".env": LINE });
    mkdirSync(join(dir, ".env.local"));
    const calls = spiedFs();
    expect(unloadedEnvFile(dir)).toBe(".env");
    expect(calls.open.map((o) => o.path)).toEqual([`${dir}/.env`]);
  });

  it.skipIf(!POSIX)("follows a symlink to a regular file", () => {
    const shared = folder({ "shared.env": LINE });
    const dir = folder();
    symlinkSync(join(shared, "shared.env"), join(dir, ".env"));
    expect(unloadedEnvFile(dir)).toBe(".env");
  });

  it.skipIf(!POSIX)("opens without blocking, reads into a buffer it zeroes, and closes every file it opens", () => {
    const calls = spiedFs();
    expect(unloadedEnvFile(folder({ ".env.local": "OTHER=1\n", ".env": LINE }))).toBe(".env");
    expect(calls.open).toHaveLength(2);
    for (const { flags } of calls.open) expect(flags & realFs.constants.O_NONBLOCK).toBe(realFs.constants.O_NONBLOCK);
    expect(calls.close).toBe(calls.open.length);
    expect(calls.buffers).toHaveLength(2);
    for (const buffer of calls.buffers) expect(buffer.every((b) => b === 0)).toBe(true);
  });

  it.skipIf(!POSIX)("never opens a named pipe called .env, so a writer waiting on it keeps waiting", async () => {
    // Password managers can serve .env as a named pipe, where an open counts as a read or asks for approval.
    const dir = folder();
    const pipe = join(dir, ".env");
    execFileSync("mkfifo", [pipe]);
    const writer = spawn(process.execPath, ["-e", "require('fs').openSync(process.argv[1], 'w'); process.exit(0)", pipe], {
      stdio: "ignore",
    });
    try {
      await new Promise((resolve) => setTimeout(resolve, 200));
      const calls = spiedFs();
      expect(unloadedEnvFile(dir)).toBeUndefined();
      expect(calls.open).toEqual([]);
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(writer.exitCode).toBeNull();
    } finally {
      writer.kill();
    }
  });

  it.skipIf(!POSIX || process.getuid?.() === 0)("takes a file it cannot read as no file", () => {
    const dir = folder({ ".env": LINE });
    chmodSync(join(dir, ".env"), 0o000);
    expect(unloadedEnvFile(dir)).toBeUndefined();
  });

  it("asks nothing where the runtime has no file system to reach", () => {
    const dir = folder({ ".env": LINE });
    vi.spyOn(process, "getBuiltinModule").mockReturnValue(undefined as never);
    expect(unloadedEnvFile(dir)).toBeUndefined();
  });

  it("asks nothing in Deno, which would ask the person for permission to read", () => {
    const dir = folder({ ".env": LINE });
    vi.stubGlobal("Deno", {});
    expect(unloadedEnvFile(dir)).toBeUndefined();
  });

  it("takes a current folder that has gone as no file", () => {
    vi.spyOn(process, "cwd").mockImplementation(() => {
      throw new Error("ENOENT: the current folder has gone");
    });
    expect(unloadedEnvFile()).toBeUndefined();
  });

  it("looks in the folder it is given, never a sibling when its name ends in a backslash", () => {
    const parent = folder();
    const named = join(parent, "proj\\");
    mkdirSync(named);
    mkdirSync(join(parent, "proj"));
    writeFileSync(join(parent, "proj", ".env"), LINE);
    expect(unloadedEnvFile(POSIX ? named : join(parent, "proj"))).toBe(POSIX ? undefined : ".env");
  });
});

describe("the refusal for no key", () => {
  it("says the environment has no value, names the file and how to load it, and never the key", () => {
    const error = refusedIn(folder({ ".env": `OTHER=1\n${LINE}` }), "absent");
    expect(error.code).toBe("no-api-key");
    expect(error.message).toBe(
      "No API key. .env in this folder sets HAAU3_API_KEY, but this program's environment has no value for it. " +
        'Load the file before new Haau3(): run node --env-file=.env, or call process.loadEnvFile(".env") first.',
    );
    expect(shown(error)).not.toContain(MARKER);
  });

  it("names .env.local when that is the file", () => {
    const error = refusedIn(folder({ ".env.local": LINE }), "absent");
    expect(error.message).toContain(".env.local in this folder sets HAAU3_API_KEY");
    expect(error.message).toContain("node --env-file=.env.local");
    expect(shown(error)).not.toContain(MARKER);
  });

  // A variable set to nothing (a compose file passing an unset variable through, an empty export) is
  // kept by node --env-file and process.loadEnvFile(), so loading the file would change nothing.
  it("says an empty HAAU3_API_KEY hides the file, and to unset it", () => {
    const error = refusedIn(folder({ ".env": LINE }), "empty");
    expect(error.message).toBe(
      "No API key. HAAU3_API_KEY is set but empty in this program's environment, and .env in this folder sets it. " +
        "node --env-file and process.loadEnvFile() keep a variable the environment already has: unset HAAU3_API_KEY " +
        "where it is set to nothing, then load the file.",
    );
    expect(shown(error)).not.toContain(MARKER);
  });

  it("leaves nothing of the file on RegExp's legacy statics", () => {
    const dir = folder({ ".env": `DATABASE_URL=postgres://u:OTHERsecret@h/db\n${LINE}` });
    /x/.test("x");
    refusedIn(dir, "absent");
    expect(regExpStatics()).not.toContain(MARKER);
    expect(regExpStatics()).not.toContain("OTHERsecret");
  });

  it("with no such file, says where a key comes from, the command line among them, and the Sandbox's way", () => {
    const error = refusedIn(folder({ ".env": "HAAU3_ENVIRONMENT=\n" }), "absent");
    expect(error.code).toBe("no-api-key");
    expect(error.message).toBe(
      "No API key. Set HAAU3_API_KEY, or pass it as new Haau3({ apiKey }). Create a free key at https://platform.haau3.com, " +
        "or run npx haau3 login, then npx haau3 keys create, which writes one to this project's env file " +
        "(see https://docs.haau3.com/authentication). To call the Sandbox with no key, set HAAU3_ENVIRONMENT=sandbox, " +
        'or pass new Haau3({ environment: "sandbox" }).',
    );
  });

  it("asks no file with a key, the Sandbox named, or an empty apiKey, which is the caller's own choice (the control)", () => {
    const dir = folder({ ".env": LINE });
    vi.spyOn(process, "cwd").mockReturnValue(dir);
    const asked = vi.spyOn(process, "getBuiltinModule");
    vi.stubEnv("HAAU3_API_KEY", undefined);
    expect(new Haau3({ fetch, apiKey: KEY }).environment).toBe("production");
    expect(new Haau3({ fetch, environment: "sandbox" }).environment).toBe("sandbox");
    const empty = refusedIn(dir, "absent", { apiKey: "" });
    expect(empty.code).toBe("no-api-key");
    expect(empty.message).not.toContain(".env");
    vi.stubEnv("HAAU3_ENVIRONMENT", "sandbox");
    expect(new Haau3({ fetch }).environment).toBe("sandbox");
    expect(asked).not.toHaveBeenCalled();
    vi.stubEnv("HAAU3_ENVIRONMENT", "");
    refusedIn(dir, "absent");
    expect(asked).toHaveBeenCalledWith("node:fs");
  });
});
