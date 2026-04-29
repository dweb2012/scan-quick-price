/**
 * Catalogue officiel des emplacements du dépôt CHR Elite.
 * Source de vérité unique : utilisé pour valider, lister et libeller les allées.
 */

export interface AisleZone {
  /** Préfixe du code (A, B, …, R, S, O, Y, X, SW). */
  code: string;
  /** Nom complet affiché à l'utilisateur. */
  name: string;
  /** Plage numérique inclusive. Absente pour les zones mono-emplacement (R, X, SW). */
  range?: [number, number];
  /** Catégorie d'affichage : allée numérotée vs zone spéciale. */
  group: "Allées" | "Zones spéciales";
}

export const AISLE_ZONES: AisleZone[] = [
  { code: "A", name: "Allée A", range: [1, 22], group: "Allées" },
  { code: "B", name: "Allée B", range: [1, 22], group: "Allées" },
  { code: "C", name: "Allée C", range: [1, 22], group: "Allées" },
  { code: "D", name: "Allée D", range: [1, 22], group: "Allées" },
  { code: "E", name: "Allée E", range: [1, 22], group: "Allées" },
  { code: "F", name: "Allée F", range: [1, 20], group: "Allées" },
  { code: "G", name: "Allée G", range: [1, 22], group: "Allées" },
  { code: "H", name: "Allée H", range: [1, 38], group: "Allées" },
  { code: "I", name: "Allée I", range: [1, 18], group: "Allées" },
  { code: "J", name: "Allée J", range: [1, 15], group: "Allées" },
  { code: "R", name: "Retours", group: "Zones spéciales" },
  { code: "S", name: "SAV", range: [1, 4], group: "Zones spéciales" },
  { code: "O", name: "Occasion", range: [1, 8], group: "Zones spéciales" },
  { code: "Y", name: "Déclassé", range: [1, 4], group: "Zones spéciales" },
  { code: "X", name: "Inox", group: "Zones spéciales" },
  { code: "SW", name: "Show Room", group: "Zones spéciales" },
];

export interface AisleEntry {
  /** Code court : "H12", "S2", "X", "SW"… */
  code: string;
  /** Préfixe de zone : "H", "S", "X", "SW"… */
  zoneCode: string;
  /** Nom complet de la zone : "Allée H", "SAV", "Inox"… */
  zoneName: string;
  /** Libellé d'affichage : "H12 (Allée H)" — ou "X (Inox)" pour zones simples. */
  label: string;
  group: "Allées" | "Zones spéciales";
}

let _cache: AisleEntry[] | null = null;

/** Toutes les entrées (213 codes) dans l'ordre du catalogue. Memoization. */
export function expandAisles(): AisleEntry[] {
  if (_cache) return _cache;
  const list: AisleEntry[] = [];
  for (const z of AISLE_ZONES) {
    if (z.range) {
      for (let i = z.range[0]; i <= z.range[1]; i++) {
        const code = `${z.code}${i}`;
        list.push({
          code,
          zoneCode: z.code,
          zoneName: z.name,
          label: `${code} (${z.name})`,
          group: z.group,
        });
      }
    } else {
      list.push({
        code: z.code,
        zoneCode: z.code,
        zoneName: z.name,
        label: `${z.code} (${z.name})`,
        group: z.group,
      });
    }
  }
  _cache = list;
  return list;
}

/** Vérifie qu'un code appartient au catalogue (case-insensitive sur le préfixe). */
export function isValidAisle(code: string | null | undefined): boolean {
  if (!code) return false;
  const c = code.trim().toUpperCase();
  return expandAisles().some((e) => e.code.toUpperCase() === c);
}

/** Récupère l'entrée correspondant à un code, ou null. */
export function getAisleEntry(code: string | null | undefined): AisleEntry | null {
  if (!code) return null;
  const c = code.trim().toUpperCase();
  return expandAisles().find((e) => e.code.toUpperCase() === c) ?? null;
}

/** Libellé "H12 (Allée H)" — retourne juste le code si hors catalogue. */
export function formatAisleLabel(code: string | null | undefined): string {
  if (!code) return "";
  const entry = getAisleEntry(code);
  return entry ? entry.label : code.trim();
}

/** Toutes les entrées regroupées par zone, dans l'ordre du catalogue. */
export function getAisleGroups(): { zoneCode: string; zoneName: string; entries: AisleEntry[] }[] {
  const all = expandAisles();
  const groups: { zoneCode: string; zoneName: string; entries: AisleEntry[] }[] = [];
  for (const z of AISLE_ZONES) {
    groups.push({
      zoneCode: z.code,
      zoneName: z.name,
      entries: all.filter((e) => e.zoneCode === z.code),
    });
  }
  return groups;
}