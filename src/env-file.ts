// Which env file in the current folder sets HAAU3_API_KEY when the program's environment has no value
// for it: the case of a key written to `.env` (by hand, or by `npx haau3 keys create`) and a script
// run with plain `node`, which reads no env file. Asked only when a client is refused for having no
// key from HAAU3_API_KEY, so the refusal can name the file and how to load it.
//
// It never keeps or shows the value. The file is read into a buffer that is scanned byte by byte, with
// no string made from it and no regular expression run over it (a match would leave the text on
// `RegExp`'s legacy statics), and the buffer is zeroed before it is let go. Anything unexpected (no
// file system, a file that is not a regular file, a read that fails, a runtime that would ask
// permission to read) is taken as "no such file", so the refusal is then the one it was before.

/** The files a key is written to, in the order Next.js, Vite and the haau3 command line read them. */
export const ENV_FILES = [".env.local", ".env"] as const;

/** The most of a file read: a key is one short line, and a larger file is not an env file to read. */
export const ENV_FILE_LIMIT = 1024 * 1024;

type Fs = typeof import("node:fs");

/** Node's `fs` where the runtime has one, reached without an import so no bundle or edge runtime needs it. */
function fileSystem(): Fs | undefined {
  const g = globalThis as { Deno?: unknown; process?: { getBuiltinModule?: (id: string) => unknown } };
  // Deno asks the person for permission to read a file it was not given, so it is not asked at all.
  if (g.Deno !== undefined) return undefined;
  return g.process?.getBuiltinModule?.("node:fs") as Fs | undefined;
}

const bytesOf = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));
const NAME = bytesOf("HAAU3_API_KEY");
const EXPORT = bytesOf("export");
const EQUALS = 0x3d;
const HASH = 0x23;
const DOLLAR = 0x24;
const DOUBLE_QUOTE = 0x22;
const SINGLE_QUOTE = 0x27;
const NEWLINE = 0x0a;

const isBlank = (c: number | undefined) => c === 0x20 || c === 0x09;
const isSpace = (c: number | undefined) => c !== undefined && (isBlank(c) || (c >= 0x0a && c <= 0x0d));

/** Whether `word` is at `at` in `bytes`, before `end`. */
function wordAt(bytes: Uint8Array, at: number, end: number, word: Uint8Array): boolean {
  if (at + word.length > end) return false;
  for (let k = 0; k < word.length; k++) if (bytes[at + k] !== word[k]) return false;
  return true;
}

/**
 * Whether one line, `bytes[start, end)`, assigns HAAU3_API_KEY (the name at the start of the line,
 * after blanks and an optional `export`, then `=`), and if it does, whether it sets it to something:
 * a value that is not empty, a comment, quotes holding nothing or a blank first, or a reference to
 * another variable. Undefined when the line assigns nothing.
 */
function assignment(bytes: Uint8Array, start: number, end: number): boolean | undefined {
  let at = start;
  const skipBlanks = () => {
    while (at < end && isBlank(bytes[at])) at++;
  };
  skipBlanks();
  if (wordAt(bytes, at, end, EXPORT) && isBlank(bytes[at + EXPORT.length])) {
    at += EXPORT.length;
    skipBlanks();
  }
  if (!wordAt(bytes, at, end, NAME)) return undefined;
  at += NAME.length;
  skipBlanks();
  if (at >= end || bytes[at] !== EQUALS) return undefined;
  at++;
  skipBlanks();
  if (at >= end) return false;
  const first = bytes[at];
  if (first === DOUBLE_QUOTE || first === SINGLE_QUOTE) {
    const next = at + 1 < end ? bytes[at + 1] : undefined;
    return next !== undefined && next !== first && !isSpace(next);
  }
  return !isSpace(first) && first !== HASH && first !== DOLLAR;
}

/** Whether the last line assigning HAAU3_API_KEY sets it, since a loader keeps the last. */
function lastAssignmentSetsTheKey(bytes: Uint8Array): boolean {
  let set = false;
  for (let start = 0; start < bytes.length; ) {
    const newline = bytes.indexOf(NEWLINE, start);
    const end = newline === -1 ? bytes.length : newline;
    const verdict = assignment(bytes, start, end);
    if (verdict !== undefined) set = verdict;
    start = end + 1;
  }
  return set;
}

/**
 * Whether a file sets HAAU3_API_KEY, reading at most ENV_FILE_LIMIT bytes. The path is asked what it
 * is before it is opened, so a named pipe is never opened: secret managers mount `.env` as one, and an
 * open would count as a read, or ask the person to approve one. The open never blocks, and the open
 * file is asked again, so a pipe swapped in between is not read either. A byte-order mark before the
 * first line is not skipped, as Node's own loader does not skip it.
 */
function setsTheKey(fs: Fs, path: string): boolean {
  if (!fs.statSync(path).isFile()) return false;
  const fd = fs.openSync(path, fs.constants.O_RDONLY | (fs.constants.O_NONBLOCK ?? 0));
  let bytes: Uint8Array | undefined;
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile()) return false;
    bytes = new Uint8Array(Math.min(stat.size, ENV_FILE_LIMIT));
    const read = fs.readSync(fd, bytes, 0, bytes.length, 0);
    return lastAssignmentSetsTheKey(bytes.subarray(0, read));
  } finally {
    // The file holds the key and any other secret in it: nothing of it outlives this call.
    bytes?.fill(0);
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
        // A doubled separator is harmless, and stripping one could name another folder.
        if (setsTheKey(fs, `${base}/${name}`)) return name;
      } catch {
        // No such file, or one that cannot be read: the next one is still asked.
      }
    }
    return undefined;
  } catch {
    return undefined;
  }
}
