# Changelog

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
