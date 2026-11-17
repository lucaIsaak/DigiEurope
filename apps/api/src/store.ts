import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  BUILTIN_TEMPLATES,
  DEFAULT_CATEGORY,
  defaultInputs,
  defaultProcess,
  defaultRuleStates,
  type Application,
  type DocumentKind,
  type DocumentRef,
  type ExtractionMethod,
  type Lang,
  type DocumentTemplate,
  type ProcessDef,
  type TemplateProposal,
  type Rule,
  type RuleState,
  RULES,
  type StaffMember,
} from "@digieurope/shared";

export const DEFAULT_STAFF: StaffMember[] = [
  { id: "s-beispiel", name: "Frau Beispiel", title: "Sachbearbeitung Ausland", isAdmin: false, canBuild: false },
  { id: "s-kaya", name: "Herr Kaya", title: "Sachbearbeitung Ausland", isAdmin: false, canBuild: false },
  { id: "s-lindner", name: "Frau Lindner", title: "Prozessverantwortliche", isAdmin: false, canBuild: true },
  { id: "s-obermeier", name: "Herr Obermeier", title: "Amtsleitung (Administrator)", isAdmin: true, canBuild: true },
  { id: "s-richter", name: "Frau Richter", title: "Verantwortliche für Extraktoren und Vorlagen", isAdmin: false, canBuild: false, canApproveTemplates: true },
  { id: "s-weiss", name: "Frau Weiß", title: "Aufsicht Bundesebene (alle Ämter)", isAdmin: false, canBuild: false, isOversight: true },
];

/** One version of a rule: who wrote it, who approved it. */
export interface RuleVersion {
  rule: Rule;
  author: string;
  createdAt: string;
  approvedBy?: string;
  approvedAt?: string;
}

/** A rule's lifecycle: the version that runs, a change waiting for approval, and the earlier versions. */
export interface RuleStore {
  live: RuleVersion | null;
  paused: boolean;
  draft?: RuleVersion;
  history: RuleVersion[];
}

export function initialRules(states: Record<string, RuleState> = defaultRuleStates()): Record<string, RuleStore> {
  const out: Record<string, RuleStore> = {};
  for (const r of RULES) {
    const approved = states[r.id]?.status === "approved";
    out[r.id] = r.draftedByAi && !approved
      ? { live: null, paused: false, draft: { rule: r, author: "KI-Assistent (angefragt von Frau Lindner)", createdAt: "2026-11-10T09:12:00.000Z" }, history: [] }
      : { live: { rule: r, author: "Fachbereich Ausland (Muster)", createdAt: "2026-08-20T10:00:00.000Z", approvedBy: states[r.id]?.approvedBy ?? "Herr Obermeier", approvedAt: states[r.id]?.approvedAt ?? "2026-09-01T09:00:00.000Z" }, paused: !approved && !r.draftedByAi, history: [] };
  }
  return out;
}

export interface TemplateCheck {
  confirmedAt: string;
  confirmedBy: string;
}

export interface TemplateLogEntry {
  templateId: string;
  at: string;
  by: string;
  text: string;
}

export interface ProcessStore {
  /** Null until the first version has been published. */
  live: ProcessDef | null;
  draft?: ProcessDef;
  history: ProcessDef[];
}

export interface OfficeConfig {
  name: string;
  languages: Lang[];
  acceptedFileTypes: string[];
  /** Target for the first human reply, in days. */
  slaDays: number;
  workflow: string[];
  /** Fields the office confirmed as expected input per document type. */
  expectedInputs: Partial<Record<DocumentKind, { fields: string[]; confirmedAt?: string }>>;
  /** Templates that were tested with a sample and confirmed. Only these can be required by a process. */
  templateChecks: Record<string, TemplateCheck>;
  templateLog: TemplateLogEntry[];
  /** How each document type is read. Types without an entry use `defaultMethod`. */
  extraction: Partial<Record<DocumentKind, { method: ExtractionMethod; minConfidence: number }>>;
  defaultMethod: ExtractionMethod;
}

