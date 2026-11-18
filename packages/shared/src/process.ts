import { isCatalogVariant } from "./catalog.js";
import { RULES } from "./rules.js";
import type { Bilingual, FieldType } from "./types.js";

export type NodeKind =
  | "trigger"
  | "run_rules"
  | "check_inputs"
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
  /** Stable and invisible: texts refer to a step by this, so renaming or moving a step never breaks them. */
  id: string;
  kind: NodeKind;
  /** What people see and call the step. Required and unique within a process. */
  name?: string;
  /** One line on what the step is for. */
  purpose?: string;
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

/** A saved sample the process has to handle as expected, like the sample cases of a rule. Run before every publish. */
export interface ProcessTest {
  id: string;
  name: string;
  /** One of the sample cases of the builder: incomplete, complete, internship, unclear. */
  sample: string;
  /** What the caseworker does after the process stops for a person: approved, rejected, info or confirmed. */
  decision?: string;
  expect: {
    /** Steps (by id) the case must pass through. */
    visits: string[];
    /** Where the process must stop for a person or a timer, or nowhere. */
    waitingAt?: string | null;
  };
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
  /** Who is responsible for this process. */
  owner?: string;
  /** Why this version was published. */
  changeNote?: string;
  /** Samples that must still work before a new version goes live. */
  tests?: ProcessTest[];
}

export interface FieldSpec {
  key: string;
  label: Bilingual;
  /** rules: a list of rule ids. template: a message template. params: what the template's parameters are bound to. */
  type: "text" | "textarea" | "number" | "select" | "rules" | "template" | "params";
  options?: { value: string; label: Bilingual }[];
  default: ConfigValue;
  /** Must not be empty. */
  required?: boolean;
}

export type Category = "start" | "check" | "decide" | "message" | "route" | "connector" | "finish";

export interface NodeSpec {
  kind: NodeKind;
  category: Category;
  title: Bilingual;
  description: Bilingual;
  /** Output handles. Steps with several outputs branch. */
  outputs: { id: string; label: Bilingual; /** Followed only if it is connected; a missing connection is not an error. */ optional?: boolean }[];
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

/** One thing a step hands on to the steps after it, usable as {name} in their texts. */
export type OutputType = "text" | "number" | "list" | "date" | "yesno";

export interface StepOutput {
  name: string;
  label: Bilingual;
  example: string;
  /** What the value is, so a text can show a list as bullets or as a count, and a condition can refuse a list where a number is needed. */
  type: OutputType;
}

const o = (name: string, de: string, en: string, example: string, type: OutputType = "text"): StepOutput => ({ name, label: { de, en }, example, type });

/** How a tile of a given type can be shown in a text: {step.output:format}. The first is the default. */
export const OUTPUT_FORMATS: Record<OutputType, string[]> = { text: [], number: [], date: [], yesno: [], list: ["bullets", "comma", "count", "first"] };

/** What each kind of step produces. A later step in the same branch can put these into its message with {name}. */
export const STEP_OUTPUTS: Record<NodeKind, StepOutput[]> = {
  trigger: [],
  assign_caseworker: [o("caseworker", "Zuständige Sachbearbeitung", "The responsible caseworker", "Frau Demir")],
  assign_team: [o("team", "Zugewiesenes Team", "The assigned team", "Team Ausland")],
  read_documents: [
    o("documents_read", "Liste der gelesenen Dokumente", "List of the documents read", "• Income tax assessment (built-in reader)", "list"),
    o("unreadable_documents", "Dokumente, die nicht gelesen werden konnten", "Documents that could not be read", "• Enrolment_certificate.pdf", "list"),
  ],
  review_fields: [
    o("review_list", "Kurze Liste der unklaren Dokumente und Felder", "Brief list of the unclear documents and fields", "• Income tax assessment: Total income (EUR)", "list"),
    o("review_details", "Ausführlich, warum Felder nicht lesbar waren", "Detailed reasons why fields could not be read", "Total income (EUR): read as \"54?00 (illegible)\", 55 % sure (80 % needed). Part of the value could not be read.", "list"),
  ],
  check_inputs: [
    o("missing_inputs", "Fehlende Angaben und Dokumente", "Missing documents and answers", "• Host university confirmation\n• Destination country", "list"),
    o("missing_inputs_count", "Anzahl der fehlenden Angaben", "Number of missing items", "2", "number"),
  ],
  run_rules: [
    o("open_items", "Offene Punkte, die den Antrag blockieren", "Open items that block the application", "• The parents' signature is missing.", "list"),
    o("missing_documents", "Fehlende erforderliche Dokumente", "Required documents that are missing", "• Host university confirmation", "list"),
    o("warnings", "Hinweise, die nicht blockieren", "Notes that do not block", "• Your stay is short.", "list"),
    o("open_count", "Anzahl der offenen Punkte", "Number of open items", "2", "number"),
  ],
  condition: [o("condition_result", "Ergebnis der Bedingung (ja/nein)", "Result of the condition (yes/no)", "yes", "yesno")],
  human_task: [
    o("decision", "Entscheidung der Sachbearbeitung", "The caseworker's decision", "approved"),
    o("decision_note", "Begründung für die Studierenden", "The explanation for the student", "Your monthly need is …"),
    o("decision_amount", "Bewilligter Betrag pro Monat", "Approved amount per month", "840 €"),
  ],
  wait: [o("reminder_date", "Datum der Erinnerung", "Date of the reminder", "2026-11-25", "date")],
  ai_draft_mail: [
    o("draft_subject", "Betreff des KI-Entwurfs", "Subject of the AI draft", "Your application: what is still missing (2)"),
    o("draft_body", "Text des KI-Entwurfs", "Text of the AI draft", "Hi Paul, thank you for your application …"),
  ],
  request_documents: [
    o("request_subject", "Betreff der gesendeten Nachfrage", "Subject of the question that was sent", "Question about your application"),
    o("request_text", "Text der gesendeten Nachfrage", "Text of the question that was sent", "Hi Paul, …"),
  ],
  send_notification: [
    o("message_subject", "Betreff der gesendeten Nachricht", "Subject of the message that was sent", "Your application has been approved"),
    o("message_body", "Text der gesendeten Nachricht", "Text of the message that was sent", "Hello Paul, …"),
  ],
  connector: [
    o("connector_id", "Kennung der Antwort des Systems", "ID returned by the system", "PA-00044"),
    o("connector_system", "Angesprochenes System", "The system that was called", "payment"),
    o("connector_action", "Ausgeführte Aktion", "The action that was run", "create_payment_order"),
    o("connector_error", "Fehlermeldung, falls der Aufruf scheiterte", "Error message if the call failed", "The payment system did not answer."),
  ],
  end: [],
};

/** Available in every text, without any step: name, reference and the estimated amount. */
/** The text a question to the student starts from after a review: what is unclear and why. The caseworker edits it before it is sent. */
export const QUESTION_TEXT = {
  de: "vielen Dank für Ihren Antrag {reference}. Bevor wir ihn bearbeiten können, brauchen wir noch Folgendes:\n\n{review.review_list}\n\nDetails:\n{review.review_details}\n\nLaden Sie die Unterlagen einfach in Ihrem Antrag hoch. Sobald alles vollständig ist, geht Ihr Antrag direkt in die Prüfung.",
  en: "thank you for your application {reference}. Before we can process it we still need the following:\n\n{review.review_list}\n\nDetails:\n{review.review_details}\n\nSimply upload the documents in your application. As soon as everything is complete, your application goes straight to review.",
};

export const GLOBAL_PLACEHOLDERS: StepOutput[] = [
  o("name", "Name der Studierenden", "Name of the student", "Paul Neumann"),
  o("reference", "Aktenzeichen", "Case reference", "MS-2026-00044"),
  o("amount", "Betrag pro Monat", "Amount per month", "840 €"),
];

/** The outputs a step can use: everything produced by the steps that lead to it, nearest first. */
export function upstreamOutputs(def: { nodes: { id: string; kind: NodeKind }[]; edges: { source: string; target: string }[] }, nodeId: string): { nodeId: string; kind: NodeKind; output: StepOutput }[] {
  const byId = new Map(def.nodes.map((n) => [n.id, n]));
  const seen = new Set<string>([nodeId]);
  const order: string[] = [];
  let frontier = [nodeId];
  while (frontier.length) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of def.edges) {
        if (e.target === id && !seen.has(e.source) && byId.has(e.source)) {
          seen.add(e.source);
          order.push(e.source);
          next.push(e.source);
        }
      }
    }
    frontier = next;
  }
  return order.flatMap((id) => STEP_OUTPUTS[byId.get(id)!.kind].map((output) => ({ nodeId: id, kind: byId.get(id)!.kind, output })));
}

