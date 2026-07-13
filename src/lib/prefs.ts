// Préférences locales stockées dans localStorage.

const AUTO_SEND_CAS_B_KEY = "prefs:autoSendCasB";

export function getAutoSendCasB(): boolean {
  try {
    return localStorage.getItem(AUTO_SEND_CAS_B_KEY) === "1";
  } catch {
    return false;
  }
}

export function setAutoSendCasB(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_SEND_CAS_B_KEY, enabled ? "1" : "0");
  } catch {
    // ignore
  }
}