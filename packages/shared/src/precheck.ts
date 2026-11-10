import { needsResidenceTitle } from "./countries.js";
import { ageOn, daysBetween, parseDate, todayUtc } from "./dates.js";
import type {
  Address,
  Application,
  Municipality,
  PrecheckItem,
  PrecheckResult,
} from "./types.js";

/** Legal deadline for registering after moving in (§ 17 BMG). */
export const REGISTRATION_DEADLINE_DAYS = 14;

function missingAddressFields(a: Address): string[] {
  const missing: string[] = [];
  if (!a.street.trim()) missing.push("street");
  if (!a.houseNumber.trim()) missing.push("houseNumber");
  if (!/^\d{5}$/.test(a.postalCode.trim())) missing.push("postalCode");
  if (!a.city.trim()) missing.push("city");
  return missing;
}

/**
 * Checks an Anmeldung for everything a caseworker would otherwise catch at the counter.
 * Blockers prevent submission; warnings are shown to applicant and caseworker but do not block.
 */
export function runPrecheck(
  app: Pick<
    Application,
    "identityMethod" | "person" | "identityDocument" | "residenceTitle" | "move" | "landlord" | "documents"
  >,
  municipality: Municipality,
  now: Date = new Date(),
): PrecheckResult {
  const items: PrecheckItem[] = [];
  const today = todayUtc(now);
  const hasDoc = (kind: string) => app.documents.some((d) => d.kind === kind);
  const { person, identityDocument: idDoc, residenceTitle, move, landlord } = app;

  // --- Person -------------------------------------------------------------
  const missingPerson = (["firstName", "lastName", "birthDate", "birthPlace", "nationality"] as const).filter(
    (f) => !person[f].trim(),
  );
  if (missingPerson.length) {
    items.push({ code: "person_incomplete", severity: "blocker", step: "person", params: { fields: missingPerson.join(",") } });
  } else {
    items.push({ code: "person_complete", severity: "ok", step: "person" });
  }

  const birth = parseDate(person.birthDate);
  if (person.birthDate && !birth) {
    items.push({ code: "birth_date_invalid", severity: "blocker", step: "person" });
  } else if (birth && ageOn(birth, today) < 16) {
    items.push({ code: "minor_needs_guardian", severity: "blocker", step: "person" });
  }

  // --- Identity document ----------------------------------------------------
  if (!idDoc.type || !idDoc.number.trim() || !idDoc.expiryDate) {
    items.push({ code: "id_doc_incomplete", severity: "blocker", step: "person" });
  } else {
    const expiry = parseDate(idDoc.expiryDate);
    if (!expiry) items.push({ code: "id_doc_expiry_invalid", severity: "blocker", step: "person" });
    else if (expiry < today) items.push({ code: "id_doc_expired", severity: "blocker", step: "person" });
    else items.push({ code: "id_doc_valid", severity: "ok", step: "person" });
  }

  if (app.identityMethod === "eid") {
    items.push({ code: "identity_verified_eid", severity: "ok", step: "documents" });
  } else if (!hasDoc("identity")) {
    items.push({ code: "identity_upload_missing", severity: "blocker", step: "documents" });
  } else {
    items.push({ code: "identity_upload_ok", severity: "ok", step: "documents" });
  }

  // --- Residence title (non-EU/EEA/CH nationals) -----------------------------
  if (needsResidenceTitle(person.nationality)) {
    if (!residenceTitle.type || residenceTitle.type === "none") {
      items.push({ code: "residence_title_missing", severity: "blocker", step: "documents" });
    } else {
      const expiry = parseDate(residenceTitle.expiryDate);
      if (!expiry) items.push({ code: "residence_title_expiry_missing", severity: "blocker", step: "documents" });
      else if (expiry < today) items.push({ code: "residence_title_expired", severity: "warning", step: "documents" });
      if (!hasDoc("residence_title")) {
        items.push({ code: "residence_title_upload_missing", severity: "blocker", step: "documents" });
      } else if (expiry && expiry >= today) {
        items.push({ code: "residence_title_ok", severity: "ok", step: "documents" });
      }
    }
  }

  // --- New address ----------------------------------------------------------
  const missingNew = missingAddressFields(move.newAddress);
  if (missingNew.length) {
    items.push({ code: "address_incomplete", severity: "blocker", step: "move", params: { fields: missingNew.join(",") } });
  } else if (!municipality.postalCodes.includes(move.newAddress.postalCode.trim())) {
    items.push({ code: "address_outside_municipality", severity: "blocker", step: "move", params: { municipality: municipality.name } });
  } else {
    items.push({ code: "address_ok", severity: "ok", step: "move" });
  }

  // --- Move-in date ---------------------------------------------------------
  const moveIn = parseDate(move.moveInDate);
  if (!moveIn) {
    items.push({ code: "move_in_missing", severity: "blocker", step: "move" });
  } else {
    const days = daysBetween(moveIn, today);
    if (days < 0) items.push({ code: "move_in_future", severity: "blocker", step: "move" });
    else if (days > REGISTRATION_DEADLINE_DAYS) items.push({ code: "move_in_late", severity: "warning", step: "move", params: { days } });
    else items.push({ code: "move_in_ok", severity: "ok", step: "move", params: { daysLeft: REGISTRATION_DEADLINE_DAYS - days } });
  }

  // --- Previous residence -----------------------------------------------------
  if (move.previousResidence === "germany" && missingAddressFields(move.previousAddress).length) {
    items.push({ code: "previous_address_incomplete", severity: "blocker", step: "move" });
  } else if (move.previousResidence === "abroad" && !move.previousCountry) {
    items.push({ code: "previous_country_missing", severity: "blocker", step: "move" });
  }

  if (move.residenceType === "secondary") {
    items.push({ code: "secondary_residence_tax", severity: "warning", step: "move" });
  }

  // --- Landlord confirmation (Wohnungsgeberbestätigung, § 19 BMG) -------------
  if (landlord.status === "confirmed") {
    items.push({ code: "landlord_confirmed_digital", severity: "ok", step: "landlord" });
  } else if (hasDoc("landlord_confirmation")) {
    items.push({ code: "landlord_uploaded", severity: "ok", step: "landlord" });
  } else if (landlord.status === "requested") {
    items.push({ code: "landlord_pending", severity: "blocker", step: "landlord" });
  } else {
    items.push({ code: "landlord_missing", severity: "blocker", step: "landlord" });
  }

  const blockers = items.filter((i) => i.severity === "blocker").length;
  const warnings = items.filter((i) => i.severity === "warning").length;
  return { ready: blockers === 0, blockers, warnings, items };
}
