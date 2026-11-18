import { isCatalogVariant } from "./catalog.js";
import { RULES } from "./rules.js";
import type { Bilingual, FieldType } from "./types.js";

export type NodeKind =
  | "trigger"
  | "run_rules"
  | "read_documents"
  | "review_fields"
  | "condition"
  | "human_task"
  | "assign_team"
  | "assign_caseworker"
  | "wait"
  | "ai_draft_mail"
  | "request_documents"
  | "send_notification"
  | "connector"
  | "end";

export type ConfigValue = string | number;

export interface FlowNode {
  id: string;
  kind: NodeKind;
  position: { x: number; y: number };
  config: Record<string, ConfigValue>;
}

export interface FlowEdge {
  id: string;
  source: string;
  sourceHandle: string;
  target: string;
}

/** A process as an office draws it: steps and the connections between them. */
/** When a required input applies. Undefined means always. */
export type InputCondition =
  | { kind: "stay_type"; value: "study" | "internship" }
  | { kind: "tuition" }
  | { kind: "info"; key: string; equals: string };

/** One thing the applicant (or someone for them) has to provide for this process: a form or a piece of information. */
export interface ProcessInput {
  id: string;
  type: "document" | "info";
  /** document: template id. info: a known application field (see KNOWN_INFO) or the id of a custom question. */
  ref: string;
  required: boolean;
  when?: InputCondition;
  /** Custom question: the wording and the answer type. */
  question?: { label: Bilingual; type: FieldType; help?: Bilingual };
}

