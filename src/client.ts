import type { Bundle, FhirResource, Reference } from "fhir/r4.js";
import { APIPromise, type WithResponse } from "./api-promise.js";
import { batchBundle, readBatch, type BatchEntry, type BatchResults } from "./batch.js";
import { matchesIn, resolveIn, type ResolveOptions, type ResourceOf, type ResourceType } from "./bundles.js";
import { NoAnswerError } from "./errors.js";
import { BatchBuilder } from "./generated/batch.js";
import { Operations } from "./generated/methods.js";
import type { ClientOptions, RequestOptions } from "./transport.js";

/** The builder every batch is handed. It holds nothing, so one serves every call. */
const builder = new BatchBuilder();

/**
 * The haau3 platform API client.
 *
 * ```ts
 * import { Haau3 } from "@haau3/sdk";
 *
 * const haau3 = new Haau3(); // reads HAAU3_API_KEY
 * const plan = await haau3.readInsurancePlan("H2406-013-000");
 * ```
 *
 * Every operation of the API is a method named by its operationId. Server-side only: the
 * constructor refuses to run in a browser, where a key would be public.
 */
export class Haau3 extends Operations {
  constructor(options: ClientOptions = {}) {
    super(options);
  }

  /**
   * Every page of a FHIR search, starting with the one you have, following each `next` link
   * until there is none. A link to any host but the client's own `baseURL` is refused, so the key
   * is never sent elsewhere.
   *
   * ```ts
   * const first = await haau3.searchInsurancePlan({ "coverage-area-state": "NC" });
   * for await (const page of haau3.pages(first)) {
   *   for (const entry of page.entry ?? []) console.log(entry.resource?.id);
   * }
   * ```
   */
  async *pages(first: Bundle, options: RequestOptions = {}): AsyncGenerator<Bundle, void, undefined> {
    let page: Bundle | undefined = first;
    const followed = new Set<string>();
    while (page) {
      yield page;
      const next = page.link?.find((link) => link.relation === "next")?.url;
      if (!next) return;
      const url = this.url(next);
      // A link back to a page already read would page forever.
      if (followed.has(url.href)) {
        throw new NoAnswerError(`GET ${url.pathname} answered with a next link to a page already read, so paging stopped.`, {
          reason: "unreadable",
          attempts: 0,
        });
      }
      followed.add(url.href);
      page = await this.answer<Bundle>("GET", url, undefined, options, url.pathname, ["Bundle"]);
    }
  }

  /**
   * Every resource a FHIR search found, across every page, in order: each entry whose search mode
   * is `match`, or says none. A resource an `_include` or `_revinclude` brought, and a search's own
   * OperationOutcome, are not among them; {@link pages} gives every entry.
   *
   * Each is typed as FHIR R4's union of resources, so checking `resourceType` narrows it. Each page
   * is checked to be a Bundle; the resources in it are not checked one by one.
   *
   * ```ts
   * const first = await haau3.searchInsurancePlan({ "coverage-area-state": "VT" });
   * for await (const resource of haau3.resources(first)) {
   *   if (resource.resourceType === "InsurancePlan") console.log(resource.name);
   * }
   * ```
   */
  async *resources(first: Bundle, options: RequestOptions = {}): AsyncGenerator<FhirResource, void, undefined> {
    for await (const page of this.pages(first, options)) yield* matchesIn(page);
  }

  /**
   * One page's matches, with no request: each entry whose search mode is `match`, or says none, and
   * of `type` when you give one, typed as it. A resource an `_include` brought is not among them;
   * {@link resolve} finds it from the reference that names it. {@link resources} gives the matches
   * of every page.
   *
   * ```ts
   * const page = await haau3.searchHealthcareService({ "service-category": "pharm", "location.address-state": "FL", "location.address-postalcode": "33131" });
   * for (const service of haau3.matches(page, "HealthcareService")) console.log(service.name);
   * ```
   */
  matches<K extends ResourceType = ResourceType>(page: Bundle, type?: K): ResourceOf<K>[] {
    return matchesIn(page, type);
  }

