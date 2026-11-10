import { describe, expect, it } from "vitest";
import { applyPatch } from "./application.js";
import { PILOT_MUNICIPALITY } from "./municipality.js";
import { runPrecheck } from "./precheck.js";
import type { Application } from "./types.js";

const NOW = new Date("2026-11-10T10:00:00Z");

function baseApp(overrides: Partial<Application> = {}): Application {
  return {
    id: "a1",
    reference: "MS-2026-00001",
    municipalityId: "musterstadt",
    status: "draft",
    language: "en",
    identityMethod: "eid",
    verifiedFields: ["firstName", "lastName", "birthDate", "birthPlace", "nationality"],
    person: {
      firstName: "Lena", lastName: "Hoffmann", birthName: "", birthDate: "1990-04-02", birthPlace: "Hamburg",
      nationality: "DE", sex: "female", maritalStatus: "single", religion: "none",
    },
    identityDocument: { type: "id_card", number: "L01X00T47", issuingCountry: "DE", expiryDate: "2030-01-01" },
    residenceTitle: { type: "", expiryDate: "" },
    move: {
      newAddress: { street: "Lindenallee", houseNumber: "5", addressExtra: "", postalCode: "12345", city: "Musterstadt" },
      moveInDate: "2026-11-03",
      residenceType: "main",
      previousResidence: "germany",
      previousAddress: { street: "Elbstraße", houseNumber: "1", addressExtra: "", postalCode: "20095", city: "Hamburg" },
      previousCountry: "",
    },
    landlord: { status: "confirmed", landlordName: "Wohnbau GmbH", landlordEmail: "x@example.org" },
    documents: [],
    messages: [],
    history: [],
    createdAt: NOW.toISOString(),
    updatedAt: NOW.toISOString(),
    ...overrides,
  };
}

const codes = (app: Application) => runPrecheck(app, PILOT_MUNICIPALITY, NOW).items.map((i) => i.code);

describe("runPrecheck", () => {
  it("passes a complete eID application", () => {
    const r = runPrecheck(baseApp(), PILOT_MUNICIPALITY, NOW);
    expect(r.ready).toBe(true);
    expect(r.blockers).toBe(0);
  });

  it("blocks a missing landlord confirmation and a pending request", () => {
    expect(codes(baseApp({ landlord: { status: "missing", landlordName: "", landlordEmail: "" } }))).toContain("landlord_missing");
    expect(codes(baseApp({ landlord: { status: "requested", landlordName: "", landlordEmail: "a@b.de" } }))).toContain("landlord_pending");
  });

  it("accepts an uploaded landlord confirmation", () => {
    const app = baseApp({
      landlord: { status: "uploaded", landlordName: "", landlordEmail: "" },
      documents: [{ id: "d", kind: "landlord_confirmation", filename: "wgb.pdf", mimeType: "application/pdf", size: 1, uploadedAt: "" }],
    });
    expect(runPrecheck(app, PILOT_MUNICIPALITY, NOW).ready).toBe(true);
  });

  it("blocks addresses outside the municipality", () => {
    const app = baseApp();
    app.move.newAddress.postalCode = "10115";
    expect(codes(app)).toContain("address_outside_municipality");
  });

  it("blocks a future move-in date and warns after the 14-day deadline", () => {
    expect(codes(baseApp({ move: { ...baseApp().move, moveInDate: "2026-11-20" } }))).toContain("move_in_future");
    const late = runPrecheck(baseApp({ move: { ...baseApp().move, moveInDate: "2026-10-01" } }), PILOT_MUNICIPALITY, NOW);
    expect(late.ready).toBe(true);
    expect(late.items.find((i) => i.code === "move_in_late")?.params?.days).toBe(40);
  });

  it("requires residence title and uploads for non-EU passport applicants", () => {
    const app = baseApp({
      identityMethod: "passport",
      person: { ...baseApp().person, nationality: "IN" },
      identityDocument: { type: "passport", number: "Z1234567", issuingCountry: "IN", expiryDate: "2031-01-01" },
    });
    expect(codes(app)).toEqual(expect.arrayContaining(["identity_upload_missing", "residence_title_missing"]));

    app.residenceTitle = { type: "blue_card", expiryDate: "2028-01-01" };
    app.documents = [
      { id: "1", kind: "identity", filename: "p.pdf", mimeType: "application/pdf", size: 1, uploadedAt: "" },
      { id: "2", kind: "residence_title", filename: "v.pdf", mimeType: "application/pdf", size: 1, uploadedAt: "" },
    ];
    expect(runPrecheck(app, PILOT_MUNICIPALITY, NOW).ready).toBe(true);
  });

  it("blocks expired identity documents and minors", () => {
    expect(codes(baseApp({ identityDocument: { type: "id_card", number: "X", issuingCountry: "DE", expiryDate: "2020-01-01" } }))).toContain("id_doc_expired");
    expect(codes(baseApp({ person: { ...baseApp().person, birthDate: "2015-01-01" } }))).toContain("minor_needs_guardian");
  });
});

describe("applyPatch", () => {
  it("does not overwrite eID-verified fields or the eID document", () => {
    const app = baseApp();
    const next = applyPatch(app, {
      person: { firstName: "Mallory", religion: "protestant" },
      identityDocument: { number: "FAKE" },
      move: { newAddress: { street: "Neue Straße" }, moveInDate: "2026-11-05" },
    });
    expect(next.person.firstName).toBe("Lena");
    expect(next.person.religion).toBe("protestant");
    expect(next.identityDocument.number).toBe("L01X00T47");
    expect(next.move.newAddress.street).toBe("Neue Straße");
    expect(next.move.newAddress.postalCode).toBe("12345");
    expect(next.move.moveInDate).toBe("2026-11-05");
  });
});
