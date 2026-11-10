import { randomUUID } from "node:crypto";
import {
  PILOT_MUNICIPALITY,
  emptyAddress,
  runPrecheck,
  type Application,
  type ApplicationStatus,
  type ApplicationWithPrecheck,
  type Appointment,
  type CaseSummary,
  type CaseworkerAction,
  type DemoPersona,
  type IdentityMethod,
  type Lang,
} from "@digieurope/shared";
import type { Store } from "./store.js";

export class WorkflowError extends Error {
  constructor(
    message: string,
    readonly statusCode = 409,
  ) {
    super(message);
  }
}

export function newApplication(
  store: Store,
  opts: { identityMethod: IdentityMethod; language: Lang; persona?: DemoPersona; now?: Date },
): Application {
  const now = opts.now ?? new Date();
  const at = now.toISOString();
  const p = opts.persona;
  return {
    id: randomUUID(),
    reference: store.nextReference("MS", now.getUTCFullYear()),
    municipalityId: PILOT_MUNICIPALITY.id,
    status: "draft",
    language: opts.language,
    identityMethod: opts.identityMethod,
    verifiedFields: p ? ["firstName", "lastName", "birthName", "birthDate", "birthPlace", "nationality"] : [],
    person: p
      ? { ...p.person }
      : {
          firstName: "", lastName: "", birthName: "", birthDate: "", birthPlace: "", nationality: "",
          sex: "unspecified", maritalStatus: "unknown", religion: "none",
        },
    identityDocument: p ? { ...p.identityDocument } : { type: "passport", number: "", issuingCountry: "", expiryDate: "" },
    residenceTitle: { type: "", expiryDate: "" },
    move: {
      newAddress: { ...emptyAddress(), city: PILOT_MUNICIPALITY.name },
      moveInDate: "",
      residenceType: "main",
      previousResidence: "abroad",
      previousAddress: emptyAddress(),
      previousCountry: "",
    },
    landlord: { status: "missing", landlordName: "", landlordEmail: "" },
    documents: [],
    messages: [],
    history: [{ status: "draft", at }],
    createdAt: at,
    updatedAt: at,
  };
}

export function withPrecheck(app: Application, now = new Date()): ApplicationWithPrecheck {
  return { ...app, precheck: runPrecheck(app, PILOT_MUNICIPALITY, now) };
}

function transition(app: Application, status: ApplicationStatus, at: string, note?: string): Application {
  return { ...app, status, updatedAt: at, history: [...app.history, { status, at, ...(note ? { note } : {}) }] };
}

function message(from: "citizen" | "caseworker" | "system", text: string, at: string) {
  return { id: randomUUID(), from, text, at };
}

export function submit(app: Application, note: string | undefined, now = new Date()): Application {
  if (app.status !== "draft" && app.status !== "info_requested") {
    throw new WorkflowError("Application has already been submitted.");
  }
  const precheck = runPrecheck(app, PILOT_MUNICIPALITY, now);
  if (!precheck.ready) throw new WorkflowError("Pre-check has open blockers.", 422);
  const at = now.toISOString();
  let next = transition(app, "submitted", at, app.status === "info_requested" ? "resubmitted" : undefined);
  next.submittedAt ??= at;
  if (note?.trim()) next = { ...next, messages: [...next.messages, message("citizen", note.trim(), at)] };
  return next;
}

/** Next free 10-minute express slot on the next working day, 08:00–12:00 Berlin time (approx. 07:00 UTC). */
export function nextExpressSlot(all: Application[], now = new Date()): Appointment {
  const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  for (;;) {
    day.setUTCDate(day.getUTCDate() + 1);
    const wd = day.getUTCDay();
    if (wd === 0 || wd === 6) continue;
    const taken = new Set(all.filter((a) => a.appointment).map((a) => a.appointment!.start));
    for (let slot = 0; slot < 24; slot++) {
      const start = new Date(day.getTime() + 7 * 3600_000 + slot * 10 * 60_000).toISOString();
      if (!taken.has(start)) return { start, minutes: 10, location: `${PILOT_MUNICIPALITY.office}, Express counter` };
    }
  }
}

