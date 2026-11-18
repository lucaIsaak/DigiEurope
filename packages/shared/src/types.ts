export type Lang = "de" | "en";
export interface Bilingual {
  de: string;
  en: string;
}

export type StayType = "study" | "internship";

export type CoreDocumentKind =
  | "application_form"
  | "fb06"
  | "fb08"
  | "enrollment_cert"
  | "host_confirmation"
  | "internship_contract"
  | "internship_uni_confirmation"
  | "health_insurance"
  | "tuition_waiver_proof"
  | "parent_form"
  | "parent_tax"
  | "decision_letter"
  | "unknown";

/** Core kinds are known to the code; accepted template proposals add more ids, so any string is allowed. */
export type DocumentKind = CoreDocumentKind | (string & {});

export const DOCUMENT_KINDS: CoreDocumentKind[] = [
  "application_form",
  "fb06",
  "fb08",
  "enrollment_cert",
  "host_confirmation",
  "internship_contract",
  "internship_uni_confirmation",
  "health_insurance",
  "tuition_waiver_proof",
  "parent_form",
  "parent_tax",
  "decision_letter",
];

/** Fields the "reader" found in a document. Signatures are kept apart as booleans. */
export type ExtractionMethod = "builtin" | "ai" | "ocr_rules" | "external";

export interface Extraction {
  readable: boolean;
  fields: Record<string, string>;
  signatures: Record<string, boolean>;
  /** Confidence per field, 0 to 1. Missing means "not reported". */
  confidence?: Record<string, number>;
  /** Page each field was read from (1-based). */
  pages?: Record<string, number>;
  /** Which reader produced this, for example "builtin" or "ai". */
  engine?: string;
  /** True when at least one field is below the office's confidence threshold and a person should check it. */
  needsReview?: boolean;
  /** Plain note, for example that a connector was not connected and the built-in reader was used. */
  note?: string;
}

export interface DocumentRef {
  id: string;
  kind: DocumentKind;
  filename: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  uploadedBy: "student" | "parent" | "portal";
  extraction: Extraction;
}

export type CaseStatus = "draft" | "submitted" | "in_review" | "info_requested" | "approved" | "rejected";

export interface StudentInfo {
  firstName: string;
  lastName: string;
  birthDate: string;
  email: string;
  university: string;
  course: string;
}

export interface StayInfo {
  type: StayType;
  country: string; // ISO 3166-1 alpha-2
  city: string;
  institution: string;
  startDate: string; // ISO date
  endDate: string;
  tuitionFees: number; // EUR for the whole stay, 0 if none
}

export interface ParentInfo {
  status: "not_requested" | "requested" | "received";
  email: string;
  married: boolean | null;
  siblingsInEducation: number;
}

export interface HistoryEntry {
  at: string;
  kind: "created" | "submitted" | "opened" | "info_requested" | "approved" | "rejected" | "parent_invited" | "parent_uploaded" | "checked" | "note" | "assigned";
  text?: string;
}

export interface Decision {
  outcome: "approved" | "rejected";
  monthlyAmount: number;
  /** The human explanation for the student, written (or confirmed) by the caseworker. */
  note: string;
  decidedAt: string;
  decidedBy: string;
  /** Frozen technical record of what the decision was based on, for audits. */
  audit?: AuditRecord;
}

/** Everything a decision rested on, frozen at the moment of the decision. */
export interface AuditRecord {
  recordedAt: string;
  decidedBy: string;
  outcome: "approved" | "rejected";
  monthlyAmount: number;
  process: { id: string; name: string; version: number } | null;
  processSteps: { at: string; step: string; handle?: string; note: string }[];
  rules: { id: string; version: number; title: Bilingual; result: "pass" | "fail" | "n/a"; severity: Severity; approvedBy?: string; source: string }[];
  inputs: { ref: string; label: Bilingual; required: boolean; applies: boolean; state: "ok" | "missing" }[];
  documents: { kind: string; filename: string; uploadedAt: string; uploadedBy: string; engine: string; lowestConfidence: number | null; flaggedForReview: boolean; note?: string }[];
  calculation: EstimateExplanation;
  sources: { label: string; url: string }[];
}

