import { addDays, estimate, isoDate, type Application, type Lang, type StayInfo, type StudentInfo } from "@digieurope/shared";
import { addDocument, checksFor, newApplication, officeAct } from "./cases.js";
import { sampleDocuments, type Defect, type SamplePerson } from "./samples.js";
import type { Store } from "./store.js";

/** Deterministic PRNG so the demo data looks the same on every fresh start. */
export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ["Anna", "Ben", "Clara", "David", "Elif", "Felix", "Greta", "Hannes", "Ida", "Jakob", "Kira", "Leon", "Maja", "Nils", "Olivia", "Paul", "Rosa", "Simon", "Tessa", "Uwe", "Vera", "Yara", "Zoe", "Amir", "Lucia"];
const LAST = ["Bauer", "Fischer", "Hoffmann", "Krause", "Lang", "Neumann", "Otto", "Peters", "Richter", "Schaefer", "Vogel", "Winter", "Yilmaz", "Zimmer", "Brandt", "Dietrich", "Engel", "Franke", "Gross", "Haas"];
const STUDY_DEST = [
  { country: "CA", city: "Toronto", inst: "Lakeshore University" },
  { country: "US", city: "Boston", inst: "Northfield College" },
  { country: "GB", city: "Manchester", inst: "Pennine University" },
  { country: "AU", city: "Sydney", inst: "Harbourview University" },
  { country: "JP", city: "Osaka", inst: "Kansai Institute of Technology" },
  { country: "ES", city: "Valencia", inst: "Universidad Ficticia de Valencia" },
  { country: "FR", city: "Lyon", inst: "Université Fictive de Lyon" },
  { country: "SE", city: "Uppsala", inst: "Nordmark Universitet" },
];
const INTERN_DEST = [
  { country: "PT", city: "Lissabon", inst: "Atlântico Software Lda." },
  { country: "NL", city: "Rotterdam", inst: "Delta Logistics BV" },
  { country: "IE", city: "Dublin", inst: "Greenfield Labs Ltd" },
  { country: "SG", city: "Singapur", inst: "Merlion Analytics Pte" },
];
const COURSES = ["Political Science (B.A.)", "Computer Science (B.Sc.)", "Economics (B.Sc.)", "Biology (B.Sc.)", "German Studies (B.A.)", "Mechanical Engineering (B.Sc.)", "Psychology (B.Sc.)"];

export function randomPerson(rand: () => number, now: Date): SamplePerson {
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)]!;
  const first = pick(FIRST);
  const last = pick(LAST);
  const intern = rand() < 0.3;
  const dest = pick(intern ? INTERN_DEST : STUDY_DEST);
  const start = isoDate(new Date(now.getTime() + (125 + Math.floor(rand() * 210)) * 86_400_000));
  const weeks = intern ? 12 + Math.floor(rand() * 14) : 27 + Math.floor(rand() * 24);
  const student: StudentInfo = {
    firstName: first, lastName: last, birthDate: `${2000 + Math.floor(rand() * 4)}-0${1 + Math.floor(rand() * 9)}-1${Math.floor(rand() * 9)}`,
    email: `${first}.${last}@example.org`.toLowerCase(), university: "University of Musterstadt", course: pick(COURSES),
  };
  const stay: StayInfo = {
    type: intern ? "internship" : "study", country: dest.country, city: dest.city, institution: dest.inst, startDate: start, endDate: addDays(start, weeks * 7),
    tuitionFees: !intern && ["CA", "US", "AU", "GB", "JP"].includes(dest.country) && rand() < 0.6 ? 2000 + Math.floor(rand() * 35) * 100 : 0,
  };
  const income = 28000 + Math.floor(rand() * 46) * 1000;
  return {
    key: "random", student, stay,
    parents: { name: `${pick(FIRST)} ${last}`, married: rand() < 0.75, siblings: rand() < 0.2 ? 1 : 0, sumOfIncome: income, incomeTax: Math.round(income * (0.1 + rand() * 0.08)) },
    company: intern ? dest.inst : undefined, hostInstitution: intern ? undefined : dest.inst, insurer: "Musterkasse Gesundheit", waiverResult: "abgelehnt",
  };
}

export function randomDefects(rand: () => number, p: SamplePerson): Defect[] {
  const out: Defect[] = [];
  const chance: [Defect, number, boolean][] = [
    ["parent_unsigned", 0.38, true], ["host_missing", 0.26, p.stay.type === "study"], ["contract_unsigned", 0.3, p.stay.type === "internship"],
    ["wrong_income_year", 0.17, true], ["tax_missing", 0.09, true], ["form_unsigned", 0.1, true], ["insurance_missing", 0.09, true],
    ["enroll_missing", 0.06, true], ["host_period_short", 0.07, p.stay.type === "study"],
  ];
  for (const [d, c, applies] of chance) if (applies && rand() < c) out.push(d);
  return out;
}

