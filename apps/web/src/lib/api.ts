import type { Condition, Application, CaseView, DocumentTemplate, FieldType, TemplateField, TemplateProposal, CatalogNode, CatalogVariant, Harmony, OfficeAssignment, OfficeSettings, ProcessDef, GeneratedProcess, NodeSuggestion, StaffMember, RunLogEntry, Mail, IntegrationEntry, ProcessIssue, DocumentKind, Extraction, LetterFields, Lang, Rule, RuleState, StayInfo, StudentInfo } from "@digieurope/shared";

export class ApiError extends Error {
  issues?: ProcessIssue[];
  /** The sample cases of a process that failed, when publishing was refused because of them. */
  tests?: ProcessTestResult[];
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const token = typeof window !== "undefined" ? (sessionStorage.getItem("ms.staffToken") ?? undefined) : undefined;
  const res = await fetch(`/api${path}`, {
    ...rest,
    headers: { ...(json !== undefined ? { "Content-Type": "application/json" } : {}), ...(token ? { "x-staff-token": token } : {}) },
    body: json !== undefined ? JSON.stringify(json) : undefined,
    cache: "no-store",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string; issues?: ProcessIssue[] };
    if (res.status === 401 && path.startsWith("/office") && typeof window !== "undefined") {
      sessionStorage.removeItem("ms.staffToken");
      window.location.href = "/office/login";
    }
    const err = new ApiError(body.error ?? res.statusText, res.status);
    err.issues = (body as { issues?: ProcessIssue[] }).issues;
    err.tests = (body as { tests?: ProcessTestResult[] }).tests;
    throw err;
  }
  return res.json() as Promise<T>;
}

export function fileToBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

const filePayload = async (file: File) => ({ filename: file.name, mimeType: file.type || "application/pdf", dataBase64: await fileToBase64(file) });

export interface AssignmentView {
  assignment: OfficeAssignment;
  caseworkers: { id: string; name: string; title: string }[];
  staff: { id: string; name: string }[];
  problems: { invalid: string[]; overlaps: string[]; gaps: string[] };
}

export interface CaseSummary {
  id: string;
  reference: string;
  name: string;
  country: string;
  stayType: "study" | "internship";
  status: Application["status"];
  source: "web" | "portal";
  submittedAt: string | null;
  updatedAt: string;
  blockers: number;
  warnings: number;
  estimateMonthly: number;
  assignedTo: { id: string; name: string } | null;
  /** The process stopped with an error: the case needs attention. */
  failed: boolean;
  problem: string | null;
  team: string | null;
  waitingAt: string | null;
  /** Required documents that are in, and how many are required. */
  docsDone: number;
  docsTotal: number;
}

export interface ParentView {
  studentName: string;
  status: string;
  incomeYear: number;
  documents: { id: string; kind: DocumentKind; filename: string; readable: boolean; signed?: boolean; taxYear?: string }[];
}

export interface AssistantAnswer {
  answer: string;
  sources: { label: string; url: string }[];
  mode: "retrieval" | "live";
  matched: boolean;
}

export interface Insights {
  total: number;
  open: number;
  byStatus: Record<string, number>;
  firstTimeComplete: number;
  medianDaysToDecision: number | null;
  perWeek: { week: string; count: number }[];
  missing: { ruleId: string; title: { de: string; en: string }; count: number; share: number; recommendation?: { de: string; en: string }; documentKind?: string }[];
}

export interface TestOutcomeView {
  name: string;
  expectPass: boolean;
  actualPass: boolean;
  ok: boolean;
}

export interface RuleVersionView {
  rule: Rule;
  author: string;
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
  tests?: TestOutcomeView[];
}

export interface RuleEntry {
  id: string;
  title: { de: string; en: string };
  scope: "federal" | "office";
  status: "live" | "draft" | "changed" | "paused";
  paused: boolean;
  live: RuleVersionView | null;
  draft: RuleVersionView | null;
  history: RuleVersionView[];
  /** The processes whose "Run approved rules" step applies this rule. */
  usedIn: { catalogId: string; name: string }[];
}

export interface RuleDraftBody {
  title: { de: string; en: string };
  plain: { de: string; en: string };
  fix: { de: string; en: string };
  severity: "blocker" | "warning";
  when: Condition[];
  pass: Condition[];
  tests: { name: string; expectPass: boolean }[];
}