export const defaultConfig = (): OfficeConfig => ({
  name: "Studierendenwerk Musterstadt",
  languages: ["de", "en"],
  acceptedFileTypes: ["application/pdf"],
  slaDays: 5,
  workflow: ["received", "checked", "in_review", "decided"],
  expectedInputs: {},
  templateChecks: Object.fromEntries(
    BUILTIN_TEMPLATES.filter((t) => t.id !== "decision_letter").map((t) => [t.id, { confirmedAt: "2026-09-01T09:00:00.000Z", confirmedBy: "Frau Richter" }]),
  ),
  templateLog: [],
  extraction: {},
  defaultMethod: "builtin",
});

interface StoredDocument extends DocumentRef {
  applicationId: string;
}

interface Data {
  seq: number;
  applications: Application[];
  documents: StoredDocument[];
  parentTokens: Record<string, string>;
  /** Kept only to migrate older demo stores. */
  ruleStates?: Record<string, RuleState>;
  rules: Record<string, RuleStore>;
  config: OfficeConfig;
  staff: StaffMember[];
  sessions: Record<string, string>;
  /** One process per category of the process catalogue. */
  processes: Record<string, ProcessStore>;
  /** Templates accepted from proposals. The built-in ones live in code. */
  templates: DocumentTemplate[];
  proposals: TemplateProposal[];
}

const fresh = (): Data => ({
  seq: 0, applications: [], documents: [], parentTokens: {}, rules: initialRules(), config: defaultConfig(),
  staff: DEFAULT_STAFF.map((x) => ({ ...x })), sessions: {}, processes: { [DEFAULT_CATEGORY]: { live: defaultProcess(), history: [] } },
  templates: [], proposals: [],
});

/** Prototype persistence: one JSON file plus an uploads folder. Without a directory everything stays in memory (tests). */
export class Store {
  private data: Data = fresh();
  private files = new Map<string, Buffer>();
  readonly isNew: boolean;

  constructor(private readonly dir?: string) {
    if (!dir) {
      this.isNew = true;
      return;
    }
    mkdirSync(join(dir, "uploads"), { recursive: true });
    const file = join(dir, "store.json");
    this.isNew = !existsSync(file);
    if (!this.isNew) {
      const saved = JSON.parse(readFileSync(file, "utf8")) as Data;
      const old = saved.processes as unknown as { live?: ProcessDef };
      const processes = old && "live" in old ? { [DEFAULT_CATEGORY]: old as unknown as ProcessStore } : saved.processes;
      for (const p of Object.values(processes)) for (const d of [p.live, p.draft, ...p.history]) if (d) { if (!d.catalogId) d.catalogId = DEFAULT_CATEGORY; if (!d.inputs) d.inputs = defaultInputs(); }
      const staff = [...saved.staff, ...DEFAULT_STAFF.filter((d) => !saved.staff.some((m) => m.id === d.id))];
      const rules = saved.rules ?? initialRules(saved.ruleStates);
      this.data = { ...fresh(), ...saved, staff, processes, rules, config: { ...defaultConfig(), ...saved.config } };
    }
  }

  private save() {
    if (!this.dir) return;
    const file = join(this.dir, "store.json");
    writeFileSync(`${file}.tmp`, JSON.stringify(this.data));
    renameSync(`${file}.tmp`, file);
  }

  /** Wipes all demo data and returns to the factory state. */
  clear() {
    const sessions = this.data.sessions;
    this.data = { ...fresh(), sessions };
    this.files.clear();
    if (this.dir) {
      rmSync(join(this.dir, "uploads"), { recursive: true, force: true });
      mkdirSync(join(this.dir, "uploads"), { recursive: true });
    }
    this.save();
  }

  nextReference(prefix: string, year: number): string {
    this.data.seq += 1;
    this.save();
    return `${prefix}-${year}-${String(this.data.seq).padStart(5, "0")}`;
  }

  list = (): Application[] => this.data.applications;
  get = (id: string): Application | undefined => this.data.applications.find((a) => a.id === id);

  put(app: Application): Application {
    const i = this.data.applications.findIndex((a) => a.id === app.id);
    if (i === -1) this.data.applications.push(app);
    else this.data.applications[i] = app;
    this.save();
    return app;
  }

