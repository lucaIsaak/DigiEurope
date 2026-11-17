export type Lang = "de" | "en";
export interface Bilingual {
  de: string;
  en: string;
}

export type StayType = "study" | "internship";

export type DocumentKind =
  | "application_form"
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

export const DOCUMENT_KINDS: DocumentKind[] = [
  "application_form",
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
export interface Extraction {
  readable: boolean;
  fields: Record<string, string>;
  signatures: Record<string, boolean>;
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
  kind: "created" | "submitted" | "opened" | "info_requested" | "approved" | "rejected" | "parent_invited" | "parent_uploaded" | "checked" | "note";
  text?: string;
}

export interface Decision {
  outcome: "approved" | "rejected";
  monthlyAmount: number;
  note: string;
  decidedAt: string;
  decidedBy: string;
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
  /** State of the process that handles this case. */
  flow?: FlowState;
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
}

export interface FlowState {
  processId: string;
  version: number;
  startedAt: string;
  log: RunLogEntry[];
  /** Node a person has to act on. */
  waiting?: string;
  finished: boolean;
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

export interface CheckReport {
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
}
