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

`src/generated/` and `api.md` are written by `scripts/generate.ts` from `openapi/openapi.json`, the
pinned copy of `https://api.haau3.com/openapi.json`. Never edit them by hand. To take a new spec:

```sh
pnpm fetch-spec
pnpm generate
```

CI generates again and fails if the result differs from what is committed.

The types come from [openapi-typescript](https://github.com/openapi-ts/openapi-typescript) 7.13.0,
which declares TypeScript 5 as its peer. This repository builds with TypeScript 6.0.3. Before
0.1.0 the generator's output under TypeScript 5.9.3 and 6.0.3 was compared and is byte-identical
(252,838 bytes, sha256 `d547d7c1430e1118940668d1f6a965afc3b695e3c4eb720e9680e75b6d83cb5e`).
TypeScript 7 ships no compiler API, which the generator calls, so it stays out until the generator
supports it.

## Tests

The tests run against a fake `fetch`. `test/live.test.ts` calls the production API, and runs only
with `HAAU3_LIVE_TEST=1` and a key in `HAAU3_API_KEY`.

`scripts/check-consumer.ts` packs the package, installs it into a fresh project and compiles a
customer's code against it under TypeScript 5.9, 6.0 and 7.0.