export interface Todo {
  rulesToApprove: number;
  myRuleDrafts: number;
  proposalsToDecide: number;
  myProposals: number;
  templatesToCheck: number;
  processDrafts: number;
}

export interface OfficeConfigResponse {
  config: {
    name: string;
    languages: Lang[];
    acceptedFileTypes: string[];
    slaDays: number;
    workflow: string[];
    expectedInputs: Partial<Record<DocumentKind, { fields: string[]; confirmedAt?: string }>>;
  };
  documentTypes: { kind: DocumentKind; title: string; fields: { key: string; label: string }[]; signatures: { key: string; label: string }[] }[];
}

export interface LibraryTemplate extends DocumentTemplate {
  extraction: { method: MethodInfo["id"]; minConfidence: number };
  check: { confirmedAt: string; confirmedBy: string } | null;
  usedIn: { catalogId: string; name: string }[];
  log: { at: string; by: string; text: string }[];
}

export interface TemplateLibrary {
  templates: LibraryTemplate[];
  proposals: TemplateProposal[];
  canApprove: boolean;
  canPropose: boolean;
}

export interface TemplateSuggestion {
  title: string;
  fields: TemplateField[];
  signatures: { key: string; label: string }[];
  sampleFilename: string;
}

export interface ProposalBody {
  name: string;
  formblatt?: string;
  title: string;
  purpose: string;
  providedBy: DocumentTemplate["providedBy"];
  category: DocumentTemplate["category"];
  fields: TemplateField[];
  signatures: { key: string; label: string }[];
  sampleFilename?: string;
  submit?: boolean;
}

export type { FieldType };

export interface MethodInfo {
  id: "builtin" | "ai" | "ocr_rules" | "external";
  name: { de: string; en: string };
  description: { de: string; en: string };
  status: "connected" | "simulated" | "placeholder";
}

export interface ExtractionSettings {
  methods: MethodInfo[];
  config: { defaultMethod: MethodInfo["id"]; byType: Partial<Record<DocumentKind, { method: MethodInfo["id"]; minConfidence: number }>> };
  defaultMinConfidence: number;
  aiKey: boolean;
}

export interface SampleFile {
  name: string;
  kind: string;
  audience: "student" | "parents";
}

export interface SampleList {
  sets: { id: string; title: { de: string; en: string }; note: { de: string; en: string }; docs: SampleFile[]; fixes: SampleFile[]; extras: SampleFile[] }[];
  letter: string;
  proposal: string;
}

export interface OfficeMetrics {
  medianDaysToDecision: number | null;
  firstTimeComplete: number | null;
  reviewShare: number | null;
  documentRounds: number | null;
  casesPerMonth: number | null;
}

export interface CompareOffice {
  id: string;
  name: string;
  city: string;
  live: boolean;
  def: ProcessDef;
  settings: OfficeSettings;
  metrics: OfficeMetrics;
  harmony: Harmony | null;
}

export interface CompareResult {
  category: string;
  variant?: CatalogVariant;
  reference: { def: ProcessDef; settings: OfficeSettings } | null;
  offices: CompareOffice[];
}

export interface ProcessTestResult {
  id: string;
  name: string;
  ok: boolean;
  failures: string[];
}

export interface ProcessImpact {
  changes: { kind: "added" | "removed" | "changed"; text: string }[];
  liveVersion: number | null;
  dependencies: { rules: string; messages: string[]; documents: string[]; systems: string[] };
}

export interface MessageVersionView {
  tpl: { id: string; name: string; purpose: string; subject: { de: string; en: string }; body: { de: string; en: string }; version: number };
  author: string;
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
}

export interface MessageEntry {
  id: string;
  name: string;
  purpose: string;
  status: "live" | "draft" | "changed";
  params: string[];
  live: MessageVersionView | null;
  draft: MessageVersionView | null;
  history: MessageVersionView[];
  usedIn: { catalogId: string; name: string }[];
}

export interface MessageBody {
  name: string;
  purpose: string;
  subject: { de: string; en: string };
  body: { de: string; en: string };
}

export interface ConnectionView {
  system: string;
  name: { de: string; en: string };
  enabled: boolean;
  mode: "sandbox" | "live";
  lastTest?: { at: string; by: string; ok: boolean };
  actions: { id: string; label: { de: string; en: string } }[];
  usedIn: { catalogId: string; name: string }[];
  owner: string;
}

