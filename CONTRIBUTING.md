# Contributing

Issues are welcome: a bug, a confusing name, a missing example.

## Working on the SDK

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm build
pnpm check:package
```

Node 24 and pnpm 12. pnpm installs no version of anything published in the last three days.

## Generated code

`src/generated/`, `api.md` and `openapi/code-samples.json` are written by `scripts/generate.ts` from
`openapi/openapi.json`, the pinned copy of `https://api.haau3.com/openapi.json`. Never edit them by
hand. To take a new spec:

```sh
pnpm fetch-spec
pnpm generate
```

CI generates again and fails if the result differs from what is committed.

`openapi/code-samples.json` is an [OpenAPI Overlay](https://spec.openapis.org/overlay/latest.html)
that adds a TypeScript sample to every operation as `x-codeSamples`, for a documentation site to show
beside it. Each sample is a whole program that sends the operation's example request from the spec
and prints one field of the answer. `test/samples.test.ts` runs each one as it is written, with
`HAAU3_BASE_URL` pointing at a stand-in that answers only the example request, and
`scripts/check-consumer.ts` compiles them, and every TypeScript block of the README, against the
packed package.

`src/generated/batch.ts` is the builder `batch()` hands its caller: one method per operation on the
FHIR base, minus the ones a batch cannot carry, which the generator names in `NOT_IN_A_BATCH` with
the spec's own words. It stops if one of those leaves the spec.

The types come from [openapi-typescript](https://github.com/openapi-ts/openapi-typescript) 7.13.0,
which declares TypeScript 5 as its peer. This repository builds with TypeScript 6.0.3. Before
0.1.0 the generator's output under TypeScript 5.9.3 and 6.0.3 was compared and is byte-identical
(252,838 bytes, sha256 `d547d7c1430e1118940668d1f6a965afc3b695e3c4eb720e9680e75b6d83cb5e`).
TypeScript 7 ships no compiler API, which the generator calls, so it stays out until the generator
supports it.

## When the API changes

`.github/workflows/regenerate.yml` fetches the spec every morning, and can be run by hand
(`gh workflow run regenerate.yml`). When the spec changed, it regenerates the SDK and opens one pull
request as haau3-bot, or updates the one already open. It never overwrites a commit it did not
make, so a fix pushed to its branch stays.

[oasdiff](https://github.com/oasdiff/oasdiff) compares the pinned spec with the new one, and a change
it grades as an error or a warning can break callers: the PR is labelled `breaking` and titled
`feat!:`. `openapi/oasdiff-levels.txt` changes six of oasdiff's grades (the file takes no comments,
so the reasons are here):

- three changes break a typed caller although they do not break an HTTP one, so each is an error: a
  changed operationId (`api-operation-id-removed`) renames a method, a removed optional response
  property (`response-optional-property-removed`) stops code that reads it compiling, and a removed
  component (`api-schema-removed`) removes an exported type;
- three rules compare `info.version` as a release number and misread `1.0.0-preview.N`, so they are
  off (`api-version-decreased`, `api-version-not-bumped`, `api-major-version-not-bumped`).

If neither the generated code nor the samples changed, the PR is titled `chore:` and releases nothing. To run oasdiff
yourself, against the spec on `main`:

```sh
oasdiff changelog old.json openapi/openapi.json --severity-levels openapi/oasdiff-levels.txt
```

## Pull requests and releases

Pull requests are squash-merged, and a PR's title becomes its commit on `main`.
[release-please](https://github.com/googleapis/release-please) reads those titles and keeps one
release PR open with the next version and its changelog:

- `feat: ...` and `fix: ...` release a patch, 0.1.1 to 0.1.2.
- `feat!: ...` releases a minor, 0.1.1 to 0.2.0. While the SDK is `0.y.z`, a minor is the only
  release that may change what a method takes or answers.
- Any other title (`docs: ...`, `chore: ...`, `README: ...`) releases nothing.

The title is the line a reader sees in `CHANGELOG.md`, so it says what changed for someone using the
SDK. Like every file, commit message and PR description here, it says only what this repository
shows: CI's "Public text" check (`pnpm check:public-text`) fails on anything that refers elsewhere,
such as an issue number without its repository. Merging the release PR makes the GitHub Release and its tag, and `release.yml` stages that
version on npm with provenance. It is published once a maintainer approves it on npm.

## Tests

The tests run against a fake `fetch`. `test/live.test.ts` calls the production API, and runs only
with `HAAU3_LIVE_TEST=1` and a key in `HAAU3_API_KEY`.

`scripts/check-consumer.ts` packs the package, installs it into a fresh project and compiles a
customer's code against it under TypeScript 5.9, 6.0 and 7.0.
