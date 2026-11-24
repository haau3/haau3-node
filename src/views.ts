import type {
  Bundle,
  Extension,
  FhirResource,
  HealthcareService,
  Location,
  Practitioner,
  PractitionerRole,
  Reference,
  Resource,
  Schedule,
  Slot,
} from "fhir/r4.js";
import { matchesIn, resolveIn } from "./bundles.js";
import { Haau3Error } from "./errors.js";
import type { QueryOf } from "./operations.js";

/** Where SMART Scheduling Links 1.0.0 publishes its extensions. The views read these URLs only. */
const SMART_SCHEDULING_LINKS = "http://hl7.org/fhir/uv/smart-scheduling-links/StructureDefinition/";
const BOOKING_DEEP_LINK = `${SMART_SCHEDULING_LINKS}booking-deep-link`;
const BOOKING_PHONE = `${SMART_SCHEDULING_LINKS}booking-phone`;
const PATIENT_TYPE = `${SMART_SCHEDULING_LINKS}patient-type`;

/** HL7's code system for whom a provider accepts, and its four codes. */
const ACCEPTING_PATIENTS = "http://terminology.hl7.org/CodeSystem/accepting-patients";
const PATIENT_TYPES = ["newpt", "existptonly", "existptfam", "nopt"] as const;

/** HL7's code system for a Location's physical type, in which `vi` is a virtual location. */
const LOCATION_PHYSICAL_TYPE = "http://terminology.hl7.org/CodeSystem/location-physical-type";

/**
 * Whom a Slot accepts, as HL7's `accepting-patients` code system names it: `newpt` new and existing
 * patients, `existptonly` existing patients only, `existptfam` existing patients and their
 * families, `nopt` none. The API never serves a `nopt` Slot.
 */
export type PatientType = (typeof PATIENT_TYPES)[number];

/**
 * The includes {@link Haau3.searchSlotWithIncludes} sends: every one the Slot search serves, so each
 * Slot's Schedule, the Locations and provider the Schedule names, the Practitioner behind a role and
 * the Location behind a HealthcareService come in the same Bundle.
 */
export const SLOT_INCLUDES = {
  _include: "Slot:schedule",
  "_include:iterate": ["Schedule:actor", "PractitionerRole:practitioner", "HealthcareService:location"],
} as const;

/** The includes {@link Haau3.searchScheduleWithIncludes} sends: every one the Schedule search serves. */
export const SCHEDULE_INCLUDES = {
  _include: "Schedule:actor",
  "_include:iterate": ["PractitionerRole:practitioner", "HealthcareService:location"],
} as const;

/** A search's parameters less its includes, which the helper sends itself, so the types refuse one. */
type WithoutIncludes<Params> = Omit<Params, "_include" | "_include:iterate"> & { _include?: never; "_include:iterate"?: never };

/**
 * What {@link Haau3.searchSlotWithIncludes} takes: the Slot search's parameters, less its includes.
 * A `SearchSlotParams` that may hold an include is refused by the types: build this one instead.
 */
export type SearchSlotWithIncludesParams = WithoutIncludes<QueryOf<"searchSlot">>;

/** What {@link Haau3.searchScheduleWithIncludes} takes: the Schedule search's parameters, less its includes. */
export type SearchScheduleWithIncludesParams = WithoutIncludes<QueryOf<"searchSchedule">>;

/**
 * One Schedule of a search page with the resources the page holds for it, side by side, each as the
 * FHIR resource it is: the Locations it reaches and its provider, however its publisher named it.
 * Each list keeps the order the Schedule names them in, holds each resource once, and is empty when
 * the page holds none.
 */
export interface ScheduleView {
  schedule: Schedule;
  /**
   * Every Location the Schedule reaches: its Location actors, then the Locations of each
   * HealthcareService it names. A PractitionerRole's own locations are not followed.
   */
  locations: Location[];
  /** The PractitionerRoles the Schedule names. */
  practitionerRoles: PractitionerRole[];
  /** The Practitioners the Schedule names, then the Practitioner behind each of its PractitionerRoles. */
  practitioners: Practitioner[];
  /** The HealthcareServices the Schedule names. */
  healthcareServices: HealthcareService[];
  /**
   * Whether the place is virtual: true when any of `locations` has the physical type `vi`
   * (`http://terminology.hl7.org/CodeSystem/location-physical-type`); false when one states a
   * physical type and none is `vi`, since a physical type that is not virtual is physical; and
   * undefined when none states one.
   */
  virtual: boolean | undefined;
}

/**
 * One matched Slot of a search page with its Schedule and everything the {@link ScheduleView} holds,
 * side by side as FHIR resources, and three values read from the Slot's SMART Scheduling Links 1.0.0
 * extensions.
 */
export interface SlotView extends ScheduleView {
  slot: Slot;
  /** The Slot's booking link: its `booking-deep-link` extension's URL. */
  bookingLink: string | undefined;
  /** The phone number to book the Slot by: its `booking-phone` extension's value. */
  bookingPhone: string | undefined;
  /**
   * Whom the Slot accepts, from its `patient-type` extension, as a code of HL7's
   * `http://terminology.hl7.org/CodeSystem/accepting-patients`. Undefined when the Slot carries none,
   * or one from another code system.
   */
  patientType: PatientType | undefined;
}