export interface EstimateExplanation {
  parts: { key: string; amount: number }[];
  need: number;
  parentsKnown: boolean;
  sumOfIncome: number | null;
  incomeTax: number | null;
  deductionPercent: number;
  netMonthly: number | null;
  married: boolean | null;
  siblings: number;
  allowance: number;
  excess: number;
  countablePercent: number;
  divisor: number;
  contribution: number;
  /** Need minus contribution, before rounding. */
  grantExact: number;
  /** Rounded to 10 €, as in the estimate. */
  grant: number;
  oneOff: { travel: number; tuition: number };
}

export interface Application {
  id: string;
  reference: string;
  status: CaseStatus;
  language: Lang;
  source: "web" | "portal";
  createdAt: string;
  submittedAt?: string;
  updatedAt: string;
  student: StudentInfo;
  stay: StayInfo;
  parents: ParentInfo;
  documents: DocumentRef[];
  history: HistoryEntry[];
  /** Rule ids that failed the first time the case was checked after documents arrived. Feeds the office insights. */
  firstFindings: string[];
  officeMessage?: string;
  decision?: Decision;
  /** Messages sent by the process. Students see those addressed to them. */
  outbox?: Mail[];
  /** Calls to connected systems made by the process. */
  integrations?: IntegrationEntry[];
  assignedTeam?: string;
  /** The caseworker responsible for this case. */
  assignedTo?: { id: string; name: string; via: "range" | "substitute" | "fallback" | "manual"; at: string };
  /** State of the process that handles this case. */
  flow?: FlowState;
  /** Answers to the custom questions of the process, by question id. */
  info?: Record<string, string>;
}

export interface Mail {
  id: string;
  to: "student" | "parents" | "office";
  subject: string;
  body: string;
  at: string;
  /** True when the text was drafted by AI. */
  aiDraft: boolean;
  nodeId: string;
}

export interface IntegrationEntry {
  at: string;
  nodeId: string;
  system: string;
  action: string;
  request: Record<string, unknown>;
  response: Record<string, unknown>;
}

export interface RunLogEntry {
  at: string;
  nodeId: string;
  kind: string;
  handle?: string;
  note: string;
  /** What the step produced, by output name: the data it handed on. */
  outputs?: Record<string, string>;
}

export interface FlowState {
  processId: string;
  version: number;
  startedAt: string;
  log: RunLogEntry[];
  /** Node a person has to act on. */
  waiting?: string;
  finished: boolean;
  /** What earlier steps produced, by name, so later steps in the same branch can use it in their texts. */
  vars?: Record<string, string>;
  /** The note of the step a person has to act on, with the outputs of earlier steps filled in. */
  briefing?: string;
  /** The process stopped because something went wrong. The case needs attention; nothing continues by itself. */
  failed?: boolean;
  error?: { nodeId: string; message: string; at: string };
  /** When a timer step lets the process carry on. */
  waitUntil?: string;
}

// ---- Rules -------------------------------------------------------------

export type Operand = string | number | boolean | null | { ref: string };

export type Check =
  | { all: Check[] }
  | { any: Check[] }
  | { not: Check }
  | { eq: [Operand, Operand] }
  | { gte: [Operand, Operand] }
  | { lte: [Operand, Operand] }
  | { in: [Operand, Operand[]] }
  | { truthy: Operand };

export type Severity = "blocker" | "warning";

export interface RuleTest {
  name: string;
  /** Facts are merged over a baseline "all good" fact set. */
  facts: Record<string, unknown>;
  expectPass: boolean;
}

export interface Rule {
  id: string;
  version: number;
  scope: "federal" | "office";
  title: Bilingual;
  /** The rule as the office wrote it, in plain language. */
  plain: Bilingual;
  source: { label: string; url: string };
  /** Executable form. Only runs once approved. */
  when?: Check;
  pass: Check;
  severity: Severity;
  /** What the applicant sees if the check fails. {path} placeholders are filled from facts. */
  fix: Bilingual;
  /** Where on the application it belongs. */
  documentKind?: DocumentKind;
  tests: RuleTest[];
  /** Suggested change to the application form when this is missing often. */
  recommendation?: Bilingual;
  /** True for the "rule drafted by AI" demo state. */
  draftedByAi?: boolean;
}

