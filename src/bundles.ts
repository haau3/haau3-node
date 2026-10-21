import type { Bundle, BundleEntry, FhirResource, Reference, Resource } from "fhir/r4.js";
import { Haau3Error } from "./errors.js";

/** Every R4 resource type, as `resourceType` names it. */
export type ResourceType = FhirResource["resourceType"];

/** The R4 resource a `resourceType` names: `ResourceOf<"Organization">` is `fhir4.Organization`. */
export type ResourceOf<K extends ResourceType> = Extract<FhirResource, { resourceType: K }>;

/** What {@link Haau3.resolve} takes beside the Bundle and the reference. */
export interface ResolveOptions<K extends ResourceType = ResourceType> {
  /**
   * The type the reference must name. The resource found is typed as it, and one of another type
   * is an error rather than a wrong answer.
   */
  type?: K;
  /**
   * The resource that holds the reference. A reference to a resource it contains (`#id`) is found
   * among its `contained`, and a relative reference (`Organization/123`) is resolved against the
   * address of the entry it is in, as FHIR says. Without it, a relative reference is matched to
   * the one entry whose address ends in that type and id.
   */
  from?: Resource;
}

// FHIR's RESTful address: a base, a resource type, an id, and a version after _history.
const RESTFUL = /^(https?:\/\/.+)\/([A-Z][A-Za-z]+)\/([A-Za-z0-9\-.]{1,64})(?:\/_history\/([A-Za-z0-9\-.]{1,64}))?$/;
const RELATIVE = /^([A-Z][A-Za-z]+)\/([A-Za-z0-9\-.]{1,64})(?:\/_history\/([A-Za-z0-9\-.]{1,64}))?$/;
const ABSOLUTE = /^[A-Za-z][A-Za-z0-9+.-]*:/;

interface Address {
  base: string;
  type: string;
  id: string;
  version: string | undefined;
}

function restful(url: string | undefined): Address | undefined {
  const match = url === undefined ? null : RESTFUL.exec(url);
  return match ? { base: match[1]!, type: match[2]!, id: match[3]!, version: match[4] } : undefined;
}

/** Each entry that holds a resource; a deleted entry in a history holds none, and names nothing. */
function held(bundle: Bundle): (BundleEntry & { resource: Resource })[] {
  return (bundle.entry ?? []).filter((entry): entry is BundleEntry & { resource: Resource } => entry.resource !== undefined);
}

/** The one of `found`, or undefined for none; two is a Bundle that does not say which it means. */
function one(found: Resource[]): Resource | undefined {
  if (found.length > 1) {
    throw new Haau3Error(`The reference matches ${found.length} entries of the Bundle, so which one it names is ambiguous.`);
  }
  return found[0];
}

/** An absolute reference: the entry with that fullUrl, and with that version when it names one. */
function atAddress(bundle: Bundle, reference: string): Resource | undefined {
  const address = restful(reference);
  const url = address?.version === undefined ? reference : `${address.base}/${address.type}/${address.id}`;
  return one(
    held(bundle)
      .filter((entry) => entry.fullUrl === url)
      .filter((entry) => address?.version === undefined || entry.resource.meta?.versionId === address.version)
      .map((entry) => entry.resource),
  );
}

/**
 * The resource a reference names, found in a Bundle as FHIR R4 resolves one (Bundle, "Resolving
 * references in Bundles"); see {@link Haau3.resolve}.
 */
export function resolveIn<K extends ResourceType = ResourceType>(
  bundle: Bundle,
  reference: Reference | string | null | undefined,
  options: ResolveOptions<K> = {},
): ResourceOf<K> | undefined {
  const { type, from } = options;
  const target = typeof reference === "string" ? reference : reference?.reference;
  // A reference by identifier alone names no entry; FHIR leaves finding one to the reader.
  if (!target) return undefined;

  let found: Resource | undefined;
  if (target.startsWith("#")) {
    if (from === undefined) {
      throw new Haau3Error("A reference to a contained resource is found in the resource that holds it: pass { from }.");
    }
    // `#` alone is the resource itself; `#id` is one it contains.
    const contained = (from as { contained?: Resource[] }).contained;
    found = target === "#" ? from : contained?.find((resource) => resource.id === target.slice(1));
  } else if (ABSOLUTE.test(target)) {
    found = atAddress(bundle, target);
  } else {
    const relative = RELATIVE.exec(target);
    // Anything else has no meaning FHIR defines.
    if (!relative) return undefined;
    const [, rtype, id, version] = relative;
    if (from !== undefined) {
      const holder = held(bundle).find((entry) => entry.resource === from);
      if (!holder) throw new Haau3Error("The resource passed as from is not an entry of this Bundle.");
      // FHIR resolves a relative reference only against an entry at a RESTful address.
      const base = restful(holder.fullUrl)?.base;
      if (base === undefined) return undefined;
      found = atAddress(bundle, `${base}/${target}`);
    } else {
      found = one(
        held(bundle)
          .filter((entry) => {
            const address = restful(entry.fullUrl);
            return address !== undefined && address.version === undefined && address.type === rtype && address.id === id;
          })
          .filter((entry) => version === undefined || entry.resource.meta?.versionId === version)
          .map((entry) => entry.resource),
      );
    }
  }

  if (found !== undefined && type !== undefined && found.resourceType !== type) {
    throw new Haau3Error(`The reference names a resource of type ${found.resourceType}, not ${type}.`);
  }
  return found as ResourceOf<K> | undefined;
}

/** Whether an entry is one a search matched: its search mode is `match`, or it says none. */
export function isMatch(entry: BundleEntry): entry is BundleEntry & { resource: Resource } {
  const mode = entry.search?.mode;
  return entry.resource !== undefined && (mode === undefined || mode === "match");
}

/** One page's matches, of a type when one is given; see {@link Haau3.matches}. */
export function matchesIn<K extends ResourceType = ResourceType>(page: Bundle, type?: K): ResourceOf<K>[] {
  return (page.entry ?? [])
    .filter(isMatch)
    .map((entry) => entry.resource)
    .filter((resource) => type === undefined || resource.resourceType === type) as ResourceOf<K>[];
}
