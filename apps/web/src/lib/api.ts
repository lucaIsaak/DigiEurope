import type { Application, CaseView, DocumentTemplate, FieldType, TemplateField, TemplateProposal, CatalogNode, CatalogVariant, Harmony, OfficeSettings, ProcessDef, StaffMember, RunLogEntry, Mail, IntegrationEntry, ProcessIssue, DocumentKind, Extraction, LetterFields, Lang, Rule, RuleState, StayInfo, StudentInfo } from "@digieurope/shared";

export class ApiError extends Error {
  issues?: ProcessIssue[];
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

export interface RuleEntry {
  rule: Rule;
  state: RuleState;
  compiled: { when: string | null; pass: string };
  tests: { name: string; expectPass: boolean; actualPass: boolean; ok: boolean }[];
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

export interface TemplateLibrary {
  templates: (DocumentTemplate & { extraction: { method: MethodInfo["id"]; minConfidence: number } })[];
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

export interface TestRunResult {
  log: RunLogEntry[];
  status: string;
  waiting: string | null;
  finished: boolean;
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
  deliver: () => call<CaseSummary>("/office/portal/deliver", { method: "POST" }),
  insights: () => call<Insights>("/office/insights"),
  rules: () => call<RuleEntry[]>("/office/rules"),
  approveRule: (id: string) => call<{ ok: true }>(`/office/rules/${id}/approve`, { method: "POST", json: {} }),
  revokeRule: (id: string) => call<{ ok: true }>(`/office/rules/${id}/revoke`, { method: "POST" }),
  config: () => call<OfficeConfigResponse>("/office/config"),
  saveConfig: (body: { slaDays?: number; languages?: Lang[] }) => call<OfficeConfigResponse["config"]>("/office/config", { method: "PUT", json: body }),
  extractInput: async (file: File) => call<{ kind: DocumentKind; extraction: Extraction }>("/office/inputs/extract", { method: "POST", json: await filePayload(file) }),
  confirmInput: (kind: DocumentKind, fields: string[]) => call<OfficeConfigResponse["config"]>("/office/inputs/confirm", { method: "POST", json: { kind, fields } }),

  staffAccounts: () => call<{ id: string; name: string; title: string }[]>("/staff/accounts"),
  staffLogin: (staffId: string) => call<{ token: string; staff: StaffMember }>("/staff/login", { method: "POST", json: { staffId } }),
  staffMe: () => call<StaffMember | null>("/staff/me"),
  staffLogout: () => call<{ ok: true }>("/staff/logout", { method: "POST" }),
  staffList: () => call<StaffMember[]>("/office/staff"),
  setAccess: (id: string, access: { canBuild?: boolean; canApproveTemplates?: boolean }) => call<StaffMember[]>(`/office/staff/${id}`, { method: "PUT", json: access }),
  setInfo: (id: string, key: string, value: string) => call<CaseView>(`/applications/${id}/info`, { method: "PUT", json: { key, value } }),
  templates: () => call<TemplateLibrary>("/office/templates"),
  suggestTemplate: async (file: File) => call<TemplateSuggestion>("/office/templates/proposals/suggest", { method: "POST", json: await filePayload(file) }),
  saveProposal: (body: ProposalBody, id?: string) => call<TemplateProposal>(id ? `/office/templates/proposals/${id}` : "/office/templates/proposals", { method: id ? "PUT" : "POST", json: body }),
  acceptProposal: (id: string, method: MethodInfo["id"], minConfidence: number) => call<TemplateProposal>(`/office/templates/proposals/${id}/accept`, { method: "POST", json: { method, minConfidence } }),
  rejectProposal: (id: string, comment: string) => call<TemplateProposal>(`/office/templates/proposals/${id}/reject`, { method: "POST", json: { comment } }),

  processes: (category = "bafoeg.abroad") =>
    call<{ catalogId: string; live: ProcessDef | null; draft: ProcessDef | null; history: { version: number; updatedAt: string; updatedBy: string; name: string }[] }>(`/office/processes?category=${encodeURIComponent(category)}`),
  processList: () => call<{ catalogId: string; name: string; liveVersion: number | null; hasDraft: boolean }[]>("/office/processes/list"),
  createProcess: (catalogId: string, name?: string) => call<ProcessDef>("/office/processes/create", { method: "POST", json: { catalogId, name } }),
  catalogue: () => call<{ catalogue: CatalogNode[]; coverage: { id: string; offices: { id: string; name: string }[] }[] }>("/oversight/catalogue"),
  compare: (category: string) => call<CompareResult>(`/oversight/compare?category=${encodeURIComponent(category)}`),
  saveDraft: (def: ProcessDef) => call<ProcessDef>("/office/processes/draft", { method: "PUT", json: { def } }),
  validateProcess: (def: ProcessDef) => call<{ issues: ProcessIssue[] }>("/office/processes/validate", { method: "POST", json: { def } }),
  publish: (def: ProcessDef) => call<ProcessDef>("/office/processes/publish", { method: "POST", json: { def } }),
  restore: (category: string, version: number) => call<ProcessDef>("/office/processes/restore", { method: "POST", json: { category, version } }),
  testRun: (def: ProcessDef, sample: string, decision?: string) =>
    call<TestRunResult>("/office/processes/test", { method: "POST", json: { def, sample, decision } }),

  extraction: () => call<ExtractionSettings>("/office/extraction"),
  setExtraction: (kind: DocumentKind | "default", method: MethodInfo["id"], minConfidence?: number) =>
    call<{ config: ExtractionSettings["config"] }>("/office/extraction", { method: "PUT", json: { kind, method, minConfidence } }),
  reviewFields: (id: string, docId: string, fields: Record<string, string>) => call<CaseView>(`/office/cases/${id}/review`, { method: "POST", json: { docId, fields } }),

  samples: () => call<SampleList>("/samples"),
  reset: () => call<{ ok: true }>("/admin/reset", { method: "POST" }),
};

export const documentUrl = (docId: string) => `/api/documents/${docId}`;
export const sampleUrl = (set: string, folder: "docs" | "fixes", name: string) => `/api/samples/files/${set}/${folder}/${encodeURIComponent(name)}`;

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