/** The Bundle entry a resource is held in: itself, or for a contained resource the one containing it. */
type Holders = Map<Resource, Resource>;

/**
 * The resource a reference names, of one of `types`, found from `from` by FHIR's rules for a Bundle,
 * with no request. A contained resource resolves from the entry that contains it, as FHIR says. A
 * resource of another type than the element allows is left out, as one the page does not hold is.
 */
function follow<K extends FhirResource["resourceType"]>(
  page: Bundle,
  holders: Holders,
  reference: Reference | undefined,
  from: Resource,
  types: readonly K[],
): Extract<FhirResource, { resourceType: K }> | undefined {
  const holder = holders.get(from) ?? from;
  const found = resolveIn(page, reference, { from: holder });
  if (found === undefined || !(types as readonly string[]).includes(found.resourceType)) return undefined;
  if (!holders.has(found)) holders.set(found, reference?.reference?.startsWith("#") ? holder : found);
  return found as Extract<FhirResource, { resourceType: K }>;
}

function once<T>(list: T[], item: T): void {
  if (!list.includes(item)) list.push(item);
}

const ACTOR_TYPES = ["Location", "PractitionerRole", "Practitioner", "HealthcareService"] as const;

/** What a Schedule names and reaches in one page, found by FHIR's reference rules, with no request. */
function reached(page: Bundle, holders: Holders, schedule: Schedule): ScheduleView {
  const view: ScheduleView = { schedule, locations: [], practitionerRoles: [], practitioners: [], healthcareServices: [], virtual: undefined };
  for (const actor of schedule.actor ?? []) {
    const found = follow(page, holders, actor, schedule, ACTOR_TYPES);
    if (found?.resourceType === "Location") once(view.locations, found);
    else if (found?.resourceType === "PractitionerRole") once(view.practitionerRoles, found);
    else if (found?.resourceType === "Practitioner") once(view.practitioners, found);
    else if (found?.resourceType === "HealthcareService") once(view.healthcareServices, found);
  }
  for (const role of view.practitionerRoles) {
    const practitioner = follow(page, holders, role.practitioner, role, ["Practitioner"]);
    if (practitioner) once(view.practitioners, practitioner);
  }
  for (const service of view.healthcareServices) {
    for (const reference of service.location ?? []) {
      const location = follow(page, holders, reference, service, ["Location"]);
      if (location) once(view.locations, location);
    }
  }
  view.virtual = virtualOf(view.locations);
  return view;
}

function virtualOf(locations: Location[]): boolean | undefined {
  let stated = false;
  for (const location of locations) {
    const codings = (location.physicalType?.coding ?? []).filter((coding) => coding.code !== undefined);
    if (codings.length === 0) continue;
    stated = true;
    if (codings.some((coding) => coding.system === LOCATION_PHYSICAL_TYPE && coding.code === "vi")) return true;
  }
  return stated ? false : undefined;
}

/** The value of the first extension under `url` that carries the value it is read for. */
function extensionValue<T>(slot: Slot, url: string, read: (extension: Extension) => T | undefined): T | undefined {
  for (const extension of slot.extension ?? []) {
    if (extension.url !== url) continue;
    const value = read(extension);
    if (value !== undefined) return value;
  }
  return undefined;
}

const isPatientType = (code: string | undefined): code is PatientType => (PATIENT_TYPES as readonly (string | undefined)[]).includes(code);

/**
 * Each Schedule a search page matched, with its Locations and provider; see
 * {@link Haau3.scheduleViews}.
 */
export function scheduleViews(page: Bundle): ScheduleView[] {
  const holders: Holders = new Map();
  return matchesIn(page, "Schedule").map((schedule) => reached(page, holders, schedule));
}

/** Each Slot a search page matched, with its Schedule, Locations and provider; see {@link Haau3.slotViews}. */
export function slotViews(page: Bundle): SlotView[] {
  const holders: Holders = new Map();
  return matchesIn(page, "Slot").map((slot) => {
    const schedule = follow(page, holders, slot.schedule, slot, ["Schedule"]);
    if (!schedule) {
      throw new Haau3Error(
        "A Slot in this page names a Schedule the page does not hold. Every Slot names one, and a search with its includes " +
          "holds it: search with searchSlotWithIncludes, or send _include=Slot:schedule.",
      );
    }
    return {
      slot,
      ...reached(page, holders, schedule),
      bookingLink: extensionValue(slot, BOOKING_DEEP_LINK, (e) => e.valueUrl),
      bookingPhone: extensionValue(slot, BOOKING_PHONE, (e) => e.valueContactPoint?.value),
      patientType: extensionValue(slot, PATIENT_TYPE, (e) =>
        e.valueCoding?.system === ACCEPTING_PATIENTS && isPatientType(e.valueCoding.code) ? e.valueCoding.code : undefined,
      ),
    };
  });
}

/**
 * Refuses an include passed to a helper anyway, from code the types do not check, rather than
 * replacing it, since the call would then answer something other than what its caller wrote.
 */
export function refuseIncludes(helper: string, plain: string, params: object | undefined): void {
  const given = (params ?? {}) as Record<string, unknown>;
  for (const name of ["_include", "_include:iterate"]) {
    if (given[name] !== undefined) {
      throw new Haau3Error(`${helper} sends every include its search serves, so it takes no ${name}: to send your own, call ${plain}.`);
    }
  }
}
