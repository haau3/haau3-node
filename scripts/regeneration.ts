// Decides what a regeneration pull request says and does (.github/workflows/regenerate.yml), from
// what oasdiff found between the pinned spec and the live one, and whether the generated code
// changed:
//
// - a change oasdiff grades ERR or WARN (with openapi/oasdiff-levels.txt) can break callers: the PR
//   is labelled `breaking` and titled `feat!:`, which release-please releases as a minor while the
//   SDK is 0.y.z;
// - any other change it reports is `feat:`, a patch;
// - generated code that changed with nothing reported (descriptions, which become doc comments) is
//   `fix:`, a patch;
// - generated code that did not change is `chore:`, which releases nothing: the new spec is pinned
//   and rides with the next release. A breaking change still labels such a PR, because the API
//   changed for its callers even though the SDK did not.
//
// The PR is squash-merged with its description as the commit body, and release-please reads that
// body too. So the description never starts a paragraph the way a Conventional Commit does, and
// never names a breaking-change footer or Release-As.

/** One change as `oasdiff changelog --format json` reports it. */
export interface Change {
  id: string;
  text: string;
  /** 3 is ERR, 2 is WARN, 1 is INFO. */
  level: number;
  operation?: string;
  path?: string;
}

export const WARN = 2;

export interface Regeneration {
  /** `info.version` of the pinned spec. */
  from: string;
  /** `info.version` of the live spec. */
  to: string;
  etag: string;
  specUrl: string;
  changes: Change[];
  /** Whether `pnpm generate` changed anything in src/generated/. */
  generatedChanged: boolean;
}

export interface Decision {
  title: string;
  /** Whether the PR carries the `breaking` label. */
  breaking: boolean;
  /** Whether merging it leads to a release. */
  releases: boolean;
  body: string;
}

/** GitHub refuses a PR description over 65,536 characters; this leaves room for its own text. */
export const MAX_BODY = 60_000;
const LISTED = 200;

export function decide(r: Regeneration): Decision {
  const breakingChanges = r.changes.filter((c) => c.level >= WARN);
  const otherChanges = r.changes.filter((c) => c.level < WARN);
  const breaking = breakingChanges.length > 0;
  const type = !r.generatedChanged ? "chore" : breaking ? "feat!" : r.changes.length > 0 ? "feat" : "fix";
  const title = `${type}: the API's spec at ${r.to}`;

  const effect = !r.generatedChanged
    ? breaking
      ? `Merging this pins the new spec and releases nothing, because the generated code did not change. oasdiff still found ${count(breakingChanges.length, "change")} that can break callers of the API, listed below.`
      : "Merging this pins the new spec and releases nothing, because the generated code did not change."
    : breaking
      ? `Merging this releases a minor version: oasdiff found ${count(breakingChanges.length, "change")} that can break callers, listed below.`
      : r.changes.length > 0
        ? "Merging this releases a patch version: the generated code changed, and nothing below breaks callers."
        : "Merging this releases a patch version: only descriptions or examples changed, and the generated doc comments with them.";

  const sections = [
    `The API's spec changed from \`${r.from}\` to \`${r.to}\`, read from ${r.specUrl} with ETag \`${r.etag}\`.`,
    effect,
    "If a check fails, this spec needs a change by hand (a method the README calls is gone, say). " +
      "Push the fix to this branch: haau3-bot never overwrites a commit it did not make.",
    "The title becomes the line in CHANGELOG.md, so rewrite it in plain words if you like, keeping its " +
      "prefix. Taking the `!` out of `feat!:` releases a patch instead of a minor.",
    ...list(`Changes that can break callers (${breakingChanges.length})`, breakingChanges),
    ...list(`Other changes (${otherChanges.length})`, otherChanges),
  ];
  let body = `${sections.join("\n\n")}\n`;
  if (body.length > MAX_BODY) {
    // The lists come last, so only their tail is lost.
    body = `${body.slice(0, body.lastIndexOf("\n", MAX_BODY))}\n- and more, cut short to fit\n`;
  }
  return { title, breaking, releases: r.generatedChanged, body };
}

function list(heading: string, changes: Change[]): string[] {
  if (changes.length === 0) return [];
  const lines = changes.slice(0, LISTED).map((c) => `- ${describe(c)}`);
  if (changes.length > LISTED) lines.push(`- and ${changes.length - LISTED} more`);
  return [`### ${heading}`, lines.join("\n")];
}

/** One change on one line: where, what, and oasdiff's rule. */
function describe(c: Change): string {
  const where = c.operation && c.path ? `\`${c.operation} ${c.path}\`: ` : "";
  return `${where}${c.text.replace(/\s+/g, " ").trim()} (\`${c.id}\`)`;
}

const count = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;
