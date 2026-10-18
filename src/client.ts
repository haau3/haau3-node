import type { Bundle } from "fhir/r4.js";
import { Operations } from "./generated/methods.js";
import type { ClientOptions, RequestOptions } from "./transport.js";

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
    while (page) {
      yield page;
      const next = page.link?.find((link) => link.relation === "next")?.url;
      if (!next) return;
      const url = this.url(next);
      page = await this.answer<Bundle>("GET", url, undefined, options, url.pathname);
    }
  }
}
