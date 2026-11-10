import { parseDate } from "./dates.js";
import type { Address, Application, ApplicationPatch, ApplicationStatus } from "./types.js";

export const emptyAddress = (): Address => ({ street: "", houseNumber: "", addressExtra: "", postalCode: "", city: "" });

/** Statuses in which the applicant may still edit their data. */
export const EDITABLE_STATUSES: ApplicationStatus[] = ["draft", "info_requested"];

export function isEditable(status: ApplicationStatus): boolean {
  return EDITABLE_STATUSES.includes(status);
}

/** Applies an applicant's patch. Fields verified via eID are never overwritten. */
export function applyPatch(app: Application, patch: ApplicationPatch): Application {
  const person = { ...app.person };
  if (patch.person) {
    for (const [key, value] of Object.entries(patch.person)) {
      const k = key as keyof typeof person;
      if (k in person && typeof value === "string" && !app.verifiedFields.includes(k)) {
        (person as Record<string, string>)[k] = value;
      }
    }
  }
  const pick = <T extends object>(base: T, p: Partial<T> | undefined): T => {
    if (!p) return base;
    const out = { ...base };
    for (const [k, v] of Object.entries(p)) {
      if (k in base && typeof v === typeof (base as Record<string, unknown>)[k]) (out as Record<string, unknown>)[k] = v;
    }
    return out;
  };
  const identityLocked = app.identityMethod === "eid";
  const move = patch.move
    ? {
        ...pick(app.move, { ...patch.move, newAddress: undefined, previousAddress: undefined } as Partial<Application["move"]>),
        newAddress: pick(app.move.newAddress, patch.move.newAddress),
        previousAddress: pick(app.move.previousAddress, patch.move.previousAddress),
      }
    : app.move;
  return {
    ...app,
    language: patch.language === "de" || patch.language === "en" ? patch.language : app.language,
    person,
    identityDocument: identityLocked ? app.identityDocument : pick(app.identityDocument, patch.identityDocument),
    residenceTitle: pick(app.residenceTitle, patch.residenceTitle),
    move,
    landlord: patch.landlord
      ? {
          ...app.landlord,
          landlordName: typeof patch.landlord.landlordName === "string" ? patch.landlord.landlordName : app.landlord.landlordName,
          landlordEmail: typeof patch.landlord.landlordEmail === "string" ? patch.landlord.landlordEmail : app.landlord.landlordEmail,
        }
      : app.landlord,
  };
}

/** The landlord confirms a specific address and move-in date, so both must be known first. */
export function landlordCanBeAsked(app: Pick<Application, "move">): boolean {
  const a = app.move.newAddress;
  return !!(a.street.trim() && a.houseNumber.trim() && /^\d{5}$/.test(a.postalCode.trim()) && parseDate(app.move.moveInDate));
}
