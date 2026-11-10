import { randomBytes, randomUUID } from "node:crypto";
import Fastify, { type FastifyReply } from "fastify";
import {
  PILOT_MUNICIPALITY,
  applyPatch,
  landlordCanBeAsked,
  isEditable,
  type Application,
  type ApplicationPatch,
  type ApplicationStatus,
  type CaseworkerAction,
  type DocumentKind,
  type HealthResponse,
  type LandlordView,
} from "@digieurope/shared";
import { WorkflowError, caseworkerAction, exportForCaseSoftware, newApplication, submit, summarize, withPrecheck } from "./cases.js";
import { computeMetrics } from "./metrics.js";
import { DEMO_PERSONAS } from "./personas.js";
import { Store } from "./store.js";

const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const DOC_KINDS: DocumentKind[] = ["identity", "landlord_confirmation", "residence_title", "other"];
const ALLOWED_TYPES: Record<string, (b: Buffer) => boolean> = {
  "application/pdf": (b) => b.subarray(0, 5).toString("latin1") === "%PDF-",
  "image/png": (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  "image/jpeg": (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
};
const STATUSES: ApplicationStatus[] = ["draft", "submitted", "in_review", "info_requested", "id_check", "approved", "rejected"];

export interface AppOptions {
  store?: Store;
  logger?: boolean;
  /** Public base URL of the web app, used to build landlord links. */
  webUrl?: string;
  now?: () => Date;
}

export function buildApp(opts: AppOptions = {}) {
  const store = opts.store ?? new Store();
  const now = opts.now ?? (() => new Date());
  const webUrl = (opts.webUrl ?? "http://localhost:3000").replace(/\/$/, "");
  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 8 * 1024 * 1024 });

  app.setErrorHandler((err: Error & { statusCode?: number }, _req, reply) => {
    if (err instanceof WorkflowError) return reply.code(err.statusCode).send({ error: err.message });
    const code = err.statusCode ?? 500;
    if (code >= 500) app.log.error(err);
    return reply.code(code).send({ error: code >= 500 ? "Internal error" : err.message });
  });

  const notFound = (reply: FastifyReply) => reply.code(404).send({ error: "Not found" });

  /** The applicant's view: includes the landlord link so the demo can open it without e-mail. */
  const citizenView = (a: Application) => {
    const token = a.landlord.status === "requested" ? store.landlordTokenFor(a.id) : undefined;
    return withPrecheck({ ...a, landlord: { ...a.landlord, ...(token ? { requestLink: `${webUrl}/landlord/${token}` } : {}) } }, now());
  };

  const update = (a: Application, changes: Partial<Application>) => store.put({ ...a, ...changes, updatedAt: now().toISOString() });

  // --- General --------------------------------------------------------------

  app.get("/health", async (): Promise<HealthResponse> => ({
    status: "ok",
    service: "digieurope-api",
    time: now().toISOString(),
  }));

  app.get("/municipality", async () => PILOT_MUNICIPALITY);

  app.get("/eid/personas", async () => DEMO_PERSONAS);

  // --- Applicant ------------------------------------------------------------

  app.post<{ Body: { identityMethod?: string; personaId?: string; language?: string } }>("/applications", async (req, reply) => {
    const { identityMethod, personaId, language } = req.body ?? {};
    if (identityMethod !== "eid" && identityMethod !== "passport") return reply.code(400).send({ error: "identityMethod must be eid or passport" });
    const persona = identityMethod === "eid" ? DEMO_PERSONAS.find((p) => p.id === personaId) : undefined;
    if (identityMethod === "eid" && !persona) return reply.code(400).send({ error: "Unknown eID persona" });
    const created = newApplication(store, { identityMethod, persona, language: language === "en" ? "en" : "de", now: now() });
    store.put(created);
    return reply.code(201).send(citizenView(created));
  });

  app.get<{ Params: { id: string } }>("/applications/:id", async (req, reply) => {
    const a = store.get(req.params.id);
    return a ? citizenView(a) : notFound(reply);
  });

  app.patch<{ Params: { id: string }; Body: ApplicationPatch }>("/applications/:id", async (req, reply) => {
    const a = store.get(req.params.id);
    if (!a) return notFound(reply);
    if (!isEditable(a.status)) return reply.code(409).send({ error: "Application can no longer be edited." });
    let patched = applyPatch(a, req.body ?? {});
    // A landlord confirmation only covers the address and date it was given for.
    const changed = JSON.stringify([a.move.newAddress, a.move.moveInDate]) !== JSON.stringify([patched.move.newAddress, patched.move.moveInDate]);
    if (changed && (a.landlord.status === "confirmed" || a.landlord.status === "requested")) {
      store.clearLandlordToken(a.id);
      const { landlordName, landlordEmail } = patched.landlord;
      patched = { ...patched, landlord: { status: "missing", landlordName, landlordEmail } };
    }
    return citizenView(update(a, patched));
  });

  app.post<{ Params: { id: string }; Body: { kind?: string; filename?: string; mimeType?: string; dataBase64?: string } }>(
    "/applications/:id/documents",
    async (req, reply) => {
      const a = store.get(req.params.id);
      if (!a) return notFound(reply);
      if (!isEditable(a.status)) return reply.code(409).send({ error: "Application can no longer be edited." });
      const { kind, filename, mimeType, dataBase64 } = req.body ?? {};
      if (!kind || !DOC_KINDS.includes(kind as DocumentKind)) return reply.code(400).send({ error: "Unknown document kind" });
      const check = mimeType ? ALLOWED_TYPES[mimeType] : undefined;
      if (!check || typeof dataBase64 !== "string") return reply.code(400).send({ error: "Only PDF, PNG or JPEG files are accepted." });
      const content = Buffer.from(dataBase64, "base64");
      if (content.length === 0 || content.length > MAX_UPLOAD_BYTES) return reply.code(400).send({ error: "File must be between 1 byte and 5 MB." });
      if (!check(content)) return reply.code(400).send({ error: "File content does not match its type." });

      const meta = {
        id: randomUUID(),
        kind: kind as DocumentKind,
        filename: (filename ?? "document").replace(/[^\p{L}\p{N}._ -]/gu, "_").slice(0, 120),
        mimeType: mimeType!,
        size: content.length,
        uploadedAt: now().toISOString(),
      };
      store.saveDocument(a.id, meta, content);
      const landlord = kind === "landlord_confirmation" && a.landlord.status !== "confirmed" ? { ...a.landlord, status: "uploaded" as const } : a.landlord;
      return reply.code(201).send(citizenView(update(a, { documents: [...a.documents, meta], landlord })));
    },
  );

  app.delete<{ Params: { id: string; docId: string } }>("/applications/:id/documents/:docId", async (req, reply) => {
    const a = store.get(req.params.id);
    if (!a || !a.documents.some((d) => d.id === req.params.docId)) return notFound(reply);
    if (!isEditable(a.status)) return reply.code(409).send({ error: "Application can no longer be edited." });
    store.deleteDocument(req.params.docId);
    const documents = a.documents.filter((d) => d.id !== req.params.docId);
    const landlord =
      a.landlord.status === "uploaded" && !documents.some((d) => d.kind === "landlord_confirmation") ? { ...a.landlord, status: "missing" as const } : a.landlord;
    return citizenView(update(a, { documents, landlord }));
  });

  app.post<{ Params: { id: string }; Body: { landlordName?: string; landlordEmail?: string } }>("/applications/:id/landlord-request", async (req, reply) => {
    const a = store.get(req.params.id);
    if (!a) return notFound(reply);
    if (!isEditable(a.status)) return reply.code(409).send({ error: "Application can no longer be edited." });
    if (a.landlord.status === "confirmed") return reply.code(409).send({ error: "Landlord has already confirmed." });
    if (!landlordCanBeAsked(a)) return reply.code(422).send({ error: "Enter your new address and move-in date first." });
    const email = (req.body?.landlordEmail ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return reply.code(400).send({ error: "Please enter a valid e-mail address." });
    store.setLandlordToken(randomBytes(18).toString("base64url"), a.id);
    // Production: send the link by e-mail. The prototype shows it to the applicant instead.
    const landlord = { ...a.landlord, status: "requested" as const, landlordEmail: email, landlordName: (req.body?.landlordName ?? "").trim(), requestedAt: now().toISOString() };
    return citizenView(update(a, { landlord }));
  });

  app.post<{ Params: { id: string }; Body: { note?: string } }>("/applications/:id/submit", async (req, reply) => {
    const a = store.get(req.params.id);
    if (!a) return notFound(reply);
    return citizenView(store.put(submit(a, req.body?.note, now())));
  });

  app.get<{ Querystring: { reference?: string; birthDate?: string } }>("/status/lookup", async (req, reply) => {
    const ref = (req.query.reference ?? "").trim().toUpperCase();
    const a = store.list().find((x) => x.reference === ref && x.person.birthDate === req.query.birthDate);
    return a ? { id: a.id } : notFound(reply);
  });

  app.get<{ Params: { docId: string } }>("/documents/:docId", async (req, reply) => {
    const doc = store.readDocument(req.params.docId);
    if (!doc) return notFound(reply);
    return reply
      .header("Content-Type", doc.meta.mimeType)
      .header("Content-Disposition", `inline; filename="${encodeURIComponent(doc.meta.filename)}"`)
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "sandbox")
      .send(doc.content);
  });

  // --- Landlord -------------------------------------------------------------

  app.get<{ Params: { token: string } }>("/landlord/:token", async (req, reply) => {
    const a = store.applicationForLandlordToken(req.params.token);
    if (!a) return notFound(reply);
    const view: LandlordView = {
      reference: a.reference,
      tenantName: `${a.person.firstName} ${a.person.lastName}`.trim(),
      address: a.move.newAddress,
      moveInDate: a.move.moveInDate,
      landlordName: a.landlord.landlordName,
      status: a.landlord.status,
      municipality: PILOT_MUNICIPALITY.name,
    };
    return view;
  });

  app.post<{ Params: { token: string }; Body: { landlordName?: string; landlordAddress?: string; landlordIsOwner?: boolean; confirm?: boolean } }>(
    "/landlord/:token/confirm",
    async (req, reply) => {
      const a = store.applicationForLandlordToken(req.params.token);
      if (!a) return notFound(reply);
      const { landlordName = "", landlordAddress = "", landlordIsOwner = true, confirm } = req.body ?? {};
      if (confirm !== true) return reply.code(400).send({ error: "Confirmation is required." });
      if (!landlordName.trim() || !landlordAddress.trim()) return reply.code(400).send({ error: "Name and address of the landlord are required." });
      if (a.landlord.status === "confirmed") return { ok: true };
      update(a, {
        landlord: {
          ...a.landlord, status: "confirmed", landlordName: landlordName.trim(), landlordAddress: landlordAddress.trim(),
          landlordIsOwner: landlordIsOwner !== false, confirmedAt: now().toISOString(),
        },
      });
      return { ok: true };
    },
  );

  // --- Caseworker (no authentication in the prototype) -----------------------

  app.get<{ Querystring: { status?: string } }>("/caseworker/applications", async (req) => {
    const filter = (req.query.status ?? "").split(",").filter((s): s is ApplicationStatus => STATUSES.includes(s as ApplicationStatus));
    return store
      .list()
      .filter((a) => a.status !== "draft" && (!filter.length || filter.includes(a.status)))
      .map((a) => summarize(a, now()))
      .sort((x, y) => (x.submittedAt ?? "").localeCompare(y.submittedAt ?? ""));
  });

  app.get<{ Params: { id: string } }>("/caseworker/applications/:id", async (req, reply) => {
    const a = store.get(req.params.id);
    if (!a || a.status === "draft") return notFound(reply);
    return withPrecheck(a, a.submittedAt && a.status !== "info_requested" ? new Date(a.submittedAt) : now());
  });

  app.post<{ Params: { id: string } }>("/caseworker/applications/:id/open", async (req, reply) => {
    const a = store.get(req.params.id);
    if (!a || a.status === "draft") return notFound(reply);
    if (a.status !== "submitted") return withPrecheck(a, now());
    const at = now().toISOString();
    return withPrecheck(update(a, { status: "in_review", history: [...a.history, { status: "in_review", at }] }), now());
  });

  app.post<{ Params: { id: string }; Body: { action?: CaseworkerAction; message?: string } }>("/caseworker/applications/:id/actions", async (req, reply) => {
    const a = store.get(req.params.id);
    if (!a || a.status === "draft") return notFound(reply);
    const next = caseworkerAction(a, req.body?.action as CaseworkerAction, req.body?.message, store.list(), now());
    return withPrecheck(store.put(next), now());
  });

  app.get<{ Params: { id: string } }>("/caseworker/applications/:id/export", async (req, reply) => {
    const a = store.get(req.params.id);
    if (!a || a.status === "draft") return notFound(reply);
    return reply.header("Content-Disposition", `attachment; filename="${a.reference}.json"`).send(exportForCaseSoftware(a));
  });

  // --- Municipality -----------------------------------------------------------

  app.get("/metrics", async () => computeMetrics(store.list(), now()));

  return app;
}