export interface ProcessDef {
  id: string;
  /** Entry of the central process catalogue this process belongs to, for example "bafoeg.abroad". */
  catalogId: string;
  name: string;
  version: number;
  updatedAt: string;
  updatedBy: string;
  /** What the applicant has to provide. Drives the student's checklist and the readiness check. */
  inputs: ProcessInput[];
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface FieldSpec {
  key: string;
  label: Bilingual;
  type: "text" | "textarea" | "number" | "select";
  options?: { value: string; label: Bilingual }[];
  default: ConfigValue;
}

export type Category = "start" | "check" | "decide" | "message" | "route" | "connector" | "finish";

export interface NodeSpec {
  kind: NodeKind;
  category: Category;
  title: Bilingual;
  description: Bilingual;
  /** Output handles. Steps with several outputs branch. */
  outputs: { id: string; label: Bilingual }[];
  fields: FieldSpec[];
  /** True for steps that use AI (shown with a badge). */
  ai?: boolean;
}

const OUT = [{ id: "out", label: { de: "weiter", en: "next" } }];
const opt = (value: string, de: string, en = de) => ({ value, label: { de, en } });

export const TEAMS = ["Team Ausland", "Team Inland", "Zweitprüfung"];

export const CONDITION_FIELDS = [
  { key: "blockers", label: { de: "Offene blockierende Punkte", en: "Open blocking items" }, numeric: true },
  { key: "warnings", label: { de: "Hinweise", en: "Notes" }, numeric: true },
  { key: "estimateMonthly", label: { de: "Geschätzte Förderung pro Monat (€)", en: "Estimated funding per month (€)" }, numeric: true },
  { key: "tuitionFees", label: { de: "Studiengebühren (€)", en: "Tuition fees (€)" }, numeric: true },
  { key: "weeks", label: { de: "Dauer des Aufenthalts (Wochen)", en: "Length of stay (weeks)" }, numeric: true },
  { key: "stayType", label: { de: "Art (study / internship)", en: "Type (study / internship)" }, numeric: false },
  { key: "country", label: { de: "Zielland (Code, z. B. CA)", en: "Destination (code, e.g. CA)" }, numeric: false },
  { key: "isEU", label: { de: "In EU oder Schweiz (true / false)", en: "In EU or Switzerland (true / false)" }, numeric: false },
  { key: "source", label: { de: "Herkunft (web / portal)", en: "Source (web / portal)" }, numeric: false },
] as const;

/** Connectors to office systems. In the prototype they are mocks with fake responses. Real ones implement the same actions. */
export const CONNECTORS = [
  {
    id: "case_software",
    name: { de: "Fachverfahren (Musterfall)", en: "Case software (Musterfall)" },
    actions: [
      { id: "create_case", label: { de: "Vorgang anlegen", en: "Create case" } },
      { id: "update_status", label: { de: "Status übertragen", en: "Push status" } },
      { id: "attach_documents", label: { de: "Dokumente anhängen", en: "Attach documents" } },
    ],
  },
  {
    id: "efile",
    name: { de: "E-Akte", en: "E-file" },
    actions: [{ id: "archive_case", label: { de: "Vorgang archivieren", en: "Archive case" } }],
  },
  {
    id: "payment",
    name: { de: "Kasse / Zahlung", en: "Payment (Kasse)" },
    actions: [
      { id: "create_payment_order", label: { de: "Zahlungsauftrag anlegen", en: "Create payment order" } },
      { id: "cancel_payment", label: { de: "Zahlung stoppen", en: "Stop payment" } },
    ],
  },
  {
    id: "portal",
    name: { de: "Online-Portal", en: "Online portal" },
    actions: [
      { id: "send_status", label: { de: "Status ans Portal melden", en: "Report status to portal" } },
      { id: "close_request", label: { de: "Antrag im Portal schließen", en: "Close request in portal" } },
    ],
  },
] as const;


/** The rules a "Run approved rules" step applies. null means the step predates the selection and runs all live rules. */
export function ruleSelection(node: Pick<FlowNode, "kind" | "config">): string[] | null {
  if (node.kind !== "run_rules") return [];
  const v = node.config.rules;
  if (v === undefined) return null;
  return String(v).split(",").map((x) => x.trim()).filter(Boolean);
}

/** The rules a whole process applies: the union over its "Run approved rules" steps. null means all live rules. */
export function processRuleIds(def: Pick<ProcessDef, "nodes">): string[] | null {
  const out = new Set<string>();
  for (const n of def.nodes) {
    if (n.kind !== "run_rules") continue;
    const sel = ruleSelection(n);
    if (sel === null) return null;
    sel.forEach((id) => out.add(id));
  }
  return [...out];
}

export const NODE_CATALOG: Record<NodeKind, NodeSpec> = {
  trigger: {
    kind: "trigger", category: "start",
    title: { de: "Antrag geht ein", en: "Application arrives" },
    description: { de: "Startet den Ablauf, sobald ein Antrag eingereicht oder aus dem Portal geliefert wird.", en: "Starts the process when an application is submitted or delivered from the portal." },
    outputs: OUT,
    fields: [{ key: "source", label: { de: "Herkunft", en: "Source" }, type: "select", default: "any", options: [opt("any", "Alle", "All"), opt("portal", "Nur Portal", "Portal only"), opt("web", "Nur direkt", "Direct only")] }],
  },
  run_rules: {
    kind: "run_rules", category: "check",
    title: { de: "Freigegebene Regeln prüfen", en: "Run approved rules" },
    description: { de: "Prüft den Antrag gegen die hier ausgewählten, freigegebenen Regeln. Feste Prüfung, keine KI.", en: "Checks the application against the approved rules ticked here. Fixed check, no AI." },
    outputs: [{ id: "complete", label: { de: "vollständig", en: "complete" } }, { id: "incomplete", label: { de: "unvollständig", en: "incomplete" } }],
    /** Comma-separated rule ids. Empty means no rule runs. A block saved before this existed has no value and runs all live rules. */
    fields: [{ key: "rules", label: { de: "Regeln", en: "Rules" }, type: "text", default: "" }],
  },
  read_documents: {
    kind: "read_documents", category: "check", ai: true,
    title: { de: "Dokumente lesen", en: "Read documents" },
    description: { de: "Liest Dokumente in Felder, mit der Methode, die bei jedem Dokumenttyp unter „Vorlagen“ eingestellt ist. Bei unsicheren Feldern geht es zur Prüfung durch eine Person.", en: "Reads documents into fields with the method set for each document type under Templates. Doubtful fields go to a person for review." },
    outputs: [{ id: "clear", label: { de: "klar", en: "clear" } }, { id: "review", label: { de: "prüfen", en: "review" } }],
    fields: [
      { key: "scope", label: { de: "Welche Dokumente", en: "Which documents" }, type: "select", default: "all", options: [opt("all", "Alle", "All"), opt("student", "Nur der Studierenden", "Student's only"), opt("parents", "Nur der Eltern", "Parents' only")] },
    ],
  },
  review_fields: {
    kind: "review_fields", category: "decide",
    title: { de: "Felder prüfen lassen", en: "Review fields" },
    description: { de: "Eine Person prüft und korrigiert die unsicher gelesenen Felder. Der Ablauf wartet.", en: "A person checks and corrects the fields that were read with low confidence. The process waits." },
    outputs: [{ id: "confirmed", label: { de: "bestätigt", en: "confirmed" } }, { id: "info", label: { de: "Rückfrage", en: "question" } }],
    fields: [{ key: "instruction", label: { de: "Hinweis für die Sachbearbeitung", en: "Note for the caseworker" }, type: "textarea", default: "Unsicher gelesene Felder mit dem Dokument vergleichen." },
      { key: "instruction_en", label: { de: "Hinweis (Englisch)", en: "Note (English)" }, type: "textarea", default: "Compare the fields read with low confidence against the document." },
    ],
  },
  condition: {
    kind: "condition", category: "decide",
    title: { de: "Bedingung", en: "Condition" },
    description: { de: "Verzweigt den Ablauf anhand eines Wertes des Antrags.", en: "Branches the process on a value of the application." },
    outputs: [{ id: "yes", label: { de: "ja", en: "yes" } }, { id: "no", label: { de: "nein", en: "no" } }],
    fields: [
      { key: "field", label: { de: "Wert", en: "Value" }, type: "select", default: "estimateMonthly", options: CONDITION_FIELDS.map((f) => ({ value: f.key, label: f.label })) },
      { key: "op", label: { de: "Vergleich", en: "Comparison" }, type: "select", default: "gte", options: [opt("gte", "ist mindestens", "is at least"), opt("lte", "ist höchstens", "is at most"), opt("eq", "ist gleich", "equals"), opt("ne", "ist nicht gleich", "does not equal")] },
      { key: "value", label: { de: "Vergleichswert", en: "Compare to" }, type: "text", default: "500" },
    ],
  },
  human_task: {
    kind: "human_task", category: "decide",
    title: { de: "Sachbearbeitung entscheidet", en: "Caseworker decides" },
    description: { de: "Der Ablauf wartet auf die Entscheidung einer Person. Die Entscheidung trifft immer ein Mensch.", en: "The process waits for a person's decision. A human always decides." },
    outputs: [{ id: "approved", label: { de: "bewilligt", en: "approved" } }, { id: "rejected", label: { de: "abgelehnt", en: "rejected" } }, { id: "info", label: { de: "Rückfrage", en: "question" } }],
    fields: [
      { key: "instruction", label: { de: "Hinweis für die Sachbearbeitung", en: "Note for the caseworker" }, type: "textarea", default: "" },
      { key: "instruction_en", label: { de: "Hinweis (Englisch)", en: "Note (English)" }, type: "textarea", default: "" },
    ],
  },
  assign_team: {
    kind: "assign_team", category: "route",
    title: { de: "Team zuweisen", en: "Assign team" },
    description: { de: "Weist den Antrag einem Team zu.", en: "Assigns the case to a team." },
    outputs: OUT,
    fields: [{ key: "team", label: { de: "Team", en: "Team" }, type: "select", default: TEAMS[0]!, options: TEAMS.map((t) => opt(t, t)) }],
  },
  assign_caseworker: {
    kind: "assign_caseworker", category: "route",
    title: { de: "Sachbearbeitung zuweisen", en: "Assign caseworker" },
    description: { de: "Weist den Antrag der zuständigen Person zu, nach dem Anfangsbuchstaben des Nachnamens. Die Tabelle steht in den Einstellungen des Amts.", en: "Gives the case to the responsible person by the first letter of the family name. The table is in the office settings." },
    outputs: OUT,
    fields: [],
  },
  wait: {
    kind: "wait", category: "route",
    title: { de: "Frist / Erinnerung", en: "Deadline / reminder" },
    description: { de: "Plant eine Erinnerung nach einigen Tagen. Im Prototyp wird nur vermerkt, nicht gewartet.", en: "Schedules a reminder after some days. The prototype records it instead of waiting." },
    outputs: OUT,
    fields: [{ key: "days", label: { de: "Tage", en: "Days" }, type: "number", default: 7 }],
  },
  ai_draft_mail: {
    kind: "ai_draft_mail", category: "message", ai: true,
    title: { de: "KI entwirft E-Mail", en: "AI drafts e-mail" },
    description: { de: "KI formuliert aus den offenen Punkten eine verständliche Nachricht an die Studierenden. Im Prototyp simuliert.", en: "AI writes a clear message to the student from the open items. Simulated in the prototype." },
    outputs: OUT,
    fields: [{ key: "tone", label: { de: "Ton", en: "Tone" }, type: "select", default: "friendly", options: [opt("friendly", "Freundlich", "Friendly"), opt("formal", "Förmlich", "Formal")] }],
  },
  request_documents: {
    kind: "request_documents", category: "message",
    title: { de: "Unterlagen nachfordern", en: "Request documents" },
    description: { de: "Setzt den Antrag auf „Rückfrage“ und schickt die Nachricht. Automatisch mit dem KI-Entwurf, oder von der Sachbearbeitung geschrieben (der Entwurf ist vorbefüllt).", en: "Sets the case to “question” and sends the message. Either automatically with the AI draft, or written by the caseworker (the draft is prefilled)." },
    outputs: OUT,
    fields: [
      { key: "sending", label: { de: "Wer schreibt die Nachricht", en: "Who writes the message" }, type: "select", default: "auto", options: [opt("auto", "Automatisch (KI-Entwurf)", "Automatically (AI draft)"), opt("caseworker", "Sachbearbeitung prüft und sendet", "Caseworker checks and sends")] },
      { key: "fallback", label: { de: "Text, falls kein KI-Entwurf", en: "Text if there is no AI draft" }, type: "textarea", default: "Bitte laden Sie die fehlenden Unterlagen hoch." },
      { key: "fallback_en", label: { de: "Text, falls kein KI-Entwurf (Englisch)", en: "Text if there is no AI draft (English)" }, type: "textarea", default: "Please upload the missing documents." },
    ],
  },
  send_notification: {
    kind: "send_notification", category: "message",
    title: { de: "Nachricht senden", en: "Send message" },
    description: { de: "Sendet eine Nachricht. Platzhalter: {name}, {reference}, {amount}.", en: "Sends a message. Placeholders: {name}, {reference}, {amount}." },
    outputs: OUT,
    fields: [
      { key: "to", label: { de: "An", en: "To" }, type: "select", default: "student", options: [opt("student", "Studierende", "Student"), opt("parents", "Eltern", "Parents"), opt("office", "Amt (intern)", "Office (internal)")] },
      { key: "subject", label: { de: "Betreff", en: "Subject" }, type: "text", default: "Neuigkeiten zu Ihrem Antrag {reference}" },
      { key: "body", label: { de: "Text", en: "Text" }, type: "textarea", default: "Guten Tag {name}, es gibt Neuigkeiten zu Ihrem Antrag." },
      { key: "subject_en", label: { de: "Betreff (Englisch)", en: "Subject (English)" }, type: "text", default: "News about your application {reference}" },
      { key: "body_en", label: { de: "Text (Englisch)", en: "Text (English)" }, type: "textarea", default: "Hello {name}, there is news about your application." },
    ],
  },
  connector: {
    kind: "connector", category: "connector",
    title: { de: "Verbindung zu Fachsystem", en: "System connector" },
    description: { de: "Ruft ein angebundenes System auf. Im Prototyp ein Platzhalter mit Beispielantwort.", en: "Calls a connected system. A placeholder with a sample response in the prototype." },
    outputs: OUT,
    fields: [
      { key: "system", label: { de: "System", en: "System" }, type: "select", default: "case_software", options: CONNECTORS.map((c) => ({ value: c.id, label: c.name })) },
      { key: "action", label: { de: "Aktion", en: "Action" }, type: "select", default: "create_case", options: CONNECTORS.flatMap((c) => c.actions.map((a) => ({ value: a.id, label: a.label }))) },
    ],
  },
  end: {
    kind: "end", category: "finish",
    title: { de: "Ende", en: "End" },
    description: { de: "Beendet den Ablauf an dieser Stelle.", en: "Ends the process here." },
    outputs: [], fields: [],
  },
};

export const outputsOf = (kind: NodeKind) => NODE_CATALOG[kind].outputs;

export function defaultConfig(kind: NodeKind, preset: Record<string, ConfigValue> = {}): Record<string, ConfigValue> {
  return { ...Object.fromEntries(NODE_CATALOG[kind].fields.map((f) => [f.key, f.default])), ...preset };
}

export interface ProcessIssue {
  nodeId?: string;
  message: Bilingual;
}

/** Checks that a drawn process can run: one start, no loose ends, no loops, valid settings. */
export function validateProcess(def: Pick<ProcessDef, "nodes" | "edges"> & { catalogId?: string; inputs?: ProcessInput[] }): ProcessIssue[] {
  const issues: ProcessIssue[] = [];
  if (def.catalogId !== undefined && !isCatalogVariant(def.catalogId)) issues.push({ message: { de: "Dem Ablauf ist keine Kategorie aus dem Prozesskatalog zugeordnet.", en: "The process is not assigned to a category from the process catalogue." } });
  const seenInputs = new Set<string>();
  for (const i of def.inputs ?? []) {
    if (seenInputs.has(i.id)) issues.push({ message: { de: `Die Eingabe „${i.ref}“ ist doppelt aufgeführt.`, en: `The input “${i.ref}” is listed twice.` } });
    seenInputs.add(i.id);
    if (i.type === "info" && i.question && !i.question.label.de.trim() && !i.question.label.en.trim()) issues.push({ message: { de: "Eine eigene Frage hat keinen Text.", en: "A custom question has no text." } });
  }
  const byId = new Map(def.nodes.map((n) => [n.id, n]));
  const triggers = def.nodes.filter((n) => n.kind === "trigger");
  if (triggers.length !== 1) issues.push({ message: { de: "Es braucht genau einen Startpunkt „Antrag geht ein“.", en: "There must be exactly one “Application arrives” start." } });
  for (const n of def.nodes) {
    const label = NODE_CATALOG[n.kind].title;
    for (const out of outputsOf(n.kind)) {
      if (!def.edges.some((e) => e.source === n.id && e.sourceHandle === out.id)) {
        issues.push({ nodeId: n.id, message: { de: `„${label.de}“: Ausgang „${out.label.de}“ ist nicht verbunden.`, en: `“${label.en}”: output “${out.label.en}” is not connected.` } });
      }
    }
    if (n.kind === "condition" && String(n.config.value ?? "").trim() === "") issues.push({ nodeId: n.id, message: { de: "„Bedingung“: Vergleichswert fehlt.", en: "“Condition”: compare-to value is missing." } });
    if (n.kind === "run_rules" && ruleSelection(n)?.length === 0) issues.push({ nodeId: n.id, message: { de: "„Freigegebene Regeln prüfen“: Es ist keine Regel ausgewählt.", en: "“Run approved rules”: no rule is ticked." } });
    if (n.kind === "send_notification" && !String(n.config.body ?? "").trim()) issues.push({ nodeId: n.id, message: { de: "„Nachricht senden“: Text fehlt.", en: "“Send message”: text is missing." } });
  }
  for (const e of def.edges) if (!byId.has(e.source) || !byId.has(e.target)) issues.push({ message: { de: "Eine Verbindung zeigt auf einen gelöschten Schritt.", en: "A connection points to a deleted step." } });
  if (triggers.length === 1) {
    const seen = new Set<string>();
    const stack = new Set<string>();
    let cyclic = false;
    const walk = (id: string) => {
      if (stack.has(id)) return void (cyclic = true);
      if (seen.has(id)) return;
      seen.add(id);
      stack.add(id);
      for (const e of def.edges) if (e.source === id && byId.has(e.target)) walk(e.target);
      stack.delete(id);
    };
    walk(triggers[0]!.id);
    if (cyclic) issues.push({ message: { de: "Der Ablauf enthält eine Schleife. Schleifen sind nicht erlaubt.", en: "The process contains a loop. Loops are not allowed." } });
    for (const n of def.nodes) if (!seen.has(n.id)) issues.push({ nodeId: n.id, message: { de: `„${NODE_CATALOG[n.kind].title.de}“ ist vom Start aus nicht erreichbar.`, en: `“${NODE_CATALOG[n.kind].title.en}” cannot be reached from the start.` } });
  }
  return issues;
}

/** The inputs of the standard process: the forms and information the abroad application needs. */
export function defaultInputs(): ProcessInput[] {
  const doc = (ref: string, when?: InputCondition, required = true): ProcessInput => ({ id: `doc:${ref}`, type: "document", ref, required, ...(when ? { when } : {}) });
  const known = (ref: string): ProcessInput => ({ id: `info:${ref}`, type: "info", ref, required: true });
  return [
    doc("application_form"), doc("fb06"), doc("enrollment_cert"),
    doc("host_confirmation", { kind: "stay_type", value: "study" }),
    doc("internship_contract", { kind: "stay_type", value: "internship" }),
    doc("internship_uni_confirmation", { kind: "stay_type", value: "internship" }),
    doc("health_insurance"),
    doc("tuition_waiver_proof", { kind: "tuition" }),
    doc("parent_form"), doc("parent_tax"),
    doc("fb08", { kind: "info", key: "parents_refuse", equals: "yes" }),
    known("country"), known("startDate"), known("endDate"), known("tuitionFees"),
    {
      id: "info:parents_refuse", type: "info", ref: "parents_refuse", required: false,
      question: { label: { de: "Zahlen Ihre Eltern den angerechneten Unterhalt nicht?", en: "Are your parents not paying the maintenance that is counted?" }, type: "yesno", help: { de: "Dann können Sie eine Vorausleistung beantragen (Formblatt 8).", en: "Then you can request an advance payment (Formblatt 8)." } },
    },
  ];
}

let seq = 0;
const nid = (p: string) => `${p}-${++seq}`;

/** Older copies of the standard process ended right after "question" in the review. Adds the caseworker's question and the wait. */
export function upgradeQuestionPath(def: ProcessDef): ProcessDef {
  const edge = def.edges.find((e) => e.source === "review" && e.sourceHandle === "info");
  const review = def.nodes.find((n) => n.id === "review" && n.kind === "review_fields");
  const target = edge && def.nodes.find((n) => n.id === edge.target);
  if (!edge || !review || target?.kind !== "end" || def.nodes.some((n) => n.id === "ask-q")) return def;
  const at = target.position;
  const nodes = [
    ...def.nodes,
    { id: "ask-q", kind: "request_documents" as const, position: { x: at.x, y: at.y - 130 }, config: defaultConfig("request_documents", { sending: "caseworker" }) },
    { id: "wait-q", kind: "wait" as const, position: { x: at.x, y: at.y - 60 }, config: defaultConfig("wait") },
  ];
  const edges = [
    ...def.edges.map((e) => (e.id === edge.id ? { ...e, target: "ask-q" } : e)),
    { id: "ask-q:out", source: "ask-q", sourceHandle: "out", target: "wait-q" },
    { id: "wait-q:out", source: "wait-q", sourceHandle: "out", target: target.id },
  ];
  return { ...def, nodes, edges };
}

/** Older copies of the standard process gave every case to "Team Ausland". Now the office's letter table decides, as the first step. */
export function upgradeAssignment(def: ProcessDef): ProcessDef {
  if (def.nodes.some((n) => n.kind === "assign_caseworker")) return def;
  const startEdge = def.edges.find((e) => e.source === "start" && e.sourceHandle === "out");
  const team = def.nodes.find((n) => n.id === "team" && n.kind === "assign_team" && n.config.team === "Team Ausland");
  if (!startEdge || !team) return def;
  const into = def.edges.filter((e) => e.target === "team");
  const out = def.edges.find((e) => e.source === "team" && e.sourceHandle === "out");
  if (!out || into.length === 0) return def;
  const edges = def.edges
    .filter((e) => e.source !== "team" && e.target !== "team" && e.id !== startEdge.id)
    .concat(
      { id: "start:out", source: "start", sourceHandle: "out", target: "assign" },
      { id: "assign:out", source: "assign", sourceHandle: "out", target: startEdge.target },
      ...into.map((e) => ({ ...e, target: out.target })),
    );
  const nodes = def.nodes.filter((n) => n.id !== "team").concat({ id: "assign", kind: "assign_caseworker", position: { x: 330, y: 55 }, config: defaultConfig("assign_caseworker") });
  return { ...def, nodes, edges };
}

const EN_OF: Record<string, string> = {
  "Entscheidung zu Ihrem Antrag {reference}": "Decision on your application {reference}",
  "Guten Tag {name}, Ihr Antrag wurde abgelehnt. Die Begründung steht im Bescheid.": "Hello {name}, your application was not approved. The reasons are in the decision notice.",
  "Ihr Antrag {reference} wurde bewilligt": "Your application {reference} has been approved",
  "Guten Tag {name}, Ihr Antrag wurde bewilligt: {amount} pro Monat. Der Bescheid folgt.": "Hello {name}, your application has been approved: {amount} per month. The decision notice follows.",
  "Unsicher gelesene Felder mit dem Dokument vergleichen.": "Compare the fields read with low confidence against the document.",
  "Inhaltlich prüfen und entscheiden.": "Review the content and decide.",
  "Bitte laden Sie die fehlenden Unterlagen hoch.": "Please upload the missing documents.",
  "Neuigkeiten zu Ihrem Antrag {reference}": "News about your application {reference}",
  "Guten Tag {name}, es gibt Neuigkeiten zu Ihrem Antrag.": "Hello {name}, there is news about your application.",
};

/** Older processes only had German texts in their steps. Adds the English twin where the German text is one of the standard ones, and the English name of the standard process. */
export function upgradeEnglish(def: ProcessDef): ProcessDef {
  let changed = false;
  const nodes = def.nodes.map((n) => {
    const config = { ...n.config };
    for (const key of ["subject", "body", "instruction", "fallback"]) {
      const de = config[key];
      if (typeof de === "string" && EN_OF[de] && (config[`${key}_en`] === undefined || config[`${key}_en`] === "")) {
        config[`${key}_en`] = EN_OF[de]!;
        changed = true;
      }
    }
    return changed && n.config !== config ? { ...n, config } : n;
  });
  const renamed = def.name === "Auslands-BAföG: Standardablauf" ? "Abroad BAföG: standard process" : def.name;
  const by = def.updatedBy === "Fachbereich Ausland (Muster)" ? "Abroad unit (sample)" : def.updatedBy;
  if (!changed && renamed === def.name && by === def.updatedBy) return def;
  return { ...def, nodes, name: renamed, updatedBy: by };
}

/** The standard process an office starts with. It reproduces the fixed workflow of the first version. */
export function defaultProcess(now = "2026-09-01T09:00:00.000Z"): ProcessDef {
  const n = (id: string, kind: NodeKind, x: number, y: number, config: Record<string, ConfigValue> = {}): FlowNode => ({ id, kind, position: { x, y }, config: defaultConfig(kind, config) });
  const e = (source: string, sourceHandle: string, target: string): FlowEdge => ({ id: `${source}:${sourceHandle}`, source, sourceHandle, target });
  void nid;
  const nodes: FlowNode[] = [
    n("start", "trigger", 330, 0),
    n("assign", "assign_caseworker", 330, 55),
    n("read", "read_documents", 330, 110),
    n("review", "review_fields", 20, 230),
    n("ask-q", "request_documents", -200, 330, { sending: "caseworker" }),
    n("wait-q", "wait", -200, 450),
    n("end-review", "end", -200, 570),
    n("rules", "run_rules", 330, 260, { rules: RULES.map((r) => r.id).join(",") }),
    // incomplete branch
    n("draft", "ai_draft_mail", 20, 270),
    n("ask", "request_documents", 20, 400),
    n("end-incomplete", "end", 20, 540),
    // complete branch
    n("human", "human_task", 480, 390, { instruction: "Inhaltlich prüfen und entscheiden.", instruction_en: "Review the content and decide." }),
    n("end-info", "end", 300, 560),
    n("notify-no", "send_notification", 560, 560, { to: "student", subject: "Entscheidung zu Ihrem Antrag {reference}", body: "Guten Tag {name}, Ihr Antrag wurde abgelehnt. Die Begründung steht im Bescheid.", subject_en: "Decision on your application {reference}", body_en: "Hello {name}, your application was not approved. The reasons are in the decision notice." }),
    n("end-no", "end", 560, 720),
    n("case", "connector", 820, 470, { system: "payment", action: "create_payment_order" }),
    n("notify-ok", "send_notification", 820, 590, { to: "student", subject: "Ihr Antrag {reference} wurde bewilligt", body: "Guten Tag {name}, Ihr Antrag wurde bewilligt: {amount} pro Monat. Der Bescheid folgt.", subject_en: "Your application {reference} has been approved", body_en: "Hello {name}, your application has been approved: {amount} per month. The decision notice follows." }),
    n("end-ok", "end", 820, 750),
  ];
  const edges: FlowEdge[] = [
    e("start", "out", "assign"), e("assign", "out", "read"), e("read", "clear", "rules"), e("read", "review", "review"), e("review", "confirmed", "rules"), e("review", "info", "ask-q"), e("ask-q", "out", "wait-q"), e("wait-q", "out", "end-review"),
    e("rules", "incomplete", "draft"), e("draft", "out", "ask"), e("ask", "out", "end-incomplete"),
    e("rules", "complete", "human"),
    e("human", "approved", "case"), e("case", "out", "notify-ok"), e("notify-ok", "out", "end-ok"),
    e("human", "rejected", "notify-no"), e("notify-no", "out", "end-no"),
    e("human", "info", "end-info"),
  ];
  return { id: "bafoeg-ausland", catalogId: "bafoeg.abroad", name: "Abroad BAföG: standard process", version: 1, updatedAt: now, updatedBy: "Abroad unit (sample)", inputs: defaultInputs(), nodes, edges };
}

/**
 * The reference model of the catalogue entry "BAföG, abroad application": what the oversight body considers the shared target.
 * Offices are compared against it. It is read-only in the prototype.
 */
export function referenceProcess(): ProcessDef {
  const base = defaultProcess("2026-06-01T09:00:00.000Z");
  const nodes: FlowNode[] = base.nodes.map((x) => ({ ...x, config: { ...x.config } }));
  const edges: FlowEdge[] = base.edges.map((x) => ({ ...x }));
  const n = (id: string, kind: NodeKind, x: number, y: number, config: Record<string, ConfigValue> = {}): FlowNode => ({ id, kind, position: { x, y }, config: defaultConfig(kind, config) });
  // After the payment, the case is archived and the status is reported to the portal.
  const notifyOk = edges.find((e) => e.source === "notify-ok")!;
  nodes.push(n("portal", "connector", 820, 690, { system: "portal", action: "send_status" }), n("archive", "connector", 820, 800, { system: "efile", action: "archive_case" }));
  notifyOk.target = "portal";
  edges.push({ id: "portal:out", source: "portal", sourceHandle: "out", target: "archive" }, { id: "archive:out", source: "archive", sourceHandle: "out", target: "end-ok" });
  nodes.find((x) => x.id === "end-ok")!.position = { x: 820, y: 920 };
  return { ...base, id: "bafoeg-abroad-reference", name: "Reference model: BAföG abroad (application)", version: 1, nodes, edges, updatedBy: "Federal oversight (sample)" };
}
