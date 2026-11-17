/** EU member states plus Switzerland: no foreign-cost surcharge (Auslandszuschlag) is paid there. */
const EU_OR_CH = new Set([
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE", "IT", "LV", "LT", "LU", "MT", "NL",
  "PL", "PT", "RO", "SK", "SI", "ES", "SE", "CH",
]);
const EUROPE = new Set([...EU_OR_CH, "GB", "NO", "IS", "LI", "RS", "AL", "MK", "ME", "BA", "UA", "MD", "TR"]);

export const isEuOrCh = (code: string) => EU_OR_CH.has(code);
export const isEurope = (code: string) => EUROPE.has(code);

/** ILLUSTRATIVE purchasing-power surcharge in percent. The real values are set per country by the federal foreign office. */
const SURCHARGE: Record<string, number> = { CA: 6, US: 10, AU: 8, NZ: 9, JP: 16, KR: 7, CN: 3, GB: 4, BR: 0, IN: 0, ZA: 0, SG: 12, AE: 5 };
export const surchargePercent = (code: string) => (isEuOrCh(code) ? 0 : SURCHARGE[code] ?? 5);

/** Destinations offered in the form. */
export const DESTINATIONS = ["CA", "US", "GB", "AU", "JP", "KR", "SG", "NZ", "ES", "PT", "FR", "IT", "NL", "SE", "IE", "BR"];
