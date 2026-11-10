import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Application, DocumentRef } from "@digieurope/shared";

interface StoredDocument extends DocumentRef {
  applicationId: string;
}

interface Data {
  seq: number;
  applications: Application[];
  documents: StoredDocument[];
  landlordTokens: Record<string, string>; // token -> application id
}

/**
 * Minimal persistence for the prototype: one JSON file plus an uploads folder.
 * Without a directory everything stays in memory (tests). Swap for PostgreSQL later;
 * the routes only use the methods below.
 */
export class Store {
  private data: Data = { seq: 0, applications: [], documents: [], landlordTokens: {} };
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
    if (!this.isNew) this.data = JSON.parse(readFileSync(file, "utf8")) as Data;
  }

  private save() {
    if (!this.dir) return;
    const file = join(this.dir, "store.json");
    writeFileSync(`${file}.tmp`, JSON.stringify(this.data, null, 2));
    renameSync(`${file}.tmp`, file);
  }

  nextReference(prefix: string, year: number): string {
    this.data.seq += 1;
    this.save();
    return `${prefix}-${year}-${String(this.data.seq).padStart(5, "0")}`;
  }

  list(): Application[] {
    return this.data.applications;
  }

  get(id: string): Application | undefined {
    return this.data.applications.find((a) => a.id === id);
  }

  put(app: Application): Application {
    const i = this.data.applications.findIndex((a) => a.id === app.id);
    if (i === -1) this.data.applications.push(app);
    else this.data.applications[i] = app;
    this.save();
    return app;
  }

  setLandlordToken(token: string, applicationId: string) {
    for (const [t, id] of Object.entries(this.data.landlordTokens)) if (id === applicationId) delete this.data.landlordTokens[t];
    this.data.landlordTokens[token] = applicationId;
    this.save();
  }

  clearLandlordToken(applicationId: string) {
    for (const [t, id] of Object.entries(this.data.landlordTokens)) if (id === applicationId) delete this.data.landlordTokens[t];
    this.save();
  }

  landlordTokenFor(applicationId: string): string | undefined {
    return Object.entries(this.data.landlordTokens).find(([, id]) => id === applicationId)?.[0];
  }

  applicationForLandlordToken(token: string): Application | undefined {
    const id = this.data.landlordTokens[token];
    return id ? this.get(id) : undefined;
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
}
