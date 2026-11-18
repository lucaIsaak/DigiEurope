import { RULES, defaultConfig, defaultInputs, type ProcessInput, type ConfigValue, type FlowEdge, type FlowNode, type NodeKind, type OfficeSettings, type ProcessDef } from "@digieurope/shared";

export interface OfficeMetrics {
  medianDaysToDecision: number | null;
  /** Percent of applications without blocking findings at the first check. */
  firstTimeComplete: number | null;
  /** Percent of applications where a person had to check doubtful fields. */
  reviewShare: number | null;
  /** Average number of rounds of "documents missing". */
  documentRounds: number | null;
  casesPerMonth: number | null;
}

export interface OfficeProcess {
  def: ProcessDef;
  settings: OfficeSettings;
  metrics: OfficeMetrics;
}

export interface PeerOffice {
  id: string;
  name: string;
  city: string;
  /** Processes by catalogue id. */
  processes: Record<string, OfficeProcess>;
}

export const ALL_RULE_IDS = RULES.map((r) => r.id);

/** What the oversight body regards as the target settings. */
export const REFERENCE_SETTINGS: OfficeSettings = {
  approvedRules: ALL_RULE_IDS,
  extractionDefault: "ai",
  extractionByType: {},
  slaDays: 5,
  languages: ["de", "en"],
};

const n = (id: string, kind: NodeKind, config: Record<string, ConfigValue> = {}): FlowNode => ({ id, kind, position: { x: 0, y: 0 }, config: defaultConfig(kind, config) });
const e = (source: string, sourceHandle: string, target: string): FlowEdge => ({ id: `${source}:${sourceHandle}`, source, sourceHandle, target });
const doc = (ref: string, when?: ProcessInput["when"], required = true): ProcessInput => ({ id: `doc:${ref}`, type: "document", ref, required, ...(when ? { when } : {}) });
const known = (ref: string): ProcessInput => ({ id: `info:${ref}`, type: "info", ref, required: true });
const study = { kind: "stay_type", value: "study" } as const;
const intern = { kind: "stay_type", value: "internship" } as const;
const notify = (to: string, subject: string, body: string) => ({ to, subject, body });

function def(id: string, name: string, by: string, nodes: FlowNode[], edges: FlowEdge[], inputs: ProcessInput[]): ProcessDef {
  // Positions are laid out by the viewer; stored positions only matter for editing.
  return { id, catalogId: "bafoeg.abroad", name, version: 3, updatedAt: "2026-08-14T09:00:00.000Z", updatedBy: by, inputs, nodes, edges };
}

/** Deliberately simple: no document reading, no systems, one generic mail for incomplete applications. */
function nordhafen(): ProcessDef {
  return def("nordhafen-abroad", "BAföG abroad application (Nordhafen)", "Hr. Brandt", [
    n("start", "trigger"), n("rules", "run_rules", { rules: ALL_RULE_IDS.join(",") }),
    n("notice", "send_notification", notify("student", "Ihr Antrag ist unvollständig", "Guten Tag {name}, Ihrem Antrag fehlen Unterlagen. Bitte reichen Sie diese nach.")),
    n("end-i", "end"), n("human", "human_task"),
    n("ok", "send_notification", notify("student", "Bewilligung", "Ihr Antrag wurde bewilligt.")), n("end-ok", "end"),
    n("no", "send_notification", notify("student", "Ablehnung", "Ihr Antrag wurde abgelehnt.")), n("end-no", "end"), n("end-info", "end"),
  ], [
    e("start", "out", "rules"), e("rules", "incomplete", "notice"), e("notice", "out", "end-i"), e("rules", "complete", "human"),
    e("human", "approved", "ok"), e("ok", "out", "end-ok"), e("human", "rejected", "no"), e("no", "out", "end-no"), e("human", "info", "end-info"),
  ], [doc("application_form"), doc("enrollment_cert"), doc("host_confirmation", study), doc("internship_contract", intern), doc("parent_form"), doc("parent_tax"), known("country"), known("startDate"), known("endDate")]);
}

/** Reads documents, but without a review step; high amounts go through a second check; two systems connected. */
function bergland(): ProcessDef {
  return def("bergland-abroad", "BAföG abroad: application process (Bergland)", "Fr. Aigner", [
    n("start", "trigger"), n("read", "read_documents", { method: "builtin" }), n("rules", "run_rules", { rules: ALL_RULE_IDS.join(",") }),
    n("ask", "request_documents"), n("end-i", "end"),
    n("team", "assign_team", { team: "Team Ausland" }), n("cond", "condition", { field: "estimateMonthly", op: "gte", value: "800" }),
    n("team2", "assign_team", { team: "Zweitprüfung" }), n("human", "human_task"),
    n("case", "connector", { system: "case_software", action: "create_case" }), n("pay", "connector", { system: "payment", action: "create_payment_order" }),
    n("ok", "send_notification", notify("student", "Bewilligung", "Ihr Antrag {reference} wurde bewilligt: {amount}.")), n("end-ok", "end"),
    n("no", "send_notification", notify("student", "Ablehnung", "Ihr Antrag {reference} wurde abgelehnt.")), n("end-no", "end"), n("end-info", "end"),
  ], [
    e("start", "out", "read"), e("read", "out", "rules"),
    e("rules", "incomplete", "ask"), e("ask", "out", "end-i"), e("rules", "complete", "team"), e("team", "out", "cond"),
    e("cond", "yes", "team2"), e("cond", "no", "human"), e("team2", "out", "human"),
    e("human", "approved", "case"), e("case", "out", "pay"), e("pay", "out", "ok"), e("ok", "out", "end-ok"),
    e("human", "rejected", "no"), e("no", "out", "end-no"), e("human", "info", "end-info"),
  ], [doc("application_form"), doc("fb06"), doc("enrollment_cert"), doc("host_confirmation", study), doc("internship_contract", intern), doc("internship_uni_confirmation", intern), doc("health_insurance"), doc("tuition_waiver_proof", { kind: "tuition" }), doc("parent_form"), doc("parent_tax"), known("country"), known("startDate"), known("endDate"), known("tuitionFees")]);
}

