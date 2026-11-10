import { randomUUID } from "node:crypto";
import { PILOT_MUNICIPALITY, needsResidenceTitle, type Application, type DocumentKind, type Lang } from "@digieurope/shared";
import { caseworkerAction, newApplication, submit } from "./cases.js";
import { placeholderPdf } from "./pdf.js";
import type { Store } from "./store.js";

/** Deterministic PRNG so the demo data looks the same on every fresh start. */
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Fictional people. [first, last, nationality, birthplace, language]
const PEOPLE: [string, string, string, string, Lang][] = [
  ["Aarav", "Mehta", "IN", "Pune", "en"], ["Ananya", "Iyer", "IN", "Chennai", "en"], ["Camila", "Restrepo", "CO", "Medellín", "en"],
  ["Diego", "Fernández", "AR", "Córdoba", "en"], ["Wei", "Zhang", "CN", "Chengdu", "en"], ["Minh", "Nguyen", "VN", "Hanoi", "en"],
  ["Olena", "Kovalenko", "UA", "Lviv", "en"], ["Emre", "Yılmaz", "TR", "Izmir", "de"], ["Sara", "Haddad", "SY", "Homs", "de"],
  ["Lucas", "Moreau", "FR", "Lyon", "en"], ["Marta", "Nowak", "PL", "Kraków", "de"], ["João", "Silva", "PT", "Porto", "en"],
  ["Elena", "García", "ES", "Valencia", "en"], ["Jonas", "Becker", "DE", "Köln", "de"], ["Miriam", "Schulz", "DE", "Leipzig", "de"],
  ["Tobias", "Wagner", "DE", "Freiburg", "de"], ["Hannah", "Klein", "DE", "Bremen", "de"], ["Kwame", "Mensah", "GH", "Kumasi", "en"],
  ["Fatima", "Benali", "MA", "Fès", "en"], ["Kenji", "Tanaka", "JP", "Osaka", "en"], ["Emily", "Carter", "US", "Denver", "en"],
  ["Rahul", "Verma", "IN", "Jaipur", "en"], ["Ifeoma", "Okafor", "NG", "Enugu", "en"], ["Nikos", "Papadopoulos", "GR", "Patras", "en"],
  ["Laura", "Bianchi", "IT", "Torino", "en"], ["Pedro", "Almeida", "BR", "Recife", "en"], ["Ayşe", "Demir", "TR", "Ankara", "de"],
  ["Felix", "Schmidt", "DE", "Kassel", "de"], ["Sophie", "Lang", "AT", "Graz", "de"], ["Mateus", "Costa", "BR", "Curitiba", "en"],
];
const STREETS = ["Lindenallee", "Bahnhofstraße", "Am Marktplatz", "Gartenweg", "Schillerstraße", "Rosenweg", "Kastanienallee", "Mühlenweg", "Uferstraße", "Kirchgasse"];
const LANDLORDS = ["Musterstädter Wohnbau GmbH", "Familie Weber", "Hausverwaltung Sonnenhof", "K. Brandt", "Genossenschaft Am Park"];
const INFO_REQUESTS = [
  "Please upload a clearer copy of your passport photo page.",
  "The landlord confirmation names a different flat number. Please check and upload a corrected one.",
  "Bitte laden Sie die Seite mit Ihrem Visum hoch.",
];

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString();

function attach(store: Store, app: Application, kind: DocumentKind, title: string, at: number): Application {
  const content = placeholderPdf([`DEMO DOCUMENT - ${title}`, `${app.person.firstName} ${app.person.lastName}`, "Placeholder generated for the prototype.", "Not a real document."]);
  const meta = { id: randomUUID(), kind, filename: `${kind}.pdf`, mimeType: "application/pdf", size: content.length, uploadedAt: iso(at) };
  store.saveDocument(app.id, meta, content);
  return { ...app, documents: [...app.documents, meta] };
}

