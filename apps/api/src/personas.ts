import type { DemoPersona } from "@digieurope/shared";

/**
 * Stand-ins for what an eID / BundID login would return. Fictional people only.
 * In production this data comes from the official ID login, never from us.
 */
export const DEMO_PERSONAS: DemoPersona[] = [
  {
    id: "lena",
    label: "Lena Hoffmann",
    description: "German citizen, moving from Hamburg, German ID card with eID",
    person: {
      firstName: "Lena", lastName: "Hoffmann", birthName: "", birthDate: "1988-03-14", birthPlace: "Hamburg",
      nationality: "DE", sex: "female", maritalStatus: "unknown", religion: "none",
    },
    identityDocument: { type: "id_card", number: "L01X00T47", issuingCountry: "DE", expiryDate: "2031-05-30" },
  },
  {
    id: "giulia",
    label: "Giulia Rossi",
    description: "Italian citizen, moving from Milan, EU eID card",
    person: {
      firstName: "Giulia", lastName: "Rossi", birthName: "", birthDate: "1994-09-02", birthPlace: "Milano",
      nationality: "IT", sex: "female", maritalStatus: "unknown", religion: "none",
    },
    identityDocument: { type: "id_card", number: "CA12345BC", issuingCountry: "IT", expiryDate: "2032-09-02" },
  },
];

export const ELIGIBLE_EID_NOTE =
  "Newcomers from outside the EU usually receive an eID-capable residence card only after registering, so they use the passport path.";
