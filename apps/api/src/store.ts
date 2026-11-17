import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEFAULT_CATEGORY,
  defaultProcess,
  defaultRuleStates,
  type Application,
  type DocumentKind,
  type DocumentRef,
  type ExtractionMethod,
  type Lang,
  type ProcessDef,
  type RuleState,
  type StaffMember,
} from "@digieurope/shared";

export const DEFAULT_STAFF: StaffMember[] = [
  { id: "s-beispiel", name: "Frau Beispiel", title: "Sachbearbeitung Ausland", isAdmin: false, canBuild: false },
  { id: "s-kaya", name: "Herr Kaya", title: "Sachbearbeitung Ausland", isAdmin: false, canBuild: false },
  { id: "s-lindner", name: "Frau Lindner", title: "Prozessverantwortliche", isAdmin: false, canBuild: true },
  { id: "s-obermeier", name: "Herr Obermeier", title: "Amtsleitung (Administrator)", isAdmin: true, canBuild: true },
  { id: "s-weiss", name: "Frau Weiß", title: "Aufsicht Bundesebene (alle Ämter)", isAdmin: false, canBuild: false, isOversight: true },
];

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
  ruleStates: Record<string, RuleState>;
  config: OfficeConfig;
  staff: StaffMember[];
  sessions: Record<string, string>;
  /** One process per category of the process catalogue. */
  processes: Record<string, ProcessStore>;
}

const fresh = (): Data => ({
  seq: 0, applications: [], documents: [], parentTokens: {}, ruleStates: defaultRuleStates(), config: defaultConfig(),
  staff: DEFAULT_STAFF.map((x) => ({ ...x })), sessions: {}, processes: { [DEFAULT_CATEGORY]: { live: defaultProcess(), history: [] } },
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
      for (const p of Object.values(processes)) for (const d of [p.live, p.draft, ...p.history]) if (d && !d.catalogId) d.catalogId = DEFAULT_CATEGORY;
      const staff = [...saved.staff, ...DEFAULT_STAFF.filter((d) => !saved.staff.some((m) => m.id === d.id))];
      this.data = { ...fresh(), ...saved, staff, processes, config: { ...defaultConfig(), ...saved.config } };
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

  ruleStates = (): Record<string, RuleState> => this.data.ruleStates;
  setRuleState(id: string, state: RuleState) {
    this.data.ruleStates[id] = state;
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
