# @haau3/sdk

The TypeScript SDK for the [haau3 platform API](https://docs.haau3.com), as typed calls:

- **Scheduling:** open appointment slots from many SMART Scheduling Links publishers, in one search.
- **Plan Benefits:** Medicare Advantage and ACA Marketplace plans as FHIR `InsurancePlan`,
  searchable by state or county, and which providers are in a plan's network.
- **MedList:** one reconciled medication list from one patient's FHIR medication records.

On the same key and FHIR base: RxNorm and LOINC lookups, value sets and code validation
(Terminology), practitioners and organizations from CMS's National Provider Directory (Provider
directory), and standard FHIR Questionnaires such as the PHQ-9.

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

## With an AI coding agent

An agent can read the docs directly:

- [docs.haau3.com/llms.txt](https://docs.haau3.com/llms.txt) lists every docs page as Markdown.
- `https://docs.haau3.com/mcp` is an MCP server that searches the docs. In Claude Code:
  `claude mcp add --transport http haau3 https://docs.haau3.com/mcp`.

## Options

| Option | Default | |
|---|---|---|
| `apiKey` | `process.env.HAAU3_API_KEY` | Your platform API key. |
| `baseURL` | `https://api.haau3.com` | Where the API is. |
| `timeout` | `65000` | Milliseconds one attempt may take. |
| `maxRetries` | `1` | Retries after a timeout, a network failure, a 429 or a 5xx. |
| `fetch` | the global `fetch` | The fetch to send requests with. |
| `fetchOptions` | `{ cache: "no-store" }` | Passed on to `fetch` with every request, for any runtime. |

Each call takes `{ timeout, maxRetries, signal, headers, fetchOptions }` as its last argument, for
that call only:

```ts
await haau3.searchSlots({ state: "MA" }, { timeout: 10_000, maxRetries: 0 });
```

`fetchOptions` passes anything your runtime's `fetch` takes, on the client or on one call: a proxy
`dispatcher` from undici in Node, Cloudflare's `cf`, Next.js's `next`, `keepalive`. The SDK's own
method, headers, body, signal and redirect always win.

```ts
import { ProxyAgent } from "undici";

const haau3 = new Haau3({ fetchOptions: { dispatcher: new ProxyAgent("http://proxy.internal:8080") } });
```

Unless `fetchOptions` sets `cache`, every request is sent with `cache: "no-store"` where the
runtime's fetch takes the field (Node's does; on a runtime that refuses it, the SDK sends none). An
answer is live data for your key, not something a fetch cache should keep. Frameworks that cache
`fetch` follow it: in Next.js it also keeps `next build` from sending a request while it prerenders
a page, and `{ next: { revalidate: 60 } }` caches an answer there instead. `{ cache: undefined }`
sends no `cache` at all.

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
never printed when the error is logged. Every error the API answered carries `attempts` and
`durationMs` too.

A FHIR answer is checked against the resource types its operation answers with. Anything else, a
`Bundle` where an `InsurancePlan` was asked for, say, is a `NoAnswerError` with reason `"unreadable"`,
so what a method returns is always the type it says.

## Request ids and timing

Every method's answer can be awaited as it is, or through `.withResponse()` for the request id and
timing that came with it, in the same names `request()` uses:

```ts
const { data: plan, requestId, durationMs, attempts } = await haau3.readInsurancePlan(id).withResponse();
```

Quote the `requestId` when you ask for help: it finds the request in the API's own logs.

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

`batch()` sends several operations of the FHIR base as one request. The function you pass gets a
builder with the client's own methods, called the same way, which make entries instead of sending.
Each entry gets its own result, in the order given:

```ts
const [plan, counties] = await haau3.batch((b) => [
  b.readInsurancePlan("H2406-013-000"),
  b.listInsurancePlanCounties({ state: "NC" }),
]);

if (plan.ok) {
  plan.data; // fhir4.InsurancePlan
} else {
  plan.error; // a RefusedError or a NoAnswerError, as readInsurancePlan alone would have thrown
}
```

A list built in code works the same way:

```ts
const lookups = await haau3.batch((b) =>
  codes.map((code) => b.codeSystemLookup({ system: "http://loinc.org", code, property: "CLASSTYPE" })),
);
```

Each entry is checked as the call alone is, and fails alone while the others answer. An entry that
fails is not retried. The batch itself is retried, and throws, as any call does, and
`.withResponse()` gives its request id. The API takes up to 100 entries in up to 1 MiB and gives a
batch 60 seconds, so send a longer list as several batches. Every operation on the FHIR base can go
in a batch except `reconcileMedications`.

To send a batch `Bundle` you built yourself, `fhirBatch()` takes it and returns the
`batch-response` as it is.

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