/** The most complete one: AI reading, review of doubtful fields, AI mail with a reminder, four systems connected. */
function rheinau(): ProcessDef {
  return def("rheinau-abroad", "BAföG abroad application (Rheinau)", "Fr. Çelik", [
    n("start", "trigger"), n("assign", "assign_caseworker"), n("read", "read_documents"), n("read-ok", "condition", { field: "custom", left: "{read.read_result}", op: "eq", value: "valid" }), n("review", "review_fields"), n("askq", "request_documents", { sending: "caseworker" }), n("waitq", "wait", { days: 7 }), n("remind", "send_notification", { to: "student" }), n("end-r", "end"), n("inputs", "check_inputs"), n("rules", "run_rules", { rules: ALL_RULE_IDS.join(","), withInputs: "no" }),
    n("draft", "ai_draft_mail"), n("ask", "request_documents"), n("wait", "wait", { days: 7 }), n("end-i", "end"),
    n("human", "human_task"),
    n("case", "connector", { system: "case_software", action: "create_case" }), n("pay", "connector", { system: "payment", action: "create_payment_order" }),
    n("portal", "connector", { system: "portal", action: "send_status" }), n("archive", "connector", { system: "efile", action: "archive_case" }),
    n("ok", "send_notification", notify("student", "Bewilligung", "Ihr Antrag {reference} wurde bewilligt: {amount}.")), n("end-ok", "end"),
    n("no", "send_notification", notify("student", "Ablehnung", "Ihr Antrag {reference} wurde abgelehnt.")), n("end-no", "end"), n("end-info", "end"),
  ], [
    e("start", "out", "assign"), e("assign", "out", "read"), e("read", "out", "read-ok"), e("read-ok", "yes", "inputs"), e("read-ok", "no", "review"), e("review", "confirmed", "inputs"), e("review", "info", "askq"), e("askq", "out", "waitq"), e("waitq", "out", "remind"), e("remind", "out", "end-r"), e("inputs", "complete", "rules"), e("inputs", "incomplete", "draft"),
    e("rules", "incomplete", "draft"), e("draft", "out", "ask"), e("ask", "out", "wait"), e("wait", "out", "end-i"),
    e("rules", "complete", "human"),
    e("human", "approved", "case"), e("case", "out", "pay"), e("pay", "out", "ok"), e("ok", "out", "portal"), e("portal", "out", "archive"), e("archive", "out", "end-ok"),
    e("human", "rejected", "no"), e("no", "out", "end-no"), e("human", "info", "end-info"),
  ], [
    ...defaultInputs(), known("parentEmail"),
    { id: "info:flat_booked", type: "info", ref: "flat_booked", required: false, question: { label: { de: "Haben Sie schon eine Unterkunft gebucht?", en: "Have you already booked accommodation?" }, type: "yesno" } },
  ]);
}

export const PEER_OFFICES: PeerOffice[] = [
  {
    id: "nordhafen", name: "Studierendenwerk Nordhafen", city: "Nordhafen",
    processes: {
      "bafoeg.abroad": {
        def: nordhafen(),
        settings: { approvedRules: ALL_RULE_IDS.filter((r) => !["R-HOST-PERIOD", "R-EARLY", "R-HEALTH-ABROAD", "R-TUITION-CAP"].includes(r)), extractionDefault: "builtin", extractionByType: {}, slaDays: 10, languages: ["de"] },
        metrics: { medianDaysToDecision: 18, firstTimeComplete: 31, reviewShare: 0, documentRounds: 1.9, casesPerMonth: 210 },
      },
    },
  },
  {
    id: "bergland", name: "Studierendenwerk Bergland", city: "Bergland",
    processes: {
      "bafoeg.abroad": {
        def: bergland(),
        settings: { approvedRules: ALL_RULE_IDS.filter((r) => r !== "R-HEALTH-ABROAD"), extractionDefault: "builtin", extractionByType: { parent_tax: { method: "ai", minConfidence: 0.9 } }, slaDays: 7, languages: ["de", "en"] },
        metrics: { medianDaysToDecision: 9, firstTimeComplete: 44, reviewShare: 0, documentRounds: 1.4, casesPerMonth: 95 },
      },
    },
  },
  {
    id: "rheinau", name: "Studierendenwerk Rheinau", city: "Rheinau",
    processes: {
      "bafoeg.abroad": {
        def: rheinau(),
        settings: { approvedRules: ALL_RULE_IDS, extractionDefault: "ai", extractionByType: {}, slaDays: 5, languages: ["de", "en"] },
        metrics: { medianDaysToDecision: 6, firstTimeComplete: 63, reviewShare: 18, documentRounds: 1.1, casesPerMonth: 160 },
      },
    },
  },
];
