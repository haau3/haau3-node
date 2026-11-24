import type { Bundle, Dosage, FhirResource, Parameters, ParametersParameter, Reference } from "fhir/r4.js";
import { APIPromise, type WithResponse } from "./api-promise.js";
import { batchBundle, readBatch, type BatchEntry, type BatchResults } from "./batch.js";
import { matchesIn, nextCursor as nextCursorOf, resolveIn, type ResolveOptions, type ResourceOf, type ResourceType } from "./bundles.js";
import { NoAnswerError } from "./errors.js";
import { parameter as partNamed, parameters as partsNamed, reviewFlags as reviewOf, type DosageReview } from "./parameters.js";
import {
  designations as designationsOf,
  lookupResult as lookupOf,
  validationResult as validationOf,
  type Designation,
  type DesignationFilter,
  type LookupResult,
  type ValidationResult,
} from "./terminology.js";
import { BatchBuilder } from "./generated/batch.js";
import { Operations } from "./generated/methods.js";
import type { QueryOf, ResponseOf } from "./operations.js";
import type { ClientOptions, RequestOptions } from "./transport.js";
import {
  SCHEDULE_INCLUDES,
  scheduleViews as scheduleViewsOf,
  SLOT_INCLUDES,
  slotViews as slotViewsOf,
  refuseIncludes,
  type ScheduleView,
  type SearchScheduleWithIncludesParams,
  type SearchSlotWithIncludesParams,
  type SlotView,
} from "./views.js";

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
   * The cursor for the page after this one, with no request: the `page` value of the page's `next`
   * link, or undefined on the last page. It is for a search continued in a later request, such as a
   * web page's "Load more", where {@link pages} cannot hold the page between requests.
   *
   * ```ts
   * // The search, its moment chosen once and kept: the cursor belongs to it.
   * const search = { status: "free", start: [`ge${new Date().toISOString()}`] };
   * const first = await haau3.searchSlotWithIncludes(search);
   * const cursor = haau3.nextCursor(first); // undefined on the last page
   * // Later, in another request, with the same search:
   * if (cursor) await haau3.searchSlotWithIncludes({ ...search, page: cursor });
   * ```
   *
   * A cursor belongs to its search: send it as `page` with every other parameter exactly as before.
   * A Slot, Schedule or plan search refuses a cursor sent with its search changed (a 400), and that
   * includes a parameter the API filled in for you, as the page's `self` link shows: send a Slot
   * search's `status` and `start` yourself when you will page this way. A cursor does not last: the
   * provider directory's searches say their cursors expire, and a plan search answers 410 once the
   * plans are updated, so start the search again. {@link pages} follows the link itself.
   *
   * Throws a {@link Haau3Error} when the next link is not a URL, or carries no cursor or two. The
   * plain function `nextCursor()` does the same with no client.
   */
  nextCursor(page: Bundle): string | undefined {
    return nextCursorOf(page);
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
   * The Slot search, with every include it serves sent for you, so each Slot's Schedule, the
   * Locations and provider the Schedule names, the Practitioner behind a role and the Location
   * behind a HealthcareService come in the same Bundle: `_include=Slot:schedule`, then
   * `_include:iterate` of `Schedule:actor`, `PractitionerRole:practitioner` and
   * `HealthcareService:location`. Takes every other parameter of {@link searchSlot} and sends
   * nothing else, so the API's own defaults hold: free Slots, from now. {@link slotViews} reads the
   * page; {@link pages} follows its `next` link.
   *
   * ```ts
   * const page = await haau3.searchSlotWithIncludes({ "location-address-state": "MA" });
   * for (const view of haau3.slotViews(page)) {
   *   const name = view.practitioners[0]?.name?.[0];
   *   console.log(view.slot.start, name?.text ?? ([name?.given?.join(" "), name?.family].filter(Boolean).join(" ") || undefined), view.locations[0]?.name, view.bookingLink);
   * }
   * ```
   *
   * The types take no `_include` or `_include:iterate`, and one passed anyway is refused with a
   * {@link Haau3Error}, sending nothing: to send your own, call {@link searchSlot}.
   */
  searchSlotWithIncludes(params?: SearchSlotWithIncludesParams, options?: RequestOptions): APIPromise<ResponseOf<"searchSlot">> {
    try {
      refuseIncludes("searchSlotWithIncludes", "searchSlot", params);
    } catch (error) {
      return new APIPromise<ResponseOf<"searchSlot">>(Promise.reject(error));
    }
    const query: QueryOf<"searchSlot"> = {
      ...params,
      _include: SLOT_INCLUDES._include,
      "_include:iterate": [...SLOT_INCLUDES["_include:iterate"]],
    };
    return this.searchSlot(query, options);
  }

  /**
   * The Schedule search, with every include it serves sent for you, so each Schedule's Locations
   * and provider, the Practitioner behind a role and the Location behind a HealthcareService come in
   * the same Bundle: `_include=Schedule:actor`, then `_include:iterate` of
   * `PractitionerRole:practitioner` and `HealthcareService:location`. Takes every other parameter of
   * {@link searchSchedule} and sends nothing else. {@link scheduleViews} reads the page.
   *
   * ```ts
   * const page = await haau3.searchScheduleWithIncludes({ "location-address-city": "Boston" });
   * for (const view of haau3.scheduleViews(page)) {
   *   const name = view.practitioners[0]?.name?.[0];
   *   console.log(name?.text ?? ([name?.given?.join(" "), name?.family].filter(Boolean).join(" ") || undefined), view.locations[0]?.name);
   * }
   * ```
   *
   * The types take no `_include` or `_include:iterate`, and one passed anyway is refused with a
   * {@link Haau3Error}, sending nothing: to send your own, call {@link searchSchedule}.
   */
  searchScheduleWithIncludes(params?: SearchScheduleWithIncludesParams, options?: RequestOptions): APIPromise<ResponseOf<"searchSchedule">> {
    try {
      refuseIncludes("searchScheduleWithIncludes", "searchSchedule", params);
    } catch (error) {
      return new APIPromise<ResponseOf<"searchSchedule">>(Promise.reject(error));
    }
    const query: QueryOf<"searchSchedule"> = {
      ...params,
      _include: SCHEDULE_INCLUDES._include,
      "_include:iterate": [...SCHEDULE_INCLUDES["_include:iterate"]],
    };
    return this.searchSchedule(query, options);
  }

  /**
   * Each Slot a search page matched, with no request, as a {@link SlotView}: the Slot, its Schedule,
   * the Locations the Schedule reaches, its PractitionerRoles, Practitioners and HealthcareServices,
   * each the FHIR resource the page holds, and the Slot's booking link, booking phone and patient
   * type, read from its SMART Scheduling Links 1.0.0 extensions. Nothing is replaced in place: each
   * resource stays as the API served it. The plain function `slotViews()` does the same with no
   * client.
   *
   * ```ts
   * const page = await haau3.searchSlotWithIncludes({ "location-address-city": "Cambridge" });
   * const [first] = haau3.slotViews(page);
   * if (first) console.log(first.slot.start, first.locations[0]?.name, first.virtual, first.bookingLink ?? first.bookingPhone);
   * ```
   *
   * Every Slot names its Schedule, so a page that does not hold one was searched without its
   * includes, and that throws a {@link Haau3Error} naming the fix. A Location or provider the page
   * does not hold is left out, and nothing is fetched for it. Paging: call it on each page
   * {@link pages} gives.
   */
  slotViews(page: Bundle): SlotView[] {
    return slotViewsOf(page);
  }

  /**
   * Each Schedule a search page matched, with no request, as a {@link ScheduleView}: the Schedule,
   * the Locations it reaches, its PractitionerRoles, Practitioners and HealthcareServices, each the
   * FHIR resource the page holds, and whether the place is virtual. The plain function
   * `scheduleViews()` does the same with no client.
   *
   * ```ts
   * const page = await haau3.searchScheduleWithIncludes({ "provider-identifier": "http://hl7.org/fhir/sid/us-npi|2900000227" });
   * for (const view of haau3.scheduleViews(page)) console.log(view.locations.map((location) => location.name));
   * ```
   */
  scheduleViews(page: Bundle): ScheduleView[] {
    return scheduleViewsOf(page);
  }

  /**
   * Every part of a Parameters answer with that name, in order, with no request: the way FHIR
   * operations answer, `$lookup`'s `property` parts or `$structure-dosage`'s `dosage` part. Each part
   * holds its value in the `value[x]` its operation names, so read `valueDosage`, `valueString` and so
   * on from it. Empty when there is none. The plain function `parameters()` does the same with no
   * client.
   *
   * ```ts
   * const answer = await haau3.codeSystemLookup({ system: "http://loinc.org", code: "2345-7", property: ["COMPONENT"] });
   * for (const property of haau3.parameters(answer, "property")) console.log(property.part);
   * ```
   */
  parameters(answer: Parameters, name: string): ParametersParameter[] {
    return partsNamed(answer, name);
  }

  /**
   * The one part of a Parameters answer with that name, with no request, or undefined when there is
   * none. Throws a {@link Haau3Error} when there are two, since which one is meant is then ambiguous;
   * {@link parameters} reads a name that repeats. The plain function `parameter()` does the same with
   * no client.
   *
   * ```ts
   * const answer = await haau3.codeSystemLookup({ system: "http://loinc.org", code: "2345-7" });
   * console.log(haau3.parameter(answer, "display")?.valueString);
   * ```
   */
  parameter(answer: Parameters, name: string): ParametersParameter | undefined {
    return partNamed(answer, name);
  }

  /**
   * The review flags on a Dosage that `$structure-dosage` answered with, and the versions it names,
   * with no request. Each flag is something a person should check: its code, its display, and the
   * words of the directions it is about, when it is about words. The versions say how the directions
   * were read and coded, and which RxNorm release the medication was looked up in. The plain function
   * `reviewFlags()` does the same with no client, so a stored answer can be read where no key is.
   *
   * ```ts
   * const answer = await haau3.structureDosage(structureDosageRequest({ text: "Take 1 tablet by mouth twice daily" }));
   * const dosage = haau3.parameter(answer, "dosage")?.valueDosage;
   * if (dosage) for (const flag of haau3.reviewFlags(dosage).flags) console.log(flag.code, flag.words);
   * ```
   */
  reviewFlags(dosage: Dosage): DosageReview {
    return reviewOf(dosage);
  }

  /**
   * A `CodeSystem/$lookup` answer, typed, with no request: the code, its system and version, its
   * display, whether it is abstract, every designation and every property. A part this reader does
   * not know stays in `other`. Throws a {@link Haau3Error} when a part FHIR allows once comes twice.
   * The plain function `lookupResult()` does the same with no client.
   *
   * ```ts
   * const lookup = haau3.lookupResult(await haau3.codeSystemLookup({ system: "http://hl7.org/fhir/sid/icd-10-cm", code: "E08.37X1" }));
   * console.log(lookup.display, lookup.abstract);
   * ```
   */
  lookupResult(answer: Parameters): LookupResult {
    return lookupOf(answer);
  }

  /**
   * A `$validate-code` answer, from a code system or a value set, typed, with no request: whether
   * the code is valid, its display, and the server's message. Throws a {@link Haau3Error} when a
   * part FHIR allows once comes twice. The plain function `validationResult()` does the same with no
   * client.
   *
   * ```ts
   * const answer = await haau3.codeSystemValidateCode({ url: "http://loinc.org", code: "8867-4", display: "Pulse" });
   * const { result, display } = haau3.validationResult(answer);
   * ```
   */
  validationResult(answer: Parameters): ValidationResult {
    return validationOf(answer);
  }

  /**
   * The designations of a lookup with a use and in a language, in answer order, with no request. A
   * use matches by its system and code together; a language as RFC 4647's basic filtering says, so
   * `en` finds `en-US`. A field left out matches every designation. The plain function
   * `designations()` does the same with no client.
   *
   * ```ts
   * const lookup = haau3.lookupResult(await haau3.codeSystemLookup({ system: "http://hl7.org/fhir/sid/icd-10-cm", code: "E08.37X1" }));
   * const shortTitle = haau3.designations(lookup, { use: SYNONYM_USE })[0]?.value;
   * ```
   */
  designations(lookup: LookupResult, filter: DesignationFilter = {}): Designation[] {
    return designationsOf(lookup, filter);
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
   * and throws, as any call does: an {@link AuthError} for a 401, a {@link ForbiddenError} for a 403, a {@link NoAnswerError} when no answer came
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