  findByReference(reference: string): Application | undefined {
    return this.data.applications.find((a) => a.reference.toLowerCase() === reference.trim().toLowerCase());
  }

  setParentToken(token: string, applicationId: string) {
    for (const [t, id] of Object.entries(this.data.parentTokens)) if (id === applicationId) delete this.data.parentTokens[t];
    this.data.parentTokens[token] = applicationId;
    this.save();
  }
  parentTokenFor = (applicationId: string): string | undefined => Object.entries(this.data.parentTokens).find(([, id]) => id === applicationId)?.[0];
  applicationForParentToken(token: string): Application | undefined {
    const id = this.data.parentTokens[token];
    return id ? this.get(id) : undefined;
  }

  /** Which rules run: approved and not switched off. */
  ruleStates = (): Record<string, RuleState> =>
    Object.fromEntries(Object.entries(this.data.rules).map(([id, r]) => [id, r.live && !r.paused ? { status: "approved", approvedBy: r.live.approvedBy, approvedAt: r.live.approvedAt } : { status: "draft" }]));
  liveRules = (): Rule[] => Object.values(this.data.rules).filter((r) => r.live && !r.paused).map((r) => r.live!.rule);
  rules = (): Record<string, RuleStore> => this.data.rules;
  setRule(id: string, r: RuleStore) {
    this.data.rules[id] = r;
    this.save();
  }
  deleteRule(id: string) {
    delete this.data.rules[id];
    this.save();
  }

  staff = (): StaffMember[] => this.data.staff;
  setStaff(id: string, patch: Partial<StaffMember>) {
    this.data.staff = this.data.staff.map((m) => (m.id === id ? { ...m, ...patch } : m));
    this.save();
  }
  login(staffId: string, token: string) {
    this.data.sessions[token] = staffId;
    this.save();
  }
  logout(token: string) {
    delete this.data.sessions[token];
    this.save();
  }
  staffBySession = (token: string | undefined): StaffMember | undefined => (token ? this.data.staff.find((m) => m.id === this.data.sessions[token]) : undefined);

  templates = (): DocumentTemplate[] => this.data.templates;
  addTemplate(t: DocumentTemplate) {
    this.data.templates.push(t);
    this.save();
  }
  proposals = (): TemplateProposal[] => this.data.proposals;
  putProposal(p: TemplateProposal) {
    const i = this.data.proposals.findIndex((x) => x.id === p.id);
    if (i === -1) this.data.proposals.push(p);
    else this.data.proposals[i] = p;
    this.save();
  }

  processes = (): Record<string, ProcessStore> => this.data.processes;
  process = (category: string): ProcessStore | undefined => this.data.processes[category];
  setProcess(category: string, p: ProcessStore) {
    this.data.processes[category] = p;
    this.save();
  }

  config = (): OfficeConfig => this.data.config;
  setConfig(c: OfficeConfig) {
    this.data.config = c;
    this.save();
  }

  saveDocument(applicationId: string, meta: DocumentRef, content: Buffer) {
    this.data.documents.push({ ...meta, applicationId });
    if (this.dir) writeFileSync(join(this.dir, "uploads", meta.id), content);
    else this.files.set(meta.id, content);
    this.save();
  }

  deleteDocument(id: string) {
    this.data.documents = this.data.documents.filter((d) => d.id !== id);
    this.files.delete(id);
    this.save();
  }

  readDocument(id: string): { meta: StoredDocument; content: Buffer } | undefined {
    const meta = this.data.documents.find((d) => d.id === id);
    if (!meta) return undefined;
    const content = this.dir ? readFileSync(join(this.dir, "uploads", id)) : this.files.get(id);
    return content ? { meta, content } : undefined;
  }

  /** Bulk save used by the seed: avoids rewriting the JSON file for every document. */
  deferred<T>(fn: () => T): T {
    const original = this.save;
    this.save = () => {};
    try {
      return fn();
    } finally {
      this.save = original;
      this.save();
    }
  }
}
