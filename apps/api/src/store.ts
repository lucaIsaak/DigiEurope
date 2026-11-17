import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { defaultRuleStates, type Application, type DocumentKind, type DocumentRef, type Lang, type RuleState } from "@digieurope/shared";

export interface OfficeConfig {
  name: string;
  languages: Lang[];
  acceptedFileTypes: string[];
  /** Target for the first human reply, in days. */
  slaDays: number;
  workflow: string[];
  /** Fields the office confirmed as expected input per document type. */
  expectedInputs: Partial<Record<DocumentKind, { fields: string[]; confirmedAt?: string }>>;
}

export const defaultConfig = (): OfficeConfig => ({
  name: "Studierendenwerk Musterstadt",
  languages: ["de", "en"],
  acceptedFileTypes: ["application/pdf"],
  slaDays: 5,
  workflow: ["received", "checked", "in_review", "decided"],
  expectedInputs: {},
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
}

const fresh = (): Data => ({ seq: 0, applications: [], documents: [], parentTokens: {}, ruleStates: defaultRuleStates(), config: defaultConfig() });

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
    if (!this.isNew) this.data = { ...fresh(), ...(JSON.parse(readFileSync(file, "utf8")) as Data) };
  }

  private save() {
    if (!this.dir) return;
    const file = join(this.dir, "store.json");
    writeFileSync(`${file}.tmp`, JSON.stringify(this.data));
    renameSync(`${file}.tmp`, file);
  }

  /** Wipes all demo data and returns to the factory state. */
  clear() {
    this.data = fresh();
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
