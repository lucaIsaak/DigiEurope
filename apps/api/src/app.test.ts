import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { seedDemoData } from "./seed.js";
import { Store } from "./store.js";

const NOW = new Date("2026-11-10T10:00:00Z");
const PDF = Buffer.from("%PDF-1.4\n%demo\n").toString("base64");

function setup() {
  const store = new Store();
  return { store, app: buildApp({ store, now: () => NOW }) };
}

describe("GET /health", () => {
  it("returns ok", async () => {
    const { app } = setup();
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("ok");
  });
});

describe("Anmeldung end to end", () => {
  it("eID applicant: landlord confirms digitally, caseworker approves", async () => {
    const { app } = setup();
    let res = await app.inject({ method: "POST", url: "/applications", payload: { identityMethod: "eid", personaId: "lena", language: "en" } });
    expect(res.statusCode).toBe(201);
    const id = res.json().id as string;
    expect(res.json().person.firstName).toBe("Lena");

    res = await app.inject({
      method: "PATCH", url: `/applications/${id}`,
      payload: {
        person: { firstName: "Changed" },
        move: { newAddress: { street: "Lindenallee", houseNumber: "5", postalCode: "12345" }, moveInDate: "2026-11-05", previousResidence: "abroad", previousCountry: "AT" },
      },
    });
    expect(res.json().person.firstName).toBe("Lena"); // verified by eID, not editable
    expect(res.json().precheck.items.map((i: { code: string }) => i.code)).toContain("landlord_missing");

    res = await app.inject({ method: "POST", url: `/applications/${id}/submit` });
    expect(res.statusCode).toBe(422);

    res = await app.inject({ method: "POST", url: `/applications/${id}/landlord-request`, payload: { landlordName: "Weber", landlordEmail: "weber@example.org" } });
    const link = res.json().landlord.requestLink as string;
    const token = link.split("/landlord/")[1]!;
    expect((await app.inject({ method: "GET", url: `/landlord/${token}` })).json().tenantName).toBe("Lena Hoffmann");
    res = await app.inject({ method: "POST", url: `/landlord/${token}/confirm`, payload: { landlordName: "K. Weber", landlordAddress: "Rathausplatz 2, 12345 Musterstadt", confirm: true } });
    expect(res.statusCode).toBe(200);

    // Changing the address afterwards invalidates the landlord's confirmation.
    res = await app.inject({ method: "PATCH", url: `/applications/${id}`, payload: { move: { newAddress: { houseNumber: "6" } } } });
    expect(res.json().landlord.status).toBe("missing");
    expect((await app.inject({ method: "GET", url: `/landlord/${token}` })).statusCode).toBe(404);
    res = await app.inject({ method: "POST", url: `/applications/${id}/landlord-request`, payload: { landlordName: "Weber", landlordEmail: "weber@example.org" } });
    const token2 = (res.json().landlord.requestLink as string).split("/landlord/")[1]!;
    await app.inject({ method: "POST", url: `/landlord/${token2}/confirm`, payload: { landlordName: "K. Weber", landlordAddress: "Rathausplatz 2", confirm: true } });

    res = await app.inject({ method: "POST", url: `/applications/${id}/submit` });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("submitted");

    expect((await app.inject({ method: "PATCH", url: `/applications/${id}`, payload: {} })).statusCode).toBe(409);

    res = await app.inject({ method: "POST", url: `/caseworker/applications/${id}/open` });
    expect(res.json().status).toBe("in_review");
    res = await app.inject({ method: "POST", url: `/caseworker/applications/${id}/actions`, payload: { action: "approve" } });
    expect(res.json().status).toBe("approved");

    const exported = (await app.inject({ method: "GET", url: `/caseworker/applications/${id}/export` })).json();
    expect(exported.landlordConfirmation.method).toBe("digital");

    const found = await app.inject({ method: "GET", url: `/status/lookup?reference=${res.json().reference.toLowerCase()}&birthDate=1988-03-14` });
    expect(found.json().id).toBe(id);
  });

  it("passport applicant: uploads, info request, resubmission, express ID check", async () => {
    const { app } = setup();
    let res = await app.inject({ method: "POST", url: "/applications", payload: { identityMethod: "passport" } });
    const id = res.json().id as string;
    await app.inject({
      method: "PATCH", url: `/applications/${id}`,
      payload: {
        person: { firstName: "Aarav", lastName: "Mehta", birthDate: "1995-02-01", birthPlace: "Pune", nationality: "IN" },
        identityDocument: { type: "passport", number: "Z123", issuingCountry: "IN", expiryDate: "2030-01-01" },
        residenceTitle: { type: "blue_card", expiryDate: "2029-01-01" },
        move: { newAddress: { street: "Gartenweg", houseNumber: "2", postalCode: "12347" }, moveInDate: "2026-11-01", previousCountry: "IN" },
      },
    });
    for (const kind of ["identity", "residence_title", "landlord_confirmation"]) {
      res = await app.inject({ method: "POST", url: `/applications/${id}/documents`, payload: { kind, filename: `${kind}.pdf`, mimeType: "application/pdf", dataBase64: PDF } });
      expect(res.statusCode).toBe(201);
    }
    expect(res.json().precheck.ready).toBe(true);

    // Files that lie about their type are refused.
    res = await app.inject({ method: "POST", url: `/applications/${id}/documents`, payload: { kind: "other", filename: "x.png", mimeType: "image/png", dataBase64: PDF } });
    expect(res.statusCode).toBe(400);

    await app.inject({ method: "POST", url: `/applications/${id}/submit` });
    res = await app.inject({ method: "POST", url: `/caseworker/applications/${id}/actions`, payload: { action: "approve" } });
    expect(res.statusCode).toBe(409); // passport cases need the ID check first

    res = await app.inject({ method: "POST", url: `/caseworker/applications/${id}/actions`, payload: { action: "request_info", message: "Clearer scan please" } });
    expect(res.json().status).toBe("info_requested");
    res = await app.inject({ method: "POST", url: `/applications/${id}/submit`, payload: { note: "New scan uploaded" } });
    expect(res.json().status).toBe("submitted");

    res = await app.inject({ method: "POST", url: `/caseworker/applications/${id}/actions`, payload: { action: "invite_id_check" } });
    expect(res.json().status).toBe("id_check");
    expect(res.json().appointment.start).toBe("2026-11-11T07:00:00.000Z");
    res = await app.inject({ method: "POST", url: `/caseworker/applications/${id}/actions`, payload: { action: "confirm_identity" } });
    expect(res.json().status).toBe("approved");

    const metrics = (await app.inject({ method: "GET", url: "/metrics" })).json();
    expect(metrics.decided).toBe(1);
    expect(metrics.completeAtFirstSubmission).toBe(0);
  });
});

describe("demo seed", () => {
  it("creates a realistic spread of cases", () => {
    const store = new Store();
    seedDemoData(store, NOW);
    const statuses = new Set(store.list().map((a) => a.status));
    expect(store.list().length).toBe(46);
    for (const s of ["draft", "submitted", "in_review", "approved"]) expect(statuses).toContain(s);
  });
});
