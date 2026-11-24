import type { Bundle, Extension, HealthcareService, Location, Practitioner, PractitionerRole, Schedule, Slot } from "fhir/r4.js";
import { matchesIn, resolveIn } from "./bundles.js";
import { Haau3Error } from "./errors.js";
import type { QueryOf } from "./operations.js";

/** Where SMART Scheduling Links 1.0.0 publishes its extensions. The views read these URLs only. */
const SMART_SCHEDULING_LINKS = "http://hl7.org/fhir/uv/smart-scheduling-links/StructureDefinition/";
const BOOKING_DEEP_LINK = `${SMART_SCHEDULING_LINKS}booking-deep-link`;
const BOOKING_PHONE = `${SMART_SCHEDULING_LINKS}booking-phone`;
const PATIENT_TYPE = `${SMART_SCHEDULING_LINKS}patient-type`;

/** HL7's code system for whom a provider accepts: `newpt`, `existptonly`, `existptfam`, `nopt`. */
const ACCEPTING_PATIENTS = "http://terminology.hl7.org/CodeSystem/accepting-patients";

/** HL7's code system for a Location's physical type, in which `vi` is a virtual location. */
const LOCATION_PHYSICAL_TYPE = "http://terminology.hl7.org/CodeSystem/location-physical-type";

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

type WithoutIncludes<Params> = Omit<Params, "_include" | "_include:iterate">;

/** What {@link Haau3.searchSlotWithIncludes} takes: the Slot search's parameters, less its includes. */
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
   * (`http://terminology.hl7.org/CodeSystem/location-physical-type`), false when one states a
   * physical type and none is `vi`, and undefined when none states one. Never guessed.
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
   * Whom the Slot accepts, from its `patient-type` extension, as a code of
   * `http://terminology.hl7.org/CodeSystem/accepting-patients`: `newpt` for new and existing
   * patients, `existptonly` for existing ones, `existptfam` for existing ones and their families.
   * Undefined when the Slot carries none, or one from another code system.
   */
  patientType: string | undefined;
}

function once<T>(list: T[], item: T): void {
  if (!list.includes(item)) list.push(item);
}

/** What a Schedule names and reaches in one page, found by FHIR's reference rules, with no request. */
function reached(page: Bundle, schedule: Schedule): ScheduleView {
  const view: ScheduleView = { schedule, locations: [], practitionerRoles: [], practitioners: [], healthcareServices: [], virtual: undefined };
  for (const actor of schedule.actor ?? []) {
    const found = resolveIn(page, actor, { from: schedule });
    if (found?.resourceType === "Location") once(view.locations, found);
    else if (found?.resourceType === "PractitionerRole") once(view.practitionerRoles, found);
    else if (found?.resourceType === "Practitioner") once(view.practitioners, found);
    else if (found?.resourceType === "HealthcareService") once(view.healthcareServices, found);
  }
  for (const role of view.practitionerRoles) {
    const practitioner = resolveIn(page, role.practitioner, { from: role, type: "Practitioner" });
    if (practitioner) once(view.practitioners, practitioner);
  }
  for (const service of view.healthcareServices) {
    for (const reference of service.location ?? []) {
      const location = resolveIn(page, reference, { from: service, type: "Location" });
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

function extension(slot: Slot, url: string): Extension | undefined {
  return slot.extension?.find((one) => one.url === url);
}

/**
 * Each Schedule a search page matched, with its Locations and provider; see
 * {@link Haau3.scheduleViews}.
 */
export function scheduleViews(page: Bundle): ScheduleView[] {
  return matchesIn(page, "Schedule").map((schedule) => reached(page, schedule));
}

/** Each Slot a search page matched, with its Schedule, Locations and provider; see {@link Haau3.slotViews}. */
export function slotViews(page: Bundle): SlotView[] {
  return matchesIn(page, "Slot").map((slot) => {
    const schedule = resolveIn(page, slot.schedule, { from: slot, type: "Schedule" });
    if (!schedule) {
      throw new Haau3Error(
        "A Slot in this page names a Schedule the page does not hold, so the page was searched without its includes: " +
          "search with searchSlotWithIncludes, or send _include=Slot:schedule.",
      );
    }
    const coding = extension(slot, PATIENT_TYPE)?.valueCoding;
    return {
      slot,
      ...reached(page, schedule),
      bookingLink: extension(slot, BOOKING_DEEP_LINK)?.valueUrl,
      bookingPhone: extension(slot, BOOKING_PHONE)?.valueContactPoint?.value,
      patientType: coding?.system === ACCEPTING_PATIENTS ? coding.code : undefined,
    };
  });
}

/**
 * The parameters a helper sends: the caller's, then the includes. An include passed anyway, by code
 * the types do not reach, is refused rather than replaced, since the call would then answer
 * something other than what its caller wrote.
 */
export function withIncludes<Params extends object, Includes extends object>(
  helper: string,
  plain: string,
  params: Params | undefined,
  includes: Includes,
): Params & Includes {
  const given = (params ?? {}) as Record<string, unknown>;
  for (const name of ["_include", "_include:iterate"]) {
    if (given[name] !== undefined) {
      throw new Haau3Error(`${helper} sends every include its search serves, so it takes no ${name}: to send your own, call ${plain}.`);
    }
  }
  return { ...(params as Params), ...includes };
}