/** Every field where a person types something, and so can put outputs of earlier steps into. */
export const TOKEN_KEYS = ["subject", "body", "fallback", "instruction", "subject_en", "body_en", "fallback_en", "instruction_en", "value", "payload", "params"];
const ALL_OUTPUT_NAMES = new Set(Object.values(STEP_OUTPUTS).flatMap((l) => l.map((x) => x.name)));
export const TOKEN_RE = /\{([A-Za-z0-9_-]+)(?:\.([a-z_]+))?(?::([a-z]+))?\}/g;
/** The tokens in a text: {name} for the basics and for the latest output of that name, {stepId.output} for one particular step. */
export const tokensIn = (text: string): { raw: string; step?: string; name: string; format?: string }[] =>
  [...text.matchAll(TOKEN_RE)].map((m) => (m[2] ? { raw: m[0], step: m[1]!, name: m[2], ...(m[3] ? { format: m[3] } : {}) } : { raw: m[0], name: m[1], ...(m[3] ? { format: m[3] } : {}) }));

export const NODE_CATALOG: Record<NodeKind, NodeSpec> = {
  trigger: {
    kind: "trigger", category: "start",
    title: { de: "Antrag geht ein", en: "Application arrives" },
    description: { de: "Startet den Ablauf, sobald ein Antrag eingereicht oder aus dem Portal geliefert wird.", en: "Starts the process when an application is submitted or delivered from the portal." },
    outputs: OUT,
    fields: [{ key: "source", label: { de: "Herkunft", en: "Source" }, type: "select", default: "any", options: [opt("any", "Alle", "All"), opt("portal", "Nur Portal", "Portal only"), opt("web", "Nur direkt", "Direct only")] }],
  },
  check_inputs: {
    kind: "check_inputs", category: "check",
    title: { de: "Erforderliche Angaben prüfen", en: "Check required inputs" },
    description: { de: "Prüft, ob alle Formulare und Angaben da sind, die dieser Ablauf unter „Eingaben“ verlangt. Keine Regel, keine KI.", en: "Checks that every form and answer this process requires under “Inputs” is there. No rules, no AI." },
    outputs: [{ id: "complete", label: { de: "vollständig", en: "complete" } }, { id: "incomplete", label: { de: "unvollständig", en: "incomplete" } }],
    fields: [],
  },
  run_rules: {
    kind: "run_rules", category: "check",
    title: { de: "Freigegebene Regeln prüfen", en: "Run approved rules" },
    description: { de: "Prüft den Antrag gegen die hier ausgewählten, freigegebenen Regeln. Feste Prüfung, keine KI.", en: "Checks the application against the approved rules ticked here. Fixed check, no AI." },
    outputs: [{ id: "complete", label: { de: "vollständig", en: "complete" } }, { id: "incomplete", label: { de: "unvollständig", en: "incomplete" } }],
    /** rules: comma-separated rule ids. Empty means no rule runs. A block saved before this existed has no value and runs all live rules. withInputs: older steps also checked the required inputs; new ones do that in their own step. */
    fields: [
      { key: "rules", label: { de: "Regeln", en: "Rules" }, type: "rules", default: "" },
      { key: "withInputs", label: { de: "Auch die erforderlichen Angaben prüfen", en: "Also check the required inputs" }, type: "select", default: "no", options: [opt("no", "Nein, dafür gibt es einen eigenen Schritt", "No, there is a step of its own for that"), opt("yes", "Ja (wie in älteren Abläufen)", "Yes (as in older processes)")] },
    ],
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
    description: { de: "Der Ablauf hält an und läuft nach der eingestellten Zeit weiter. Meldet sich die Person vorher mit neuen Unterlagen, beginnt der Ablauf neu.", en: "The process stops and carries on after the set time. If the person sends new documents before that, the process starts again." },
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
    description: { de: "Setzt den Antrag auf „Rückfrage“ und schickt die Nachricht. Wählen Sie eine freigegebene Nachrichtenvorlage oder schreiben Sie den Text selbst; Ergebnisse früherer Schritte setzen Sie als Kacheln ein.", en: "Sets the case to “question” and sends the message. Pick an approved message template or write the text yourself; put outputs of earlier steps in as tiles." },
    outputs: OUT,
    fields: [
      { key: "sending", label: { de: "Wer schreibt die Nachricht", en: "Who writes the message" }, type: "select", default: "auto", options: [opt("auto", "Der Ablauf, automatisch", "The process, automatically"), opt("caseworker", "Sachbearbeitung prüft und sendet", "Caseworker checks and sends")] },
      { key: "template", label: { de: "Nachrichtenvorlage", en: "Message template" }, type: "template", default: "" },
      { key: "params", label: { de: "Werte für die Vorlage", en: "Values for the template" }, type: "params", default: "" },
      { key: "use_draft", label: { de: "KI-Entwurf von früher übernehmen", en: "Take over an earlier AI draft" }, type: "select", default: "no", options: [opt("no", "Nein, nur was ich hier einsetze", "No, only what I put in here"), opt("yes", "Ja, wie in älteren Abläufen", "Yes (as in older processes)")] },
      { key: "subject", label: { de: "Betreff (ohne Vorlage)", en: "Subject (without a template)" }, type: "text", default: "" },
      { key: "subject_en", label: { de: "Betreff (Englisch)", en: "Subject (English)" }, type: "text", default: "" },
      { key: "fallback", label: { de: "Text (ohne Vorlage)", en: "Text (without a template)" }, type: "textarea", default: "Bitte laden Sie die fehlenden Unterlagen hoch." },
      { key: "fallback_en", label: { de: "Text (Englisch)", en: "Text (English)" }, type: "textarea", default: "Please upload the missing documents." },
    ],
  },
  send_notification: {
    kind: "send_notification", category: "message",
    title: { de: "Nachricht senden", en: "Send message" },
    description: { de: "Sendet eine Nachricht. Wählen Sie eine freigegebene Nachrichtenvorlage oder schreiben Sie den Text selbst; Ergebnisse früherer Schritte setzen Sie als Kacheln ein.", en: "Sends a message. Pick an approved message template or write the text yourself; put outputs of earlier steps in as tiles." },
    outputs: OUT,
    fields: [
      { key: "to", label: { de: "An", en: "To" }, type: "select", default: "student", options: [opt("student", "Studierende", "Student"), opt("parents", "Eltern", "Parents"), opt("office", "Amt (intern)", "Office (internal)")] },
      { key: "template", label: { de: "Nachrichtenvorlage", en: "Message template" }, type: "template", default: "" },
      { key: "params", label: { de: "Werte für die Vorlage", en: "Values for the template" }, type: "params", default: "" },
      { key: "subject", label: { de: "Betreff (ohne Vorlage)", en: "Subject (without a template)" }, type: "text", default: "Neuigkeiten zu Ihrem Antrag {reference}" },
      { key: "body", label: { de: "Text (ohne Vorlage)", en: "Text (without a template)" }, type: "textarea", default: "Guten Tag {name}, es gibt Neuigkeiten zu Ihrem Antrag." },
      { key: "subject_en", label: { de: "Betreff (Englisch)", en: "Subject (English)" }, type: "text", default: "News about your application {reference}" },
      { key: "body_en", label: { de: "Text (Englisch)", en: "Text (English)" }, type: "textarea", default: "Hello {name}, there is news about your application." },
    ],
  },
  connector: {
    kind: "connector", category: "connector",
    title: { de: "Verbindung zu Fachsystem", en: "System connector" },
    description: { de: "Ruft ein angebundenes System über die Verbindung des Amts auf. Im Prototyp ein Platzhalter mit Beispielantwort. Scheitert der Aufruf, folgt der Ausgang „Fehler“; ist er nicht verbunden, hält der Ablauf an und der Fall erscheint unter „Braucht Aufmerksamkeit“.", en: "Calls a connected system through the office's connection. A placeholder with a sample response in the prototype. If the call fails, the “error” output is followed; if it is not connected, the process stops and the case shows up as “Needs attention”." },
    outputs: [...OUT, { id: "error", label: { de: "Fehler", en: "error" }, optional: true }],
    fields: [
      { key: "system", label: { de: "System", en: "System" }, type: "select", default: "case_software", options: CONNECTORS.map((c) => ({ value: c.id, label: c.name })) },
      { key: "action", label: { de: "Aktion", en: "Action" }, type: "select", default: "create_case", options: CONNECTORS.flatMap((c) => c.actions.map((a) => ({ value: a.id, label: a.label }))) },
      { key: "payload", label: { de: "Daten, die gesendet werden", en: "Data sent to the system" }, type: "textarea", default: "reference: {reference}\namount: {amount}" },
      { key: "retries", label: { de: "Wiederholungen bei Fehlern", en: "Retries on failure" }, type: "number", default: 0 },
      { key: "simulate", label: { de: "Fehler simulieren (zum Testen)", en: "Simulate a failure (for testing)" }, type: "select", default: "none", options: [opt("none", "Nein", "No"), opt("once", "Nur beim ersten Versuch", "On the first attempt only"), opt("always", "Immer", "Always")] },
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
  const names = new Map<string, string[]>();
  for (const n of def.nodes) {
    const label = n.name?.trim() ? { de: n.name, en: n.name } : NODE_CATALOG[n.kind].title;
    const nm = n.name?.trim().toLowerCase();
    if (!nm) issues.push({ nodeId: n.id, message: { de: `„${NODE_CATALOG[n.kind].title.de}“ hat keinen Namen. Jeder Schritt braucht einen Namen.`, en: `“${NODE_CATALOG[n.kind].title.en}” has no name. Every step needs a name.` } });
    else names.set(nm, [...(names.get(nm) ?? []), n.id]);
    // The settings have to match what the kind of step offers.
    const spec = NODE_CATALOG[n.kind];
    for (const [key, value] of Object.entries(n.config)) {
      const f = spec.fields.find((x) => x.key === key);
      if (!f) {
        if (key !== "method") issues.push({ nodeId: n.id, message: { de: `„${label.de}“: Die Einstellung „${key}“ gibt es für diesen Schritt nicht.`, en: `“${label.en}”: there is no setting “${key}” for this kind of step.` } });
        continue;
      }
      if (f.type === "select" && f.options && !f.options.some((o) => o.value === String(value))) issues.push({ nodeId: n.id, message: { de: `„${label.de}“: „${String(value)}“ ist bei „${f.label.de}“ nicht möglich.`, en: `“${label.en}”: “${String(value)}” is not a possible value for “${f.label.en}”.` } });
      if (f.type === "number" && !Number.isFinite(Number(value))) issues.push({ nodeId: n.id, message: { de: `„${label.de}“: „${f.label.de}“ muss eine Zahl sein.`, en: `“${label.en}”: “${f.label.en}” has to be a number.` } });
      if (f.required && String(value ?? "").trim() === "") issues.push({ nodeId: n.id, message: { de: `„${label.de}“: „${f.label.de}“ fehlt.`, en: `“${label.en}”: “${f.label.en}” is missing.` } });
    }
    for (const out of outputsOf(n.kind).filter((o) => !o.optional)) {
      if (!def.edges.some((e) => e.source === n.id && e.sourceHandle === out.id)) {
        issues.push({ nodeId: n.id, message: { de: `„${label.de}“: Ausgang „${out.label.de}“ ist nicht verbunden.`, en: `“${label.en}”: output “${out.label.en}” is not connected.` } });
      }
    }
    if (n.kind === "condition" && String(n.config.value ?? "").trim() === "") issues.push({ nodeId: n.id, message: { de: `„${label.de}“: Vergleichswert fehlt.`, en: `“${label.en}”: compare-to value is missing.` } });
    if (n.kind === "run_rules" && ruleSelection(n)?.length === 0) issues.push({ nodeId: n.id, message: { de: `„${label.de}“: Es ist keine Regel ausgewählt.`, en: `“${label.en}”: no rule is ticked.` } });
    if (n.kind === "request_documents" || n.kind === "send_notification") {
      const bound = tokensIn(String(n.config.params ?? "")).length;
      if (n.config.template && String(n.config.params ?? "").trim() !== "" && bound === 0) issues.push({ nodeId: n.id, message: { de: `„${label.de}“: Den Werten der Vorlage ist nichts zugeordnet.`, en: `“${label.en}”: nothing is put into the values of the template.` } });
    }
    {
      const up = upstreamOutputs(def, n.id);
      const have = new Set(up.map((x) => x.output.name));
      const globals = new Set(GLOBAL_PLACEHOLDERS.map((g) => g.name));
      const seenTokens = new Set<string>();
      for (const k of TOKEN_KEYS) {
        for (const tk of tokensIn(String(n.config[k] ?? ""))) {
          if (seenTokens.has(tk.raw)) continue;
          seenTokens.add(tk.raw);
          const outType = (STEP_OUTPUTS[(tk.step ? byId.get(tk.step)?.kind : undefined) ?? n.kind] ?? []).find((x) => x.name === tk.name)?.type ?? Object.values(STEP_OUTPUTS).flat().find((x) => x.name === tk.name)?.type;
          if (tk.format && outType && !OUTPUT_FORMATS[outType].includes(tk.format)) issues.push({ nodeId: n.id, message: { de: `„${label.de}“: ${tk.raw}: „${tk.format}“ gibt es für diesen Wert nicht.`, en: `“${label.en}”: ${tk.raw}: there is no “${tk.format}” format for this value.` } });
          if (n.kind === "condition" && k === "value" && outType && outType !== "number" && tk.format !== "count") issues.push({ nodeId: n.id, message: { de: `„${label.de}“: ${tk.raw} ist keine Zahl. Eine Bedingung vergleicht Zahlen; bei einer Liste nehmen Sie „Anzahl“.`, en: `“${label.en}”: ${tk.raw} is not a number. A condition compares numbers; for a list use “count”.` } });
          if (tk.step) {
            const src = byId.get(tk.step);
            const srcLabel = src ? NODE_CATALOG[src.kind].title : null;
            if (!src) issues.push({ nodeId: n.id, message: { de: `„${label.de}“: ${tk.raw} zeigt auf einen Schritt, den es nicht mehr gibt.`, en: `“${label.en}”: ${tk.raw} points to a step that no longer exists.` } });
            else if (!up.some((x) => x.nodeId === tk.step && x.output.name === tk.name)) issues.push({ nodeId: n.id, message: { de: `„${label.de}“: „${srcLabel!.de}“ liefert ${tk.name} hier nicht. Der Schritt muss vor diesem Schritt stehen und mit ihm verbunden sein.`, en: `“${label.en}”: “${srcLabel!.en}” does not provide ${tk.name} here. That step has to come before this one and be connected to it.` } });
          } else if (ALL_OUTPUT_NAMES.has(tk.name) && !have.has(tk.name) && !globals.has(tk.name)) {
            issues.push({ nodeId: n.id, message: { de: `„${label.de}“: {${tk.name}} gibt es hier nicht. Verbinden Sie vorher den Schritt, der es liefert.`, en: `“${label.en}”: {${tk.name}} is not available here. Connect the step that provides it before this one.` } });
          }
        }
      }
    }
    if (n.kind === "send_notification" && !n.config.template && !String(n.config.body ?? "").trim()) issues.push({ nodeId: n.id, message: { de: `„${label.de}“: Text fehlt.`, en: `“${label.en}”: text is missing.` } });
  }
  for (const ids of names.values()) if (ids.length > 1) issues.push({ nodeId: ids[1], message: { de: `Zwei Schritte heißen „${def.nodes.find((x) => x.id === ids[0])!.name}“. Jeder Name darf nur einmal vorkommen.`, en: `Two steps are named “${def.nodes.find((x) => x.id === ids[0])!.name}”. Every name can be used once.` } });
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
    { id: "ask-q", kind: "request_documents" as const, name: STANDARD_STEPS["ask-q"]!.name, purpose: STANDARD_STEPS["ask-q"]!.purpose, position: { x: at.x, y: at.y - 130 }, config: defaultConfig("request_documents", { sending: "caseworker", fallback: QUESTION_TEXT.de, fallback_en: QUESTION_TEXT.en }) },
    { id: "wait-q", kind: "wait" as const, name: STANDARD_STEPS["wait-q"]!.name, purpose: STANDARD_STEPS["wait-q"]!.purpose, position: { x: at.x, y: at.y - 60 }, config: defaultConfig("wait") },
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
  const nodes = def.nodes.filter((n) => n.id !== "team").concat({ id: "assign", kind: "assign_caseworker", name: STANDARD_STEPS.assign!.name, purpose: STANDARD_STEPS.assign!.purpose, position: { x: 330, y: 55 }, config: defaultConfig("assign_caseworker") });
  return { ...def, nodes, edges };
}

/** The question step of older copies only said "please upload the missing documents". Gives it the text with the review outputs. */
export function upgradeOutputs(def: ProcessDef): ProcessDef {
  const node = def.nodes.find((n) => n.id === "ask-q" && n.kind === "request_documents" && n.config.sending === "caseworker");
  if (node && /\{review_(list|details)\}/.test(`${node.config.fallback ?? ""}${node.config.fallback_en ?? ""}`)) {
    const q = (v: unknown) => String(v ?? "").replace(/\{review_(list|details)\}/g, "{review.review_$1}");
    return { ...def, nodes: def.nodes.map((n) => (n === node ? { ...n, config: { ...n.config, fallback: q(n.config.fallback), fallback_en: q(n.config.fallback_en) } } : n)) };
  }
  if (!node || String(node.config.fallback ?? "").includes("{review.")) return def;
  if (String(node.config.fallback ?? "") !== "Bitte laden Sie die fehlenden Unterlagen hoch." && String(node.config.fallback ?? "").trim() !== "") return def;
  return { ...def, nodes: def.nodes.map((n) => (n === node ? { ...n, config: { ...n.config, fallback: QUESTION_TEXT.de, fallback_en: QUESTION_TEXT.en } } : n)) };
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

/** Names and one-line purposes of the steps of the standard process. */
const STANDARD_STEPS: Record<string, { name: string; purpose: string }> = {
  start: { name: "Application arrives", purpose: "Starts the process when an application is submitted or delivered from the portal." },
  assign: { name: "Assign caseworker by surname", purpose: "Gives the case to the caseworker responsible for the first letter of the family name." },
  read: { name: "Read documents", purpose: "Reads every uploaded document into fields with the method set for its type." },
  review: { name: "Review unclear fields", purpose: "A person checks the fields the reader was not sure about." },
  inputs: { name: "Check required inputs", purpose: "Checks that every form and answer the process requires is there." },
  rules: { name: "Check approved rules", purpose: "Applies the ticked, approved rules to the application." },
  draft: { name: "Draft e-mail about what is missing", purpose: "Writes a message to the applicant from the open items." },
  ask: { name: "Send the missing-items e-mail", purpose: "Sends the draft and sets the case to waiting for the applicant." },
  "end-incomplete": { name: "End: waiting for the applicant", purpose: "The applicant has been asked for the missing items; a new upload starts the process again." },
  human: { name: "Caseworker decides", purpose: "A person decides: approve, reject or ask a question." },
  case: { name: "Create payment order", purpose: "Hands the approved amount to the payment system." },
  "notify-ok": { name: "Approval message", purpose: "Tells the applicant the application was approved." },
  "end-ok": { name: "End: approved", purpose: "The case is approved." },
  "notify-no": { name: "Rejection message", purpose: "Tells the applicant the application was not approved." },
  "end-no": { name: "End: rejected", purpose: "The case is rejected." },
  "end-info": { name: "End: question to the applicant", purpose: "The caseworker asked the applicant a question." },
  "ask-q": { name: "Ask the applicant about unclear fields", purpose: "The caseworker checks and sends a question about the unclear fields." },
  "wait-q": { name: "Wait for the applicant", purpose: "Holds the case for the set time; a new upload starts the process again." },
  remind: { name: "Remind the applicant", purpose: "Sends a reminder if nothing came back." },
  "end-review": { name: "End: reminder sent", purpose: "The applicant has been asked and reminded." },
};

/** The samples the standard process must keep handling as described. */
export const STANDARD_TESTS: ProcessTest[] = [
  { id: "t-unclear", name: "Unclear scan: stops for a person to check the field", sample: "unclear", expect: { visits: ["start", "assign", "read", "review"], waitingAt: "review" } },
  { id: "t-unclear-confirmed", name: "Unclear scan, field confirmed: goes to the caseworker", sample: "unclear", decision: "confirmed", expect: { visits: ["review", "inputs", "rules", "human"], waitingAt: "human" } },
  { id: "t-incomplete", name: "Missing documents: the applicant gets an e-mail", sample: "incomplete", expect: { visits: ["inputs", "draft", "ask", "end-incomplete"], waitingAt: null } },
  { id: "t-complete", name: "Complete case: waits for the caseworker", sample: "complete", expect: { visits: ["inputs", "rules", "human"], waitingAt: "human" } },
  { id: "t-approved", name: "Approved: payment order and approval message", sample: "complete", decision: "approved", expect: { visits: ["human", "case", "notify-ok", "end-ok"], waitingAt: null } },
];

/** The standard process an office starts with. */
export function defaultProcess(now = "2026-09-01T09:00:00.000Z"): ProcessDef {
  const n = (id: string, kind: NodeKind, x: number, y: number, config: Record<string, ConfigValue> = {}): FlowNode => ({ id, kind, name: STANDARD_STEPS[id]?.name, purpose: STANDARD_STEPS[id]?.purpose, position: { x, y }, config: defaultConfig(kind, config) });
  const e = (source: string, sourceHandle: string, target: string): FlowEdge => ({ id: `${source}:${sourceHandle}`, source, sourceHandle, target });
  void nid;
  const ALL = RULES.map((r) => r.id).join(",");
  const nodes: FlowNode[] = [
    n("start", "trigger", 330, 0),
    n("assign", "assign_caseworker", 330, 55),
    n("read", "read_documents", 330, 110),
    n("review", "review_fields", 20, 230),
    n("inputs", "check_inputs", 330, 230),
    n("rules", "run_rules", 330, 330, { rules: ALL, withInputs: "no" }),
    n("draft", "ai_draft_mail", 20, 400),
    n("ask", "request_documents", 20, 520, { sending: "auto", use_draft: "no", subject: "{draft.draft_subject}", subject_en: "{draft.draft_subject}", fallback: "{draft.draft_body}", fallback_en: "{draft.draft_body}" }),
    n("end-incomplete", "end", 20, 650),
    n("human", "human_task", 480, 430, { instruction: "Inhaltlich prüfen und entscheiden.", instruction_en: "Review the content and decide." }),
    n("end-info", "end", 300, 620),
    n("notify-no", "send_notification", 560, 620, { to: "student", template: "msg-rejected", params: '{"explanation":"{human.decision_note}"}' }),
    n("end-no", "end", 560, 780),
    n("case", "connector", 820, 520, { system: "payment", action: "create_payment_order" }),
    n("notify-ok", "send_notification", 820, 640, { to: "student", template: "msg-approved", params: '{"explanation":"{human.decision_note}"}' }),
    n("end-ok", "end", 820, 800),
    n("ask-q", "request_documents", -200, 330, { sending: "caseworker", template: "msg-question", params: '{"unclear":"{review.review_list}","details":"{review.review_details}"}' }),
    n("wait-q", "wait", -200, 450, { days: 7 }),
    n("remind", "send_notification", -200, 560, { to: "student", template: "msg-reminder", params: '{"pending":"{review.review_list}"}' }),
    n("end-review", "end", -200, 690),
  ];
  const edges: FlowEdge[] = [
    e("start", "out", "assign"), e("assign", "out", "read"), e("read", "clear", "inputs"), e("read", "review", "review"),
    e("review", "confirmed", "inputs"), e("review", "info", "ask-q"), e("ask-q", "out", "wait-q"), e("wait-q", "out", "remind"), e("remind", "out", "end-review"),
    e("inputs", "complete", "rules"), e("inputs", "incomplete", "draft"),
    e("rules", "incomplete", "draft"), e("draft", "out", "ask"), e("ask", "out", "end-incomplete"),
    e("rules", "complete", "human"),
    e("human", "approved", "case"), e("case", "out", "notify-ok"), e("notify-ok", "out", "end-ok"),
    e("human", "rejected", "notify-no"), e("notify-no", "out", "end-no"),
    e("human", "info", "end-info"),
  ];
  return {
    id: "bafoeg-ausland", catalogId: "bafoeg.abroad", name: "Abroad BAföG: standard process", version: 1, updatedAt: now, updatedBy: "Abroad unit (sample)",
    owner: "Frau Lindner", inputs: defaultInputs(), nodes, edges, tests: STANDARD_TESTS.map((t) => ({ ...t, expect: { ...t.expect, visits: [...t.expect.visits] } })),
  };
}

/**
 * The reference model of the catalogue entry "BAföG, abroad application": what the oversight body considers the shared target.
 * Offices are compared against it. It is read-only in the prototype.
 */
export function referenceProcess(): ProcessDef {
  const base = defaultProcess("2026-06-01T09:00:00.000Z");
  const nodes: FlowNode[] = base.nodes.map((x) => ({ ...x, config: { ...x.config } }));
  const edges: FlowEdge[] = base.edges.map((x) => ({ ...x }));
  const n = (id: string, kind: NodeKind, x: number, y: number, config: Record<string, ConfigValue> = {}, name?: string): FlowNode => ({ id, kind, name, position: { x, y }, config: defaultConfig(kind, config) });
  // After the payment, the case is archived and the status is reported to the portal.
  const notifyOk = edges.find((e) => e.source === "notify-ok")!;
  nodes.push(n("portal", "connector", 820, 690, { system: "portal", action: "send_status" }, "Report status to the portal"), n("archive", "connector", 820, 800, { system: "efile", action: "archive_case" }, "Archive the case"));
  notifyOk.target = "portal";
  edges.push({ id: "portal:out", source: "portal", sourceHandle: "out", target: "archive" }, { id: "archive:out", source: "archive", sourceHandle: "out", target: "end-ok" });
  nodes.find((x) => x.id === "end-ok")!.position = { x: 820, y: 920 };
  return { ...base, id: "bafoeg-abroad-reference", name: "Reference model: BAföG abroad (application)", version: 1, nodes, edges, updatedBy: "Federal oversight (sample)" };
}

// ---- Upgrading stored processes --------------------------------------------------------

/** A name for a step that does not have one: what it is, numbered if the same kind appears again. */
export function uniqueStepName(base: string, taken: string[]): string {
  const lower = new Set(taken.map((x) => x.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let i = 2; ; i++) if (!lower.has(`${base} ${i}`.toLowerCase())) return `${base} ${i}`;
}

/** Older texts referred to an output by its plain name. Now they refer to the step: {open_items} becomes {rules.open_items}. */
export function upgradeTokens(def: ProcessDef): ProcessDef {
  const globals = new Set(GLOBAL_PLACEHOLDERS.map((g) => g.name));
  let changed = false;
  const nodes = def.nodes.map((n) => {
    let config = n.config;
    for (const k of TOKEN_KEYS) {
      const v = config[k];
      if (typeof v !== "string" || !v.includes("{")) continue;
      const up = upstreamOutputs(def, n.id);
      const next = v.replace(TOKEN_RE, (whole, a: string, b: string | undefined, fmt: string | undefined) => {
        if (b || globals.has(a) || !ALL_OUTPUT_NAMES.has(a)) return whole;
        const src = up.find((x) => x.output.name === a);
        return src ? `{${src.nodeId}.${a}${fmt ? `:${fmt}` : ""}}` : whole;
      });
      if (next !== v) {
        config = { ...config, [k]: next };
        changed = true;
      }
    }
    return config === n.config ? n : { ...n, config };
  });
  return changed ? { ...def, nodes } : def;
}

/** Brings the standard process of an older copy up to date: its own step for the required inputs, texts that name their source, templates, a real reminder, step names and samples. */
export function upgradeSteps(def: ProcessDef): ProcessDef {
  let nodes = def.nodes.map((n) => ({ ...n, config: { ...n.config } }));
  let edges = def.edges.map((e) => ({ ...e }));
  const byId = (id: string) => nodes.find((n) => n.id === id);
  const standard = def.id === "bafoeg-ausland";

  // The required inputs are checked by a step of their own.
  const rules = byId("rules");
  if (rules?.kind === "run_rules" && rules.config.withInputs === undefined && !nodes.some((n) => n.kind === "check_inputs") && edges.some((e) => e.id === "rules:incomplete")) {
    const incompleteTarget = edges.find((e) => e.id === "rules:incomplete")!.target;
    rules.config.withInputs = "no";
    edges = edges.map((e) => (e.target === "rules" ? { ...e, target: "inputs" } : e)).concat(
      { id: "inputs:complete", source: "inputs", sourceHandle: "complete", target: "rules" },
      { id: "inputs:incomplete", source: "inputs", sourceHandle: "incomplete", target: incompleteTarget },
    );
    nodes.push({ id: "inputs", kind: "check_inputs", position: { x: rules.position.x, y: rules.position.y - 100 }, config: {} });
  }

  // The e-mail about what is missing says where its text comes from, instead of silently taking the AI draft.
  const ask = byId("ask");
  if (ask?.kind === "request_documents" && ask.config.use_draft === undefined && edges.some((e) => e.source === "draft" && e.target === "ask")) {
    Object.assign(ask.config, { use_draft: "no", subject: "{draft.draft_subject}", subject_en: "{draft.draft_subject}", fallback: "{draft.draft_body}", fallback_en: "{draft.draft_body}" });
  }
  // The question and the decision messages use the approved templates.
  const askQ = byId("ask-q");
  if (askQ?.kind === "request_documents" && askQ.config.template === undefined && edges.some((e) => e.source === "review" && e.sourceHandle === "info" && e.target === "ask-q")) {
    Object.assign(askQ.config, { template: "msg-question", params: '{"unclear":"{review.review_list}","details":"{review.review_details}"}' });
  }
  for (const [id, template] of [["notify-ok", "msg-approved"], ["notify-no", "msg-rejected"]] as const) {
    const m = byId(id);
    if (standard && m?.kind === "send_notification" && m.config.template === undefined) Object.assign(m.config, { template, params: '{"explanation":"{human.decision_note}"}' });
  }
  // The wait is a real timer, and a reminder goes out when it runs out.
  const waitQ = byId("wait-q");
  const waitOut = edges.find((e) => e.id === "wait-q:out");
  if (waitQ?.kind === "wait" && waitOut && byId(waitOut.target)?.kind === "end" && !byId("remind") && standard) {
    nodes.push({ id: "remind", kind: "send_notification", position: { x: waitQ.position.x, y: waitQ.position.y + 110 }, config: defaultConfig("send_notification", { to: "student", template: "msg-reminder", params: '{"pending":"{review.review_list}"}' }) });
    edges = edges.map((e) => (e.id === "wait-q:out" ? { ...e, target: "remind" } : e)).concat({ id: "remind:out", source: "remind", sourceHandle: "out", target: waitOut.target });
  }
  // Every step has a name and a purpose.
  const taken: string[] = nodes.map((n) => n.name?.trim() ?? "").filter(Boolean);
  nodes = nodes.map((n) => {
    const std = standard ? STANDARD_STEPS[n.id] : undefined;
    if (n.name?.trim()) return { ...n, purpose: n.purpose ?? std?.purpose };
    const name = uniqueStepName(std?.name ?? NODE_CATALOG[n.kind].title.en, taken);
    taken.push(name);
    return { ...n, name, purpose: n.purpose ?? std?.purpose };
  });
  return {
    ...def,
    nodes,
    edges,
    ...(standard ? { owner: def.owner ?? "Frau Lindner", tests: def.tests ?? STANDARD_TESTS.map((t) => ({ ...t, expect: { ...t.expect, visits: [...t.expect.visits] } })) } : {}),
  };
}

/** Everything that brings a stored process up to the current shape. */
export const upgradeProcess = (def: ProcessDef): ProcessDef => upgradeTokens(upgradeSteps(upgradeOutputs(upgradeEnglish(upgradeAssignment(upgradeQuestionPath(def))))));

// ---- What changed, and what a process depends on --------------------------------------------

export interface ProcessChange {
  kind: "added" | "removed" | "changed";
  text: string;
}

const stepLabel = (d: Pick<ProcessDef, "nodes">, id: string) => d.nodes.find((n) => n.id === id)?.name ?? d.nodes.find((n) => n.id === id)?.kind ?? id;

/** What differs between the live version and a new one, in words a person can read before publishing. */
export function diffProcess(before: ProcessDef | null, after: ProcessDef): ProcessChange[] {
  if (!before) return [{ kind: "added", text: `First version with ${after.nodes.length} steps` }];
  const out: ProcessChange[] = [];
  const old = new Map(before.nodes.map((n) => [n.id, n]));
  const cur = new Map(after.nodes.map((n) => [n.id, n]));
  for (const n of after.nodes) if (!old.has(n.id)) out.push({ kind: "added", text: `Step “${stepLabel(after, n.id)}” added` });
  for (const n of before.nodes) if (!cur.has(n.id)) out.push({ kind: "removed", text: `Step “${stepLabel(before, n.id)}” removed` });
  for (const n of after.nodes) {
    const o = old.get(n.id);
    if (!o) continue;
    if ((o.name ?? "") !== (n.name ?? "")) out.push({ kind: "changed", text: `Step “${o.name ?? o.kind}” renamed to “${n.name ?? n.kind}”` });
    const keys = [...new Set([...Object.keys(o.config), ...Object.keys(n.config)])].filter((k) => String(o.config[k] ?? "") !== String(n.config[k] ?? ""));
    for (const k of keys) {
      if (k === "rules") {
        const a = String(o.config.rules ?? "").split(",").filter(Boolean);
        const b = String(n.config.rules ?? "").split(",").filter(Boolean);
        const added = b.filter((x) => !a.includes(x));
        const removed = a.filter((x) => !b.includes(x));
        out.push({ kind: "changed", text: `“${n.name}”: rules ${added.length ? `+${added.length} (${added.join(", ")})` : ""}${added.length && removed.length ? " " : ""}${removed.length ? `−${removed.length} (${removed.join(", ")})` : ""}`.trim() });
      } else if (["subject", "body", "fallback", "instruction", "subject_en", "body_en", "fallback_en", "instruction_en"].includes(k)) out.push({ kind: "changed", text: `“${n.name}”: text “${k}” changed` });
      else out.push({ kind: "changed", text: `“${n.name}”: ${k} ${String(o.config[k] ?? "–")} → ${String(n.config[k] ?? "–")}` });
    }
  }
  const edgeKey = (d: ProcessDef, e: FlowEdge) => `${stepLabel(d, e.source)} (${e.sourceHandle}) → ${stepLabel(d, e.target)}`;
  const oldEdges = new Map(before.edges.map((e) => [`${e.source}:${e.sourceHandle}`, e]));
  const newEdges = new Map(after.edges.map((e) => [`${e.source}:${e.sourceHandle}`, e]));
  for (const [k, e] of newEdges) {
    const o = oldEdges.get(k);
    if (!o) out.push({ kind: "added", text: `Connection ${edgeKey(after, e)}` });
    else if (o.target !== e.target) out.push({ kind: "changed", text: `Connection from ${stepLabel(after, e.source)} (${e.sourceHandle}) now goes to ${stepLabel(after, e.target)} instead of ${stepLabel(before, o.target)}` });
  }
  for (const [k, e] of oldEdges) if (!newEdges.has(k)) out.push({ kind: "removed", text: `Connection ${edgeKey(before, e)}` });
  const oi = new Map(before.inputs.map((i) => [i.id, i]));
  const ni = new Map(after.inputs.map((i) => [i.id, i]));
  for (const [id, i] of ni) if (!oi.has(id)) out.push({ kind: "added", text: `Required input “${i.ref}”` });
  for (const [id, i] of oi) if (!ni.has(id)) out.push({ kind: "removed", text: `Required input “${i.ref}”` });
  for (const [id, i] of ni) if (oi.has(id) && oi.get(id)!.required !== i.required) out.push({ kind: "changed", text: `Input “${i.ref}” is now ${i.required ? "required" : "optional"}` });
  if ((before.owner ?? "") !== (after.owner ?? "")) out.push({ kind: "changed", text: `Owner: ${before.owner ?? "–"} → ${after.owner ?? "–"}` });
  const bt = before.tests?.length ?? 0;
  const at = after.tests?.length ?? 0;
  if (bt !== at) out.push({ kind: "changed", text: `Test cases: ${bt} → ${at}` });
  return out;
}

/** What a process uses: the rules it applies, the message templates, the forms it requires and the systems it calls. */
export function processDependencies(def: ProcessDef): { rules: string[] | null; messages: string[]; documents: string[]; systems: string[] } {
  const messages = [...new Set(def.nodes.map((n) => String(n.config.template ?? "")).filter(Boolean))];
  const systems = [...new Set(def.nodes.filter((n) => n.kind === "connector").map((n) => String(n.config.system ?? "")).filter(Boolean))];
  return { rules: processRuleIds(def), messages, documents: def.inputs.filter((i) => i.type === "document").map((i) => i.ref), systems };
}
