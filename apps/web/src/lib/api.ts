import type {
  ApplicationPatch,
  ApplicationWithPrecheck,
  CaseSummary,
  CaseworkerAction,
  DemoPersona,
  DocumentKind,
  LandlordView,
  Metrics,
} from "@digieurope/shared";

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

async function call<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  const res = await fetch(`/api${path}`, {
    ...rest,
    headers: json !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: json !== undefined ? JSON.stringify(json) : undefined,
    cache: "no-store",
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ApiError(body.error ?? res.statusText, res.status);
  }
  return res.json() as Promise<T>;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export const api = {
  personas: () => call<DemoPersona[]>("/eid/personas"),
  create: (body: { identityMethod: "eid" | "passport"; personaId?: string; language: string }) =>
    call<ApplicationWithPrecheck>("/applications", { method: "POST", json: body }),
  get: (id: string) => call<ApplicationWithPrecheck>(`/applications/${id}`),
  patch: (id: string, patch: ApplicationPatch) => call<ApplicationWithPrecheck>(`/applications/${id}`, { method: "PATCH", json: patch }),
  upload: async (id: string, kind: DocumentKind, file: File) =>
    call<ApplicationWithPrecheck>(`/applications/${id}/documents`, {
      method: "POST",
      json: { kind, filename: file.name, mimeType: file.type, dataBase64: await fileToBase64(file) },
    }),
  removeDocument: (id: string, docId: string) => call<ApplicationWithPrecheck>(`/applications/${id}/documents/${docId}`, { method: "DELETE" }),
  requestLandlord: (id: string, landlordName: string, landlordEmail: string) =>
    call<ApplicationWithPrecheck>(`/applications/${id}/landlord-request`, { method: "POST", json: { landlordName, landlordEmail } }),
  submit: (id: string, note?: string) => call<ApplicationWithPrecheck>(`/applications/${id}/submit`, { method: "POST", json: { note } }),
  lookup: (reference: string, birthDate: string) =>
    call<{ id: string }>(`/status/lookup?reference=${encodeURIComponent(reference)}&birthDate=${encodeURIComponent(birthDate)}`),

  landlord: (token: string) => call<LandlordView>(`/landlord/${token}`),
  landlordConfirm: (token: string, body: { landlordName: string; landlordAddress: string; landlordIsOwner: boolean; confirm: boolean }) =>
    call<{ ok: true }>(`/landlord/${token}/confirm`, { method: "POST", json: body }),

  queue: (status?: string) => call<CaseSummary[]>(`/caseworker/applications${status ? `?status=${status}` : ""}`),
  case: (id: string) => call<ApplicationWithPrecheck>(`/caseworker/applications/${id}`),
  openCase: (id: string) => call<ApplicationWithPrecheck>(`/caseworker/applications/${id}/open`, { method: "POST" }),
  act: (id: string, action: CaseworkerAction, message?: string) =>
    call<ApplicationWithPrecheck>(`/caseworker/applications/${id}/actions`, { method: "POST", json: { action, message } }),

  metrics: () => call<Metrics>("/metrics"),
};

export const documentUrl = (docId: string) => `/api/documents/${docId}`;
export const exportUrl = (id: string) => `/api/caseworker/applications/${id}/export`;

/** Applications started on this device, so newcomers find them again without an account. */
export const myApplications = {
  list(): { id: string; reference: string }[] {
    if (typeof window === "undefined") return [];
    try {
      return JSON.parse(localStorage.getItem("de.myApplications") ?? "[]");
    } catch {
      return [];
    }
  },
  add(id: string, reference: string) {
    const all = myApplications.list().filter((a) => a.id !== id);
    localStorage.setItem("de.myApplications", JSON.stringify([{ id, reference }, ...all].slice(0, 10)));
  },
};