const OPEN: ApplicationStatus[] = ["submitted", "in_review", "id_check"];

export function caseworkerAction(
  app: Application,
  action: CaseworkerAction,
  text: string | undefined,
  all: Application[],
  now = new Date(),
): Application {
  const at = now.toISOString();
  const require = (ok: boolean, msg: string) => {
    if (!ok) throw new WorkflowError(msg);
  };
  const withMsg = (a: Application) => (text?.trim() ? { ...a, messages: [...a.messages, message("caseworker", text.trim(), at)] } : a);

  switch (action) {
    case "approve":
      require(app.identityMethod === "eid" && (app.status === "submitted" || app.status === "in_review"),
        "Only eID-verified applications under review can be approved directly.");
      return withMsg({ ...transition(app, "approved", at), decidedAt: at });
    case "invite_id_check": {
      require(app.identityMethod === "passport" && (app.status === "submitted" || app.status === "in_review"),
        "Express ID check is only for passport applications under review.");
      const appointment = nextExpressSlot(all, now);
      return withMsg({ ...transition(app, "id_check", at), appointment });
    }
    case "confirm_identity":
      require(app.status === "id_check", "No express ID check is scheduled.");
      return withMsg({ ...transition(app, "approved", at), decidedAt: at });
    case "request_info":
      require(OPEN.includes(app.status), "Application is not open.");
      require(!!text?.trim(), "Tell the applicant what is missing.");
      return withMsg({ ...transition(app, "info_requested", at), appointment: undefined });
    case "reject":
      require(OPEN.includes(app.status), "Application is not open.");
      require(!!text?.trim(), "A rejection needs a reason.");
      return withMsg({ ...transition(app, "rejected", at), decidedAt: at, appointment: undefined });
    default:
      throw new WorkflowError("Unknown action.", 400);
  }
}

export function summarize(app: Application, now = new Date()): CaseSummary {
  return {
    id: app.id,
    reference: app.reference,
    name: `${app.person.lastName}, ${app.person.firstName}`,
    nationality: app.person.nationality,
    status: app.status,
    identityMethod: app.identityMethod,
    language: app.language,
    submittedAt: app.submittedAt,
    updatedAt: app.updatedAt,
    warnings: runPrecheck(app, PILOT_MUNICIPALITY, new Date(app.submittedAt ?? now)).warnings,
    appointment: app.appointment,
  };
}

/** Simplified hand-over record for the city's case software. A real XMeld mapping comes later. */
export function exportForCaseSoftware(app: Application) {
  const { person, identityDocument, residenceTitle, move, landlord } = app;
  return {
    format: "digieurope.anmeldung.v0",
    note: "Prototype export. Field names follow the BMG registration form; XMeld/FIT-Connect mapping is not implemented yet.",
    reference: app.reference,
    municipality: PILOT_MUNICIPALITY.name,
    status: app.status,
    submittedAt: app.submittedAt,
    decidedAt: app.decidedAt,
    identityVerification: app.identityMethod === "eid" ? "eID (online ID function)" : "Passport, checked in person",
    person,
    identityDocument,
    residenceTitle: residenceTitle.type ? residenceTitle : null,
    newResidence: { ...move.newAddress, moveInDate: move.moveInDate, type: move.residenceType },
    previousResidence:
      move.previousResidence === "germany" ? { inGermany: true, ...move.previousAddress }
      : move.previousResidence === "abroad" ? { inGermany: false, country: move.previousCountry }
      : null,
    landlordConfirmation: {
      method: landlord.status === "confirmed" ? "digital" : "document",
      landlordName: landlord.landlordName,
      landlordAddress: landlord.landlordAddress,
      confirmedAt: landlord.confirmedAt,
    },
    documents: app.documents.map(({ id, kind, filename }) => ({ id, kind, filename })),
  };
}
