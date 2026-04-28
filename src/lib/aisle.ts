const KEY = "chr.activeAisle";
const PREFIX = "CHR-AISLE:";

let listeners: (() => void)[] = [];

export function parseAisleCode(code: string): string | null {
  const trimmed = (code || "").trim();
  if (!trimmed.toUpperCase().startsWith(PREFIX)) return null;
  const value = trimmed.slice(PREFIX.length).trim();
  return value || null;
}

export function getActiveAisle(): string | null {
  try {
    return sessionStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function setActiveAisle(name: string) {
  try {
    sessionStorage.setItem(KEY, name);
  } catch {}
  listeners.forEach((l) => l());
}

export function clearActiveAisle() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {}
  listeners.forEach((l) => l());
}

export function subscribeAisle(listener: () => void) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}

export function buildAisleQrPayload(name: string): string {
  return `${PREFIX}${name.trim()}`;
}

export const AISLE_PREFIX = PREFIX;

const SEPARATOR = " / ";

/**
 * Parse a Dolibarr `options_emplacement` value into aisle + spot.
 * Convention : "<ALLÉE> / <EMPLACEMENT>".
 * - "A1 / Étagère 3"  -> { aisle: "A1", spot: "Étagère 3" }
 * - "A1"              -> { aisle: "A1", spot: null }
 * - "Étagère 3"       -> { aisle: null, spot: "Étagère 3" } (legacy fallback if no separator)
 * Heuristique : si pas de séparateur ET la valeur contient des espaces ou plus de 6
 * caractères, on considère que c'est un emplacement libre (legacy) sans allée.
 * Sinon (court, mono-bloc), on traite comme une allée.
 */
export function parseEmplacement(raw: string | null | undefined): {
  aisle: string | null;
  spot: string | null;
} {
  const value = (raw || "").trim();
  if (!value) return { aisle: null, spot: null };

  const sepIdx = value.indexOf(SEPARATOR);
  if (sepIdx >= 0) {
    const aisle = value.slice(0, sepIdx).trim() || null;
    const spot = value.slice(sepIdx + SEPARATOR.length).trim() || null;
    return { aisle, spot };
  }

  // Legacy fallback : ancien format sans séparateur.
  if (value.length <= 6 && !/\s/.test(value)) {
    return { aisle: value, spot: null };
  }
  return { aisle: null, spot: value };
}

/** Recompose un emplacement Dolibarr depuis allée + spot. */
export function formatEmplacement(
  aisle: string | null | undefined,
  spot: string | null | undefined
): string {
  const a = (aisle || "").trim();
  const s = (spot || "").trim();
  if (a && s) return `${a}${SEPARATOR}${s}`;
  if (a) return a;
  if (s) return s;
  return "";
}