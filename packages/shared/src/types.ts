export interface HealthResponse {
  status: "ok";
  service: string;
  time: string;
}

export type Lang = "de" | "en";

export type ApplicationStatus =
  | "draft"
  | "submitted"
  | "in_review"
  | "info_requested"
  | "id_check"
  | "approved"
  | "rejected";

/** How the applicant proved who they are. */
export type IdentityMethod = "eid" | "passport";

export type Sex = "female" | "male" | "diverse" | "unspecified";
export type MaritalStatus = "single" | "married" | "partnership" | "divorced" | "widowed" | "unknown";
export type Religion = "none" | "roman_catholic" | "protestant" | "other";

export interface Person {
  firstName: string;
  lastName: string;
  birthName: string;
  birthDate: string; // YYYY-MM-DD
  birthPlace: string;
  nationality: string; // ISO 3166-1 alpha-2
  sex: Sex;
  maritalStatus: MaritalStatus;
  religion: Religion;
}

export interface IdentityDocument {
  type: "passport" | "id_card" | "";
  number: string;
  issuingCountry: string;
  expiryDate: string;
}

export interface ResidenceTitle {
  type: "visa" | "residence_permit" | "blue_card" | "none" | "";
  expiryDate: string;
}

export interface Address {
  street: string;
  houseNumber: string;
  addressExtra: string;
  postalCode: string;
  city: string;
}

export interface Move {
  newAddress: Address;
  moveInDate: string;
  residenceType: "main" | "secondary";
  previousResidence: "abroad" | "germany" | "none";
  previousAddress: Address;
  previousCountry: string;
}

export type LandlordStatus = "missing" | "uploaded" | "requested" | "confirmed";

export interface LandlordConfirmation {
  status: LandlordStatus;
  landlordName: string;
  landlordEmail: string;
  /** Filled in by the landlord when confirming digitally. */
  landlordAddress?: string;
  landlordIsOwner?: boolean;
  requestedAt?: string;
  confirmedAt?: string;
  /** Only present in API responses to the applicant, so the demo can open the landlord page. */
  requestLink?: string;
}

export type DocumentKind = "identity" | "landlord_confirmation" | "residence_title" | "other";

export interface DocumentRef {
  id: string;
  kind: DocumentKind;
  filename: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
}

export interface Message {
  id: string;
  from: "citizen" | "caseworker" | "system";
  text: string;
  at: string;
}

export interface StatusEvent {
  status: ApplicationStatus;
  at: string;
  note?: string;
}

export interface Appointment {
  start: string; // ISO datetime
  minutes: number;
  location: string;
}

export interface Application {
  id: string;
  reference: string;
  municipalityId: string;
  status: ApplicationStatus;
  language: Lang;
  identityMethod: IdentityMethod;
  /** Fields that came from the eID and cannot be edited by the applicant. */
  verifiedFields: (keyof Person)[];
  person: Person;
  identityDocument: IdentityDocument;
  residenceTitle: ResidenceTitle;
  move: Move;
  landlord: LandlordConfirmation;
  documents: DocumentRef[];
  messages: Message[];
  history: StatusEvent[];
  appointment?: Appointment;
  createdAt: string;
  updatedAt: string;
  submittedAt?: string;
  decidedAt?: string;
}

/** Fields the applicant may change while a draft (or after an information request). */
export interface ApplicationPatch {
  language?: Lang;
  person?: Partial<Person>;
  identityDocument?: Partial<IdentityDocument>;
  residenceTitle?: Partial<ResidenceTitle>;
  move?: Partial<Omit<Move, "newAddress" | "previousAddress">> & {
    newAddress?: Partial<Address>;
    previousAddress?: Partial<Address>;
  };
  landlord?: { landlordName?: string; landlordEmail?: string };
}

export interface Municipality {
  id: string;
  name: string;
  office: string;
  officeAddress: string;
  postalCodes: string[];
}

export type PrecheckSeverity = "ok" | "warning" | "blocker";
export type PrecheckStep = "person" | "move" | "landlord" | "documents";

export interface PrecheckItem {
  code: string;
  severity: PrecheckSeverity;
  step: PrecheckStep;
  params?: Record<string, string | number>;
}

export interface PrecheckResult {
  ready: boolean;
  blockers: number;
  warnings: number;
  items: PrecheckItem[];
}

export interface DemoPersona {
  id: string;
  label: string;
  description: string;
  person: Person;
  identityDocument: IdentityDocument;
}

export interface Metrics {
  generatedAt: string;
  totals: Record<ApplicationStatus, number>;
  submittedLast30Days: number;
  decided: number;
  completeAtFirstSubmission: number; // share 0..1 of decided applications
  medianDaysToDecision: number | null;
  averageDaysToDecision: number | null;
  approvedByMethod: Record<IdentityMethod, number>;
  digitalLandlordShare: number; // share 0..1 of submitted applications
  languages: Record<string, number>;
  weekly: { weekStart: string; submitted: number; decided: number }[];
}

export type CaseworkerAction = "approve" | "invite_id_check" | "confirm_identity" | "request_info" | "reject";

export interface CaseSummary {
  id: string;
  reference: string;
  name: string;
  nationality: string;
  status: ApplicationStatus;
  identityMethod: IdentityMethod;
  language: Lang;
  submittedAt?: string;
  updatedAt: string;
  warnings: number;
  appointment?: Appointment;
}

export interface LandlordView {
  reference: string;
  tenantName: string;
  address: Address;
  moveInDate: string;
  landlordName: string;
  status: LandlordStatus;
  municipality: string;
}

/** API response for a single application: the record plus its current pre-check. */
export interface ApplicationWithPrecheck extends Application {
  precheck: PrecheckResult;
}
