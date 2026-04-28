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