# Changelog

## [0.3.2](https://github.com/haau3/haau3-node/compare/v0.3.1...v0.3.2) (2026-10-29)


### Bug Fixes

* the API's spec at 1.0.0-preview.19 ([#52](https://github.com/haau3/haau3-node/issues/52)) ([5b76fb2](https://github.com/haau3/haau3-node/commit/5b76fb293336def7413e226e52f2847e5c3e96e9))

## [0.3.1](https://github.com/haau3/haau3-node/compare/v0.3.0...v0.3.1) (2026-10-29)


### Features

* the API's spec at 1.0.0-preview.18 ([#49](https://github.com/haau3/haau3-node/issues/49)) ([704eb25](https://github.com/haau3/haau3-node/commit/704eb259b0175f0dc94c5b84dc09b63f6b5c7fa3))

## [0.3.0](https://github.com/haau3/haau3-node/compare/v0.2.14...v0.3.0) (2026-10-28)


### ⚠ BREAKING CHANGES

* a 403 is a ForbiddenError of its own, beside AuthError, which is a 401 only ([#46](https://github.com/haau3/haau3-node/issues/46))

### Features

* a 403 is a ForbiddenError of its own, beside AuthError, which is a 401 only ([#46](https://github.com/haau3/haau3-node/issues/46)) ([546a44b](https://github.com/haau3/haau3-node/commit/546a44bee32faa9a56e3f8ab0e13365eb05a2413))
* a record written inline in a request's Bundle or Parameters is typed as the resource it is ([#45](https://github.com/haau3/haau3-node/issues/45)) ([71591fb](https://github.com/haau3/haau3-node/commit/71591fb5f0e719f2076c12ef1477d8675baeeb32))
* markAsTestData labels a request and every resource in it as test data ([#47](https://github.com/haau3/haau3-node/issues/47)) ([3f403bc](https://github.com/haau3/haau3-node/commit/3f403bc24a12d46ad5bd7cf850c860cc4d7edb42))

## [0.2.14](https://github.com/haau3/haau3-node/compare/v0.2.13...v0.2.14) (2026-10-28)


### Features

* a 403 says why, and every answer and error carries its status text ([#44](https://github.com/haau3/haau3-node/issues/44)) ([77cd904](https://github.com/haau3/haau3-node/commit/77cd904a19c0d57839f0a7c67cc8a303f7474955))
* the API's spec at 1.0.0-preview.16 ([#42](https://github.com/haau3/haau3-node/issues/42)) ([6c358d7](https://github.com/haau3/haau3-node/commit/6c358d7aa2844c3d04735d82d03f4ea1b1b000c8))

## [0.2.13](https://github.com/haau3/haau3-node/compare/v0.2.12...v0.2.13) (2026-10-28)


### Features

* the API's spec at 1.0.0-preview.15 ([#39](https://github.com/haau3/haau3-node/issues/39)) ([678ff93](https://github.com/haau3/haau3-node/commit/678ff93018eed5555b0bdd49d82c286e408ddb38))


### Bug Fixes

* a call to the Sandbox's FHIR base sends and asks for FHIR JSON ([#40](https://github.com/haau3/haau3-node/issues/40)) ([733b116](https://github.com/haau3/haau3-node/commit/733b1160fe2ab373d865562f50911a2a7042abcc))

## [0.2.12](https://github.com/haau3/haau3-node/compare/v0.2.11...v0.2.12) (2026-10-26)


### Features

* the API's spec at 1.0.0-preview.13 ([#36](https://github.com/haau3/haau3-node/issues/36)) ([7ad996e](https://github.com/haau3/haau3-node/commit/7ad996eb9b14c7c7e518c123684d8a7cc61d380b))

## [0.2.11](https://github.com/haau3/haau3-node/compare/v0.2.10...v0.2.11) (2026-10-23)


### Features

* a header an operation declares is an option of its own ([#35](https://github.com/haau3/haau3-node/issues/35)) ([0273f26](https://github.com/haau3/haau3-node/commit/0273f266a0b4d6429ef512817539c2c1fdf5acd2))
* the API's spec at 1.0.0-preview.12 ([#32](https://github.com/haau3/haau3-node/issues/32)) ([c85f9c8](https://github.com/haau3/haau3-node/commit/c85f9c82e905f944aa47a81f07fc304f8330f82b))

## [0.2.10](https://github.com/haau3/haau3-node/compare/v0.2.9...v0.2.10) (2026-10-21)


### Features

* matches() and resolve(), a page's matches typed, and what a reference names in it ([#30](https://github.com/haau3/haau3-node/issues/30)) ([357ec90](https://github.com/haau3/haau3-node/commit/357ec903493c95eb1da5b613909315ad9e5c3aa2))

## [0.2.9](https://github.com/haau3/haau3-node/compare/v0.2.8...v0.2.9) (2026-10-21)


### Features

* the API's spec at 1.0.0-preview.10 ([#26](https://github.com/haau3/haau3-node/issues/26)) ([ca165cb](https://github.com/haau3/haau3-node/commit/ca165cbbeed0597b292f523da56e0ad3d3db9138))

## [0.2.8](https://github.com/haau3/haau3-node/compare/v0.2.7...v0.2.8) (2026-10-21)


### Features

* a 403 is a ForbiddenError, which says the key was accepted ([#27](https://github.com/haau3/haau3-node/issues/27)) ([e02afd2](https://github.com/haau3/haau3-node/commit/e02afd2177cb6f48772d0afa6557bca806db2537))

## [0.2.7](https://github.com/haau3/haau3-node/compare/v0.2.6...v0.2.7) (2026-10-20)


### Features

* the API's spec at 1.0.0-preview.6, with the batch's exclusions read from it ([#24](https://github.com/haau3/haau3-node/issues/24)) ([96171cc](https://github.com/haau3/haau3-node/commit/96171cceea437d1940878501be23e9aa7ab46ebf))

## [0.2.6](https://github.com/haau3/haau3-node/compare/v0.2.5...v0.2.6) (2026-10-19)


### Bug Fixes

* the API's spec at 1.0.0-preview.4 ([#20](https://github.com/haau3/haau3-node/issues/20)) ([4d314c7](https://github.com/haau3/haau3-node/commit/4d314c7913bde9cd4327ea4490fb318c4f6cebb8))

## [0.2.5](https://github.com/haau3/haau3-node/compare/v0.2.4...v0.2.5) (2026-10-19)


### Features

* a code sample for every operation, HAAU3_BASE_URL, and FHIR types for MedList's body ([#18](https://github.com/haau3/haau3-node/issues/18)) ([0500381](https://github.com/haau3/haau3-node/commit/05003814984158388351d88589b6e0b415bafada))

## [0.2.4](https://github.com/haau3/haau3-node/compare/v0.2.3...v0.2.4) (2026-10-19)


### Features

* resources() yields every resource a FHIR search found, across its pages ([#16](https://github.com/haau3/haau3-node/issues/16)) ([d8b2c69](https://github.com/haau3/haau3-node/commit/d8b2c693ce9b87f212c4711ae5a933183ee89ae7))

## [0.2.3](https://github.com/haau3/haau3-node/compare/v0.2.2...v0.2.3) (2026-10-19)


### Features

* a failure with no answer says what failed, request() gives the status text, and the User-Agent names the runtime ([#14](https://github.com/haau3/haau3-node/issues/14)) ([5a5fd7d](https://github.com/haau3/haau3-node/commit/5a5fd7d5b52b0a9a9bd5f7814e81e56a391bf9b1))

## [0.2.2](https://github.com/haau3/haau3-node/compare/v0.2.1...v0.2.2) (2026-10-19)


### Features

* batch() sends several calls in one request, correlationId sends your own request id, and errors give toJSON() ([#12](https://github.com/haau3/haau3-node/issues/12)) ([d5ae704](https://github.com/haau3/haau3-node/commit/d5ae70460c5be637b9c5c2219257fa97f0cff169))

## [0.2.1](https://github.com/haau3/haau3-node/compare/v0.2.0...v0.2.1) (2026-10-19)


### Bug Fixes

* the package's homepage is platform.haau3.com ([#9](https://github.com/haau3/haau3-node/issues/9)) ([f0b4b05](https://github.com/haau3/haau3-node/commit/f0b4b05a49690fab0261c58b7819f80d64521d8d))

## [0.2.0](https://github.com/haau3/haau3-node/compare/v0.1.2...v0.2.0) (2026-10-19)


### ⚠ BREAKING CHANGES

* request ids and timing on every call, checked FHIR answer types, no-store by default ([#7](https://github.com/haau3/haau3-node/issues/7))

### Features

* request ids and timing on every call, checked FHIR answer types, no-store by default ([#7](https://github.com/haau3/haau3-node/issues/7)) ([6cb6291](https://github.com/haau3/haau3-node/commit/6cb62916a3f1ffd40db12b6dcf4c15e470e4303d))

## [0.1.2](https://github.com/haau3/haau3-node/compare/v0.1.1...v0.1.2) (2026-10-18)


### Bug Fixes

* request the release PR's review only when there is one ([#4](https://github.com/haau3/haau3-node/issues/4)) ([929692e](https://github.com/haau3/haau3-node/commit/929692e4bd6d5e8878264896d50a66506d3fa3e9))

## [0.1.1](https://github.com/haau3/haau3-node/compare/v0.1.0...v0.1.1) (2026-10-18)

### Documentation

* The README shows one call for each service, and `api.md` lists every method with a link to its page on docs.haau3.com.

## 0.1.0 (2026-10-18)

### Features

* A typed client for every operation of the haau3 platform API at `1.0.0-preview.3`, each a method named by its operationId, with FHIR answers typed by `@types/fhir`.
* Retries on timeouts, network failures, 429 and 5xx, waiting a `Retry-After` of 60 seconds or less.
* Three errors, `AuthError`, `RefusedError` and `NoAnswerError`, each carrying the request id and never printing the body it was answered with.
* `pages()` follows a FHIR Bundle's `next` links, and `request()` sends any request to the API.