export function seedDemoData(store: Store, now = new Date()) {
  const rand = mulberry32(20261110);
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
  const total = 46;
  // Submission age in days: most spread over 8 weeks, a recent batch still open. Oldest first so references ascend.
  const ages = Array.from({ length: total - 3 }, (_, i) => (i < 10 ? rand() * 1.5 : 1.5 + rand() * 54)).sort((a, b) => b - a);
  ages.push(0, 0, 0); // drafts

  for (let i = 0; i < total; i++) {
    const [first, last, nat, birthPlace, language] = PEOPLE[i % PEOPLE.length]!;
    // Spread submissions over the last 8 weeks, slightly growing towards today.
    const submittedAt = now.getTime() - ages[i]! * DAY;
    const hasEid = !needsResidenceTitle(nat) && rand() < 0.6;
    const year = 1975 + Math.floor(rand() * 28);

    let app = newApplication(store, { identityMethod: hasEid ? "eid" : "passport", language, now: new Date(submittedAt - 2 * 3600_000) });
    const moveIn = new Date(submittedAt - Math.floor(rand() * (rand() < 0.12 ? 30 : 12)) * DAY);
    app = {
      ...app,
      verifiedFields: hasEid ? ["firstName", "lastName", "birthName", "birthDate", "birthPlace", "nationality"] : [],
      person: {
        firstName: first, lastName: last, birthName: "", birthDate: `${year}-0${1 + Math.floor(rand() * 9)}-1${Math.floor(rand() * 9)}`,
        birthPlace, nationality: nat, sex: "unspecified", maritalStatus: pick(["single", "married", "unknown"] as const), religion: "none",
      },
      identityDocument: {
        type: hasEid ? "id_card" : "passport", number: `X${Math.floor(rand() * 1e8)}`, issuingCountry: nat,
        expiryDate: `${2028 + Math.floor(rand() * 6)}-06-30`,
      },
      residenceTitle: needsResidenceTitle(nat)
        ? { type: pick(["visa", "blue_card", "residence_permit"] as const), expiryDate: `${2027 + Math.floor(rand() * 3)}-03-31` }
        : { type: "", expiryDate: "" },
      move: {
        newAddress: {
          street: pick(STREETS), houseNumber: String(1 + Math.floor(rand() * 80)), addressExtra: rand() < 0.3 ? `${1 + Math.floor(rand() * 4)}. OG` : "",
          postalCode: pick(PILOT_MUNICIPALITY.postalCodes), city: PILOT_MUNICIPALITY.name,
        },
        moveInDate: moveIn.toISOString().slice(0, 10),
        residenceType: rand() < 0.08 ? "secondary" : "main",
        previousResidence: nat === "DE" ? "germany" : "abroad",
        previousAddress: nat === "DE"
          ? { street: "Hauptstraße", houseNumber: String(1 + Math.floor(rand() * 40)), addressExtra: "", postalCode: "50667", city: birthPlace }
          : { street: "", houseNumber: "", addressExtra: "", postalCode: "", city: "" },
        previousCountry: nat === "DE" ? "" : nat,
      },
    };

    const digitalLandlord = rand() < 0.62;
    if (digitalLandlord) {
      app.landlord = {
        status: "confirmed", landlordName: pick(LANDLORDS), landlordEmail: "vermietung@example.org",
        landlordAddress: `Rathausplatz ${3 + (i % 9)}, 12345 Musterstadt`, landlordIsOwner: true,
        requestedAt: iso(submittedAt - DAY), confirmedAt: iso(submittedAt - 3 * 3600_000),
      };
    } else {
      app = attach(store, app, "landlord_confirmation", "Wohnungsgeberbestaetigung", submittedAt - 3600_000);
      app.landlord = { status: "uploaded", landlordName: pick(LANDLORDS), landlordEmail: "" };
    }
    if (!hasEid) app = attach(store, app, "identity", "Passport photo page", submittedAt - 3600_000);
    if (needsResidenceTitle(nat)) app = attach(store, app, "residence_title", "Visa / residence title", submittedAt - 3600_000);

    // The last few stay as drafts so the funnel has a top.
    if (i >= total - 3) {
      store.put({ ...app, move: { ...app.move, moveInDate: "" }, updatedAt: iso(submittedAt) });
      continue;
    }

    app = submit(app, undefined, new Date(submittedAt));
    let clock = submittedAt;
    const advance = (minHours: number, maxHours: number) => {
      clock += (minHours + rand() * (maxHours - minHours)) * 3600_000;
      return clock < now.getTime();
    };
    const when = () => new Date(clock);

    // Some cases needed one round of follow-up information.
    if (rand() < 0.15) {
      if (!advance(4, 26)) { store.put(app); continue; }
      app = caseworkerAction(app, "request_info", pick(INFO_REQUESTS), store.list(), when());
      if (!advance(10, 40)) { store.put(app); continue; }
      app = submit(app, "Done, I uploaded it again.", when());
    }

    // Waiting in the queue, then picked up by a caseworker.
    if (!advance(3, 30)) { store.put(app); continue; }
    app = { ...app, status: "in_review", updatedAt: when().toISOString(), history: [...app.history, { status: "in_review", at: when().toISOString() }] };

    if (!advance(0.2, 6)) { store.put(app); continue; }
    if (rand() < 0.04) {
      app = caseworkerAction(app, "reject", "The address is a commercial unit and cannot be registered as a residence.", store.list(), when());
    } else if (app.identityMethod === "eid") {
      app = caseworkerAction(app, "approve", undefined, store.list(), when());
    } else {
      app = caseworkerAction(app, "invite_id_check", undefined, store.list(), when());
      const slotEnd = Date.parse(app.appointment!.start) + 10 * 60_000;
      if (slotEnd < now.getTime()) {
        clock = slotEnd;
        app = caseworkerAction(app, "confirm_identity", undefined, store.list(), when());
      }
    }
    store.put(app);
  }
}