  /**
   * The resource a reference names, found in a Bundle with no request, as FHIR R4 resolves one:
   * a resource an `_include` brought, a message's other entries, a contained resource. Undefined
   * when the Bundle does not hold it, so a reference to a resource elsewhere is yours to read.
   *
   * ```ts
   * const page = await haau3.searchHealthcareService({
   *   "service-category": "pharm",
   *   "location.address-state": "FL",
   *   "location.address-postalcode": "33131",
   *   _include: ["HealthcareService:organization", "HealthcareService:location"],
   * });
   * for (const service of haau3.matches(page, "HealthcareService")) {
   *   const organization = haau3.resolve(page, service.providedBy, { type: "Organization" });
   *   const store = haau3.resolve(page, service.location?.[0], { type: "Location" });
   * }
   * ```
   *
   * - An absolute reference (`https://...`, `urn:uuid:...`) is the entry with that `fullUrl`.
   * - A relative one (`Organization/123`) is resolved against the address of the entry holding
   *   the reference when you pass that resource as `from`, as FHIR says; without `from`, it is the
   *   one entry whose RESTful address ends in that type and id.
   * - A reference to a contained resource (`#id`) is found in `from`'s `contained`.
   * - A version (`.../_history/2`) is matched to the resource's `meta.versionId`.
   * - A reference by identifier alone, or one FHIR gives no meaning, is undefined.
   *
   * Throws a {@link Haau3Error} when the Bundle holds two entries the reference could name, when the
   * resource found is not of `type`, and when `from` is needed but missing or not in the Bundle.
   */
  resolve<K extends ResourceType = ResourceType>(
    bundle: Bundle,
    reference: Reference | string | null | undefined,
    options: ResolveOptions<K> = {},
  ): ResourceOf<K> | undefined {
    return resolveIn(bundle, reference, options);
  }

  /**
   * Several operations of the FHIR base in one request, each with its own answer or error, in the
   * order given. The function you pass gets a builder with every operation a batch can carry, called
   * as on this client; what it returns is sent.
   *
   * ```ts
   * const [plan, counties] = await haau3.batch((b) => [
   *   b.readInsurancePlan("H2406-013-000"),
   *   b.listInsurancePlanCounties({ state: "NC" }),
   * ]);
   * if (plan.ok) plan.data; // fhir4.InsurancePlan
   * else plan.error; // RefusedError or NoAnswerError, as the call alone would have thrown
   * ```
   *
   * Each entry is checked as the call alone is, and fails alone: its result is `{ ok: false, error }`
   * and the others still answer. An entry that fails is not retried. The batch itself is retried,
   * and throws, as any call does: an {@link AuthError} (a {@link ForbiddenError} for a 403), a {@link NoAnswerError} when no answer came
   * back, a {@link RefusedError} when the API refused the whole batch. The API takes up to 100
   * entries in up to 1 MiB, and gives a batch 60 seconds; a larger batch is refused, so send several.
   * The operations the spec marks `x-haau3-batchable: false` cannot go in a batch; api.md names them.
   */
  batch<const E extends readonly BatchEntry<unknown>[]>(
    build: (b: BatchBuilder) => E,
    options: RequestOptions = {},
  ): APIPromise<BatchResults<E>> {
    let entries: E;
    let bundle: Bundle;
    try {
      entries = build(builder);
      bundle = batchBundle(entries);
    } catch (error) {
      return new APIPromise<BatchResults<E>>(Promise.reject(error));
    }
    return new APIPromise(this.#sendBatch(entries, bundle, options));
  }

  async #sendBatch<E extends readonly BatchEntry<unknown>[]>(
    entries: E,
    bundle: Bundle,
    options: RequestOptions,
  ): Promise<WithResponse<BatchResults<E>>> {
    const { data, ...meta } = await this.respond<Bundle>("POST", this.url("/v1/fhir/r4"), bundle, options, "/v1/fhir/r4", ["Bundle"]);
    return { ...meta, data: readBatch(entries, data, meta) as BatchResults<E> };
  }
}
