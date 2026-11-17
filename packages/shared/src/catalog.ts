import type { Bilingual } from "./types.js";

export interface CatalogNode {
  id: string;
  title: Bilingual;
  children?: CatalogNode[];
}

/**
 * The central process catalogue: domain > service > variant. Every process of every office is assigned to exactly one variant,
 * so the same process can be compared across offices.
 */
export const PROCESS_CATALOG: CatalogNode[] = [
  {
    id: "student_funding",
    title: { de: "Studienfinanzierung", en: "Student funding" },
    children: [
      {
        id: "bafoeg",
        title: { de: "BAföG", en: "BAföG" },
        children: [
          { id: "bafoeg.abroad", title: { de: "Auslands-BAföG: Antrag", en: "BAföG abroad: application" } },
          { id: "bafoeg.domestic", title: { de: "Inlands-BAföG: Antrag", en: "BAföG domestic: application" } },
          { id: "bafoeg.followup", title: { de: "BAföG: Folgeantrag", en: "BAföG: follow-up application" } },
          { id: "bafoeg.objection", title: { de: "BAföG: Widerspruch", en: "BAföG: objection" } },
        ],
      },
    ],
  },
  {
    id: "housing",
    title: { de: "Wohnen", en: "Housing" },
    children: [{ id: "housing.dorm", title: { de: "Wohnheim", en: "Dormitory" }, children: [{ id: "housing.dorm.application", title: { de: "Wohnheimplatz: Antrag", en: "Dormitory room: application" } }] }],
  },
  {
    id: "social",
    title: { de: "Beratung & Soziales", en: "Counselling and social" },
    children: [{ id: "social.fund", title: { de: "Notfallfonds", en: "Emergency fund" }, children: [{ id: "social.fund.application", title: { de: "Notfallfonds: Antrag", en: "Emergency fund: application" } }] }],
  },
];

export interface CatalogVariant {
  id: string;
  /** Titles from the domain down to the variant. */
  path: Bilingual[];
}

export function catalogVariants(nodes: CatalogNode[] = PROCESS_CATALOG, trail: Bilingual[] = []): CatalogVariant[] {
  return nodes.flatMap((n) => (n.children ? catalogVariants(n.children, [...trail, n.title]) : [{ id: n.id, path: [...trail, n.title] }]));
}

export const isCatalogVariant = (id: string) => catalogVariants().some((v) => v.id === id);
export const catalogVariant = (id: string) => catalogVariants().find((v) => v.id === id);
export const DEFAULT_CATEGORY = "bafoeg.abroad";