export interface TestRunResult {
  log: RunLogEntry[];
  status: string;
  waiting: string | null;
  finished: boolean;
  failed?: boolean;
  error?: { nodeId: string; message: string; at: string } | null;
  assignedTo?: string | null;
  mails: Mail[];
  integrations: IntegrationEntry[];
  team: string | null;
}

export const api = {
  meta: () => call<{ office: string; liveAssistant: boolean }>("/meta"),
  create: (body: { student: StudentInfo; stay: StayInfo; language: Lang }) => call<CaseView>("/applications", { method: "POST", json: body }),
  get: (id: string) => call<CaseView>(`/applications/${id}`),
  upload: async (id: string, file: File) => call<CaseView>(`/applications/${id}/documents`, { method: "POST", json: await filePayload(file) }),
  removeDocument: (id: string, docId: string) => call<CaseView>(`/applications/${id}/documents/${docId}`, { method: "DELETE" }),
  check: (id: string) => call<CaseView>(`/applications/${id}/check`, { method: "POST" }),
  inviteParents: (id: string, email: string) => call<CaseView>(`/applications/${id}/parents`, { method: "POST", json: { email } }),
  submit: (id: string) => call<CaseView>(`/applications/${id}/submit`, { method: "POST" }),
  lookup: (reference: string, birthDate: string) => call<{ id: string }>(`/status/lookup?reference=${encodeURIComponent(reference)}&birthDate=${encodeURIComponent(birthDate)}`),

  parent: (token: string) => call<ParentView>(`/parent/${token}`),
  parentUpload: async (token: string, file: File) => call<ParentView>(`/parent/${token}/documents`, { method: "POST", json: await filePayload(file) }),

  ask: (question: string, lang: Lang, live: boolean) => call<AssistantAnswer>("/assistant", { method: "POST", json: { question, lang, live } }),
  readLetter: async (file: File) => call<LetterFields>("/letter/read", { method: "POST", json: await filePayload(file) }),

  queue: () => call<CaseSummary[]>("/office/cases"),
  officeCase: (id: string) => call<CaseView>(`/office/cases/${id}`),
  openCase: (id: string) => call<CaseView>(`/office/cases/${id}/open`, { method: "POST" }),
  act: (id: string, action: "request_info" | "approve" | "reject", body: { message?: string; amount?: number }) =>
    call<CaseView>(`/office/cases/${id}/actions`, { method: "POST", json: { action, ...body } }),
  questionDraft: (id: string) => call<{ subject: string; message: string; items: number }>(`/office/cases/${id}/question-draft`),
  assignment: () => call<AssignmentView>("/office/assignment"),
  saveAssignment: (assignment: OfficeAssignment) => call<{ assignment: OfficeAssignment }>("/office/assignment", { method: "PUT", json: { assignment } }),
  assignCase: (id: string, staffId: string) => call<CaseView>(`/office/cases/${id}/assign`, { method: "POST", json: { staffId } }),
  explanation: (id: string, outcome: "approved" | "rejected", amount: number, lang?: Lang) =>
    call<{ text: string }>(`/office/cases/${id}/explanation?outcome=${outcome}&amount=${amount}${lang ? `&lang=${lang}` : ""}`),
  auditRecord: async (id: string) => {
    const token = sessionStorage.getItem("ms.staffToken") ?? "";
    const res = await fetch(`/api/office/cases/${id}/audit`, { headers: { "x-staff-token": token }, cache: "no-store" });
    if (!res.ok) throw new ApiError(res.statusText, res.status);
    return res.blob();
  },
  deliver: () => call<CaseSummary>("/office/portal/deliver", { method: "POST" }),
  insights: () => call<Insights>("/office/insights"),
  rules: () => call<RuleEntry[]>("/office/rules"),
  approveRule: (id: string) => call<RuleEntry>(`/office/rules/${id}/approve`, { method: "POST", json: {} }),
  revokeRule: (id: string) => call<RuleEntry>(`/office/rules/${id}/revoke`, { method: "POST" }),
  discardRule: (id: string) => call<RuleEntry | { id: string; deleted: true }>(`/office/rules/${id}/discard`, { method: "POST" }),
  createRule: (body: Omit<RuleDraftBody, "tests">) => call<RuleEntry>("/office/rules", { method: "POST", json: body }),
  saveRuleDraft: (id: string, body: RuleDraftBody) => call<RuleEntry>(`/office/rules/${id}/draft`, { method: "PUT", json: body }),
  todo: () => call<Todo>("/office/todo"),
  testTemplate: async (id: string, file: File) => call<{ kind: string; extraction: Extraction; matches: boolean; expected: string[] }>(`/office/templates/${id}/test`, { method: "POST", json: await filePayload(file) }),
  confirmTemplate: (id: string) => call<{ ok: true }>(`/office/templates/${id}/confirm`, { method: "POST" }),
  config: () => call<OfficeConfigResponse>("/office/config"),
  saveConfig: (body: { slaDays?: number; languages?: Lang[] }) => call<OfficeConfigResponse["config"]>("/office/config", { method: "PUT", json: body }),
  extractInput: async (file: File) => call<{ kind: DocumentKind; extraction: Extraction }>("/office/inputs/extract", { method: "POST", json: await filePayload(file) }),
  confirmInput: (kind: DocumentKind, fields: string[]) => call<OfficeConfigResponse["config"]>("/office/inputs/confirm", { method: "POST", json: { kind, fields } }),

  staffAccounts: () => call<{ id: string; name: string; title: string }[]>("/staff/accounts"),
  staffLogin: (staffId: string) => call<{ token: string; staff: StaffMember }>("/staff/login", { method: "POST", json: { staffId } }),
  staffMe: () => call<StaffMember | null>("/staff/me"),
  staffLogout: () => call<{ ok: true }>("/staff/logout", { method: "POST" }),
  staffList: () => call<StaffMember[]>("/office/staff"),
  addStaff: (body: { name: string; title?: string; isCaseworker?: boolean; canBuild?: boolean; canApproveTemplates?: boolean }) => call<StaffMember[]>("/office/staff", { method: "POST", json: body }),
  setAccess: (id: string, access: { canBuild?: boolean; canApproveTemplates?: boolean; isCaseworker?: boolean }) => call<StaffMember[]>(`/office/staff/${id}`, { method: "PUT", json: access }),
  setInfo: (id: string, key: string, value: string) => call<CaseView>(`/applications/${id}/info`, { method: "PUT", json: { key, value } }),
  templates: () => call<TemplateLibrary>("/office/templates"),
  suggestTemplate: async (file: File) => call<TemplateSuggestion>("/office/templates/proposals/suggest", { method: "POST", json: await filePayload(file) }),
  saveProposal: (body: ProposalBody, id?: string) => call<TemplateProposal>(id ? `/office/templates/proposals/${id}` : "/office/templates/proposals", { method: id ? "PUT" : "POST", json: body }),
  acceptProposal: (id: string, method: MethodInfo["id"], minConfidence: number) => call<TemplateProposal>(`/office/templates/proposals/${id}/accept`, { method: "POST", json: { method, minConfidence } }),
  rejectProposal: (id: string, comment: string) => call<TemplateProposal>(`/office/templates/proposals/${id}/reject`, { method: "POST", json: { comment } }),

  processes: (category = "bafoeg.abroad") =>
    call<{ catalogId: string; live: ProcessDef | null; draft: ProcessDef | null; history: { version: number; updatedAt: string; updatedBy: string; name: string }[] }>(`/office/processes?category=${encodeURIComponent(category)}`),
  processList: () => call<{ catalogId: string; name: string; liveVersion: number | null; hasDraft: boolean; steps: number; updatedAt: string | null; updatedBy: string | null; owner: string | null }[]>("/office/processes/list"),
  createProcess: (catalogId: string, name?: string, proposal?: { nodes: ProcessDef["nodes"]; edges: ProcessDef["edges"] }) => call<ProcessDef>("/office/processes/create", { method: "POST", json: { catalogId, name, proposal } }),
  duplicateProcess: (from: string, catalogId: string, name?: string) => call<ProcessDef>("/office/processes/duplicate", { method: "POST", json: { from, catalogId, name } }),
  deleteProcess: (catalogId: string) => call<{ ok: true }>("/office/processes/delete", { method: "POST", json: { catalogId } }),
  catalogue: () => call<{ catalogue: CatalogNode[]; coverage: { id: string; offices: { id: string; name: string }[] }[] }>("/oversight/catalogue"),
  compare: (category: string) => call<CompareResult>(`/oversight/compare?category=${encodeURIComponent(category)}`),
  saveDraft: (def: ProcessDef) => call<ProcessDef>("/office/processes/draft", { method: "PUT", json: { def } }),
  validateProcess: (def: ProcessDef) => call<{ issues: ProcessIssue[] }>("/office/processes/validate", { method: "POST", json: { def } }),
  publish: (def: ProcessDef) => call<ProcessDef>("/office/processes/publish", { method: "POST", json: { def } }),
  processTests: (def: ProcessDef) => call<{ results: ProcessTestResult[] }>("/office/processes/tests", { method: "POST", json: { def } }),
  httpTry: (req: { method: string; url: string; headers: Record<string, string>; body?: string }) => call<{ status: number; body?: string; error?: string }>("/office/http/try", { method: "POST", json: req }),
  generateInfo: () => call<{ live: boolean; model: string | null }>("/office/processes/generate/info"),
  generateProcess: (description: string, mode: "simulated" | "live") => call<GeneratedProcess & { mode: "simulated" | "live"; fellBack?: string }>("/office/processes/generate", { method: "POST", json: { description, mode } }),
  documentProcess: (def: ProcessDef) => call<{ suggestions: Record<string, NodeSuggestion>; simulated: boolean }>("/office/processes/document", { method: "POST", json: { def } }),
  processImpact: (def: ProcessDef) => call<ProcessImpact>("/office/processes/impact", { method: "POST", json: { def } }),
  restartCase: (id: string) => call<CaseView>(`/office/cases/${id}/restart`, { method: "POST", json: {} }),
  messages: () => call<MessageEntry[]>("/office/messages"),
  createMessage: (body: MessageBody) => call<MessageEntry>("/office/messages", { method: "POST", json: body }),
  saveMessageDraft: (id: string, body: MessageBody) => call<MessageEntry>(`/office/messages/${id}/draft`, { method: "PUT", json: body }),
  approveMessage: (id: string) => call<MessageEntry>(`/office/messages/${id}/approve`, { method: "POST", json: {} }),
  discardMessage: (id: string) => call<MessageEntry | { id: string; deleted: true }>(`/office/messages/${id}/discard`, { method: "POST", json: {} }),
  connections: () => call<ConnectionView[]>("/office/connections"),
  setConnection: (system: string, body: { enabled?: boolean; mode?: "sandbox" | "live" }) => call<ConnectionView>(`/office/connections/${system}`, { method: "PUT", json: body }),
  testConnection: (system: string) => call<ConnectionView>(`/office/connections/${system}/test`, { method: "POST", json: {} }),
  advanceClock: (days: number) => call<{ aheadDays: number; fired: number }>("/admin/clock", { method: "POST", json: { days } }),
  restore: (category: string, version: number) => call<ProcessDef>("/office/processes/restore", { method: "POST", json: { category, version } }),
  testRun: (def: ProcessDef, sample: string, decision?: string) =>
    call<TestRunResult>("/office/processes/test", { method: "POST", json: { def, sample, decision } }),

  extraction: () => call<ExtractionSettings>("/office/extraction"),
  setExtraction: (kind: DocumentKind | "default", method: MethodInfo["id"], minConfidence?: number) =>
    call<{ config: ExtractionSettings["config"] }>("/office/extraction", { method: "PUT", json: { kind, method, minConfidence } }),
  reviewFields: (id: string, docId: string, fields: Record<string, string>) => call<CaseView>(`/office/cases/${id}/review`, { method: "POST", json: { docId, fields } }),

  samples: (lang: Lang = "en") => call<SampleList>(`/samples?lang=${lang}`),
  reset: () => call<{ ok: true }>("/admin/reset", { method: "POST" }),
};

export const documentUrl = (docId: string) => `/api/documents/${docId}`;
export const sampleUrl = (set: string, folder: "docs" | "fixes", name: string, lang: Lang = "en") => `/api/samples/files/${set}/${folder}/${encodeURIComponent(name)}?lang=${lang}`;

/** Applications started on this device, so students find them again without an account. */
export const myApplications = {
  list(): { id: string; reference: string }[] {
    try {
      return JSON.parse(localStorage.getItem("ms.myApplications") ?? "[]");
    } catch {
      return [];
    }
  },
  add(id: string, reference: string) {
    try {
      const all = myApplications.list().filter((a) => a.id !== id);
      localStorage.setItem("ms.myApplications", JSON.stringify([{ id, reference }, ...all].slice(0, 10)));
    } catch {
      /* ignore */
    }
  },
};