/** Creates one case with documents (through the real reader), runs the first check and optionally decides it. */
export function buildCase(
  store: Store,
  p: SamplePerson,
  opts: { defects: Defect[]; source: "web" | "portal"; language: Lang; createdAt: Date; status: Application["status"]; rand: () => number },
): Application {
  const t = opts.createdAt;
  let app = newApplication(store, { student: p.student, stay: p.stay, language: opts.language, source: opts.source }, t);
  const upload = (docs: ReturnType<typeof sampleDocuments>, at: Date) => {
    for (const d of docs) app = addDocument(store, app, { filename: d.filename, mimeType: "application/pdf", content: d.content }, d.kind.startsWith("parent") ? "parent" : opts.source === "portal" ? "portal" : "student", at);
  };
  const minutes = (n: number) => new Date(t.getTime() + n * 60_000);
  upload(sampleDocuments(p, opts.defects, "en"), minutes(20));
  const first = checksFor(store, app, minutes(25));
  app = {
    ...app,
    firstFindings: first.findings.filter((f) => f.severity === "blocker").map((f) => f.ruleId),
    parents: { ...app.parents, status: "received", email: `eltern.${p.student.lastName}@example.org`.toLowerCase() },
    history: [...app.history, { at: minutes(25).toISOString(), kind: "checked", text: first.ready ? "ready" : `${first.blockers} to fix` }],
  };
  store.put(app);

  const stillBroken = opts.source === "portal" && ["submitted", "in_review", "info_requested"].includes(opts.status);
  if (!stillBroken && opts.defects.length) {
    // The student fixed everything before submitting.
    upload(sampleDocuments(p, [], "en"), minutes(180));
  }
  if (opts.status === "draft") return store.put({ ...app, status: "draft" });
  const submittedAt = stillBroken ? minutes(30) : minutes(200);
  app = store.put({ ...app, status: "submitted", submittedAt: submittedAt.toISOString(), history: [...app.history, { at: submittedAt.toISOString(), kind: "submitted" }] });
  if (opts.status === "submitted") return app;
  const openedAt = new Date(submittedAt.getTime() + (1 + Math.floor(opts.rand() * 3)) * 86_400_000);
  app = store.put({ ...app, status: "in_review", history: [...app.history, { at: openedAt.toISOString(), kind: "opened" }] });
  if (opts.status === "in_review") return app;
  if (opts.status === "info_requested") {
    return officeAct(store, app, "request_info", { message: "Bitte laden Sie die fehlenden Unterlagen hoch.", by: "Frau Beispiel" }, new Date(openedAt.getTime() + 3600_000));
  }
  const decidedAt = new Date(openedAt.getTime() + (1 + Math.floor(opts.rand() * 8)) * 86_400_000);
  const amount = estimate(app, decidedAt).monthly;
  return officeAct(store, app, opts.status === "approved" ? "approve" : "reject", { message: opts.status === "approved" ? "" : "The income counted from your parents exceeds your monthly need abroad, so no funding can be paid for this period. If your parents' income has dropped significantly, you can submit an update application.", amount, by: "Frau Beispiel" }, decidedAt);
}

export function seedDemoData(store: Store, now: Date = new Date()) {
  const rand = mulberry32(20261116);
  const statusPlan: Application["status"][] = [
    ...Array(15).fill("approved"), ...Array(3).fill("rejected"), ...Array(6).fill("info_requested"), ...Array(6).fill("in_review"), ...Array(9).fill("submitted"), ...Array(3).fill("draft"),
  ];
  // Oldest first so references ascend. Decided cases are older than open ones.
  const order: Record<string, number> = { approved: 0, rejected: 1, info_requested: 2, in_review: 3, submitted: 4, draft: 5 };
  statusPlan.sort((a, b) => order[a]! - order[b]!);
  store.deferred(() => {
    statusPlan.forEach((status, i) => {
      // Open cases are young, so the demo inbox is mostly on time; one case in review is deliberately overdue to show the warning.
      const firstInReview = status === "in_review" && statusPlan.indexOf("in_review") === i;
      const ageDays =
        status === "approved" || status === "rejected" ? 14 + rand() * 40
        : status === "draft" ? rand() * 2
        : status === "submitted" ? rand() * 3
        : status === "in_review" ? (firstInReview ? 8 : 1 + rand() * 3)
        : 2 + rand() * 10; // waiting for the student
      const p = randomPerson(rand, now);
      if (status === "rejected") p.parents = { ...p.parents, sumOfIncome: 135000, incomeTax: 34000 }; // rejected because parental income covers the need
      const source: "web" | "portal" = rand() < 0.55 ? "portal" : "web";
      buildCase(store, p, {
        defects: randomDefects(rand, p), source, language: (rand(), "en" as Lang),
        createdAt: new Date(now.getTime() - ageDays * 86_400_000 - i * 60_000), status, rand,
      });
    });
  });
}

/** One new case arriving from the (simulated) official portal. */
export function deliverFromPortal(store: Store, now: Date = new Date()): Application {
  const rand = mulberry32(Math.floor(now.getTime() / 1000) ^ store.list().length);
  const p = randomPerson(rand, now);
  const defects = randomDefects(rand, p);
  if (defects.length === 0) defects.push(p.stay.type === "internship" ? "contract_unsigned" : "parent_unsigned");
  return buildCase(store, p, { defects, source: "portal", language: "en", createdAt: now, status: "submitted", rand });
}
