# @haau3/sdk

The TypeScript SDK for the [haau3 platform API](https://docs.haau3.com): scheduling, the provider
directory, terminology, questionnaires, plan benefits and MedList, as typed calls.

The haau3 platform API is in preview: it may change as we build, usually to add features or improve performance.

## Install

```sh
npm install @haau3/sdk
```

Node 22 or newer. The SDK runs on a server only: it refuses to start in a browser, where your API
key would be public.

## Authenticate

Create an API key on [platform.haau3.com](https://platform.haau3.com), then set it as
`HAAU3_API_KEY` or pass it as `apiKey`.

```ts
import { Haau3 } from "@haau3/sdk";

const haau3 = new Haau3(); // reads HAAU3_API_KEY
```

## A first call

```ts
const plan = await haau3.readInsurancePlan("H2406-013-000");
console.log(plan.name); // "AARP Medicare Advantage from UHC FL-0021 (PPO)"
```

FHIR answers are [@types/fhir](https://www.npmjs.com/package/@types/fhir)'s R4 types, also
exported as `fhir4` (`import type { fhir4 } from "@haau3/sdk"`).

## One call per service

```ts
// Scheduling: open appointment slots, here in Boston.
const { slots, total } = await haau3.searchSlots({ city: "Boston", state: "MA", limit: 10 });

// Provider directory: a practitioner by NPI, from CMS's National Provider Directory.
const practitioners = await haau3.searchPractitioner({ identifier: "1093209884" });

// Terminology: a LOINC code's display and properties.
const glucose = await haau3.codeSystemLookup({ system: "http://loinc.org", code: "2345-7" });

// Questionnaires: a form by its id, such as the PHQ-9.
const phq9 = await haau3.readQuestionnaire("44249-1");

// Plan Benefits: a Medicare Advantage or ACA Marketplace plan, and which providers are in its network.
const plan = await haau3.readInsurancePlan("H2406-013-000");
const network = await haau3.checkInsurancePlanNetwork("H3359-038-000", { npi: ["1518929058"] });

// MedList: one reconciled medication list from one patient's FHIR medication records. It receives
// patient data, so send it only under an executed agreement.
const list = await haau3.reconcileMedications(records);
```

Every method, grouped by service, with its request and a link to its page on docs.haau3.com, is in
[api.md](https://github.com/haau3/haau3-node/blob/main/api.md). Each is named by its operationId,
with its parameters and its answer typed from the published spec.

## Options

| Option | Default | |
|---|---|---|
| `apiKey` | `process.env.HAAU3_API_KEY` | Your platform API key. |
| `baseURL` | `https://api.haau3.com` | Where the API is. |
| `timeout` | `65000` | Milliseconds one attempt may take. |
| `maxRetries` | `1` | Retries after a timeout, a network failure, a 429 or a 5xx. |
| `fetch` | the global `fetch` | The fetch to send requests with. |

Each call takes `{ timeout, maxRetries, signal, headers }` as its last argument, for that call only:

```ts
await haau3.searchSlots({ state: "MA" }, { timeout: 10_000, maxRetries: 0 });
```

A retry waits a short, growing interval, or what the API's `Retry-After` header says when that is
60 seconds or less. A longer `Retry-After` fails at once, carrying it.

## Errors

Every error is a `Haau3Error`, with the `requestId` the API answered with. There are three kinds:

```ts
import { AuthError, NoAnswerError, RefusedError } from "@haau3/sdk";

try {
  await haau3.readInsurancePlan(id);
} catch (error) {
  if (error instanceof RefusedError) {
    error.status; // 400, 404, 410 and so on
    error.outcome; // the OperationOutcome; Scheduling's errors carry `problem`
  } else if (error instanceof NoAnswerError) {
    error.reason; // "timeout", "network", "rate-limited", "unavailable", "server-error" or "unreadable"
    error.retryAfter; // seconds, when the API said
  } else if (error instanceof AuthError) {
    // the key was missing, unknown or revoked
  }
}
```

No answer is never reported as an empty result, and an empty result is never an error. An error's
message never includes the body the API answered with, and the body (`outcome` or `problem`) is
never printed when the error is logged.

## Paging

`pages()` yields a FHIR search's first page and every page after it:

```ts
const first = await haau3.searchInsurancePlan({ "coverage-area-state": "NC" });
for await (const page of haau3.pages(first)) {
  for (const entry of page.entry ?? []) console.log(entry.resource?.id);
}
```

Scheduling's searches page with `limit` and `offset`, and answer with a `total`.

## Several requests in one

```ts
const answers = await haau3.fhirBatch({
  resourceType: "Bundle",
  type: "batch",
  entry: [
    { request: { method: "GET", url: "CodeSystem/$lookup?system=http://loinc.org&code=2345-7" } },
    { request: { method: "GET", url: "InsurancePlan/$counties?state=NC" } },
  ],
});
```

## Any request

`request()` sends a request as you give it and returns what the API answered, whatever the
status, with its headers, request id, attempts and duration:

```ts
const { status, body, requestId } = await haau3.request({ method: "GET", path: "/v1/scheduling/publishers" });
```

## Versions

The SDK is `0.y.z` while the API is in preview: a minor release may change what a method takes or
answers, and a patch release never does. [CHANGELOG.md](CHANGELOG.md) lists every release, and a
release that takes a new version of the API's spec names that version.

## License

[MIT](LICENSE)