export interface RuleState {
  status: "draft" | "approved";
  approvedBy?: string;
  approvedAt?: string;
}

export interface Finding {
  ruleId: string;
  severity: Severity;
  documentKind?: DocumentKind;
  title: Bilingual;
  fix: Bilingual;
  source: { label: string; url: string };
}

export interface Requirement {
  id: string;
  type: "document" | "info";
  ref: string;
  label: Bilingual;
  required: boolean;
  /** False when the condition of the input is not met for this application. */
  applies: boolean;
  state: "ok" | "missing";
  providedBy: "student" | "parents" | "office" | "third_party";
  /** For custom questions. */
  question?: { type: FieldType; help?: Bilingual };
}

export interface CheckReport {
  requirements?: Requirement[];
  ready: boolean;
  blockers: number;
  warnings: number;
  findings: Finding[];
  passed: { ruleId: string; title: Bilingual }[];
}

// ---- Estimate ------------------------------------------------------------

export interface Estimate {
  provisional: boolean;
  months: number;
  need: number;
  /** Likely monthly grant, rounded to 10. Never a decision. */
  monthly: number;
  low: number;
  high: number;
  parts: { key: string; amount: number }[];
  parentContribution: number;
  oneOff: { travel: number; tuition: number };
  /** Message keys, translated in the UI. */
  notes: string[];
}

export interface CaseView extends Application {
  /** Names of templates accepted from proposals, so custom forms have a readable label everywhere. */
  templateNames?: Record<string, Bilingual>;
  report: CheckReport;
  estimate: Estimate;
  parentLink?: string;
}

/** An employee of the office. Admins can unlock the process builder for others. */
export interface StaffMember {
  id: string;
  name: string;
  title: string;
  isAdmin: boolean;
  canBuild: boolean;
  /** Oversight (for example a federal body) sees and compares all offices, but works in no office. */
  isOversight?: boolean;
  /** Takes cases: can be picked in the case assignment. */
  isCaseworker?: boolean;
  /** May accept template proposals and decide how a template is extracted. */
  canApproveTemplates?: boolean;
}

export type FieldType = "text" | "number" | "date" | "yesno";

export interface TemplateField {
  key: string;
  label: string;
  type: FieldType;
  required: boolean;
}

export interface TemplateSignature {
  key: string;
  label: string;
}

/** A form or document the office knows how to read. */
export type TemplateCategory = "official_form" | "study" | "work" | "money" | "insurance" | "office";

export interface DocumentTemplate {
  /** Groups templates for people: official forms, study, work, money, insurance, office documents. */
  category: TemplateCategory;
  /** The document kind. Core templates keep their historic ids, accepted proposals get "tpl-…". */
  id: string;
  /** For example "Formblatt 6". */
  formblatt?: string;
  name: Bilingual;
  /** The title as printed on the document. The reader recognises the template by it. */
  title: string;
  purpose: Bilingual;
  providedBy: "student" | "parents" | "office" | "third_party";
  fields: TemplateField[];
  signatures: TemplateSignature[];
  source: "builtin" | "accepted";
  /** The same document in English: the printed title and the labels by field key. The reader recognises both. */
  en?: { title: string; fields: Record<string, string>; signatures: Record<string, string> };
}

export type ProposalStatus = "draft" | "submitted" | "accepted" | "rejected";

/** A process designer's proposal for a new template. The extractor owner accepts it, so nobody has to build it from scratch. */
export interface TemplateProposal {
  id: string;
  status: ProposalStatus;
  proposedBy: string;
  proposedAt: string;
  formblatt?: string;
  name: string;
  title: string;
  purpose: string;
  providedBy: DocumentTemplate["providedBy"];
  category: TemplateCategory;
  fields: TemplateField[];
  signatures: TemplateSignature[];
  /** Name of the sample document the suggestion came from. */
  sampleFilename?: string;
  decidedBy?: string;
  decidedAt?: string;
  decisionNote?: string;
  /** Template created from this proposal. */
  templateId?: string;
}
