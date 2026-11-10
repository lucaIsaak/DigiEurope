/** EU and EEA member states plus Switzerland: freedom of movement, no residence title needed. */
export const FREE_MOVEMENT_COUNTRIES = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
  "IS", "LI", "NO", "CH",
]);

/** Countries offered in the prototype's select fields. Labels come from Intl.DisplayNames. */
export const COUNTRY_CODES = [
  "DE", "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "GR", "HU", "IE", "IT",
  "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE", "IS", "LI", "NO",
  "CH", "GB", "UA", "TR", "RU", "RS", "BA", "AL", "XK", "MK", "SY", "AF", "IQ", "IR", "IN",
  "PK", "BD", "CN", "JP", "KR", "VN", "PH", "ID", "TH", "US", "CA", "MX", "BR", "CO", "AR",
  "CL", "PE", "VE", "EG", "MA", "TN", "NG", "GH", "KE", "ET", "ZA", "AU", "NZ", "IL",
];

export function needsResidenceTitle(nationality: string): boolean {
  return nationality !== "" && !FREE_MOVEMENT_COUNTRIES.has(nationality);
}
