// Which env file in the current folder sets HAAU3_API_KEY when the program never loaded it: the
// case of a key written to `.env` (by hand, or by `npx haau3 keys create`) and a script run with
// plain `node`, which reads no env file. Asked only when a client is refused for having no key, so
// the refusal can name the file and how to load it.
//
// It looks for the variable's name and nothing else. The value is never parsed out, compared, kept
// or shown. Anything unexpected (no file system, a file that is not a regular file, a read that
// fails, a runtime that would ask permission to read) is taken as "no such file", so the refusal is
// then the one it was before.

/** The files a key is written to, in the order Next.js, Vite and the haau3 command line read them. */
export const ENV_FILES = [".env.local", ".env"] as const;

/** The most of a file read: a key is one short line, and a larger file is not an env file to read. */
export const ENV_FILE_LIMIT = 1024 * 1024;

/**
 * A line that sets HAAU3_API_KEY to something: the name at the start of a line (after spaces and an
 * optional `export`), `=`, then a value that is not empty, a comment or an empty pair of quotes.
 */
const SETS_THE_KEY = /^[ \t]*(?:export[ \t]+)?HAAU3_API_KEY[ \t]*=[ \t]*(?:"[^"\r\n]|'[^'\r\n]|[^\s#"'])/m;

type Fs = typeof import("node:fs");

/** Node's `fs` where the runtime has one, reached without an import so no bundle or edge runtime needs it. */
function fileSystem(): Fs | undefined {
  const g = globalThis as { Deno?: unknown; process?: { getBuiltinModule?: (id: string) => unknown } };
  // Deno asks the person for permission to read a file it was not given, so it is not asked at all.
  if (g.Deno !== undefined) return undefined;
  return g.process?.getBuiltinModule?.("node:fs") as Fs | undefined;
}

/** Whether a file sets HAAU3_API_KEY, reading at most ENV_FILE_LIMIT bytes, never blocking on a pipe. */
function setsTheKey(fs: Fs, path: string): boolean {
  // A non-blocking open, so a named pipe called `.env` cannot hold the program; then only a regular file.
  const fd = fs.openSync(path, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) return false;
    const buffer = Buffer.alloc(Math.min(stat.size, ENV_FILE_LIMIT));
    const read = fs.readSync(fd, buffer, 0, buffer.length, 0);
    // The name is plain ASCII, so latin1 reads it whatever the file's encoding; a byte-order mark
    // before the first line is skipped.
    const text = buffer.subarray(0, read).toString("latin1").replace(/^\xEF\xBB\xBF/, "");
    return SETS_THE_KEY.test(text);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * The first of {@link ENV_FILES} in `folder` that sets HAAU3_API_KEY, or undefined: none does, the
 * runtime has no file system, or anything went wrong. `folder` is the current folder unless given.
 */
export function unloadedEnvFile(folder?: string): (typeof ENV_FILES)[number] | undefined {
  try {
    const fs = fileSystem();
    if (fs === undefined) return undefined;
    const g = globalThis as { process?: { cwd?: () => string } };
    const base = folder ?? g.process?.cwd?.();
    if (base === undefined) return undefined;
    for (const name of ENV_FILES) {
      try {
        if (setsTheKey(fs, `${base.replace(/[\\/]+$/, "")}/${name}`)) return name;
      } catch {
        // No such file, or one that cannot be read: the next one is still asked.
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}
