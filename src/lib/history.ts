import { DolibarrProduct, getDiscountedPrice, getPriceHT } from "./dolibarr";
import { getActiveAisle } from "./aisle";

export interface HistoryItem {
  id: number;
  label: string;
  ref: string;
  prixPublic: number;
  prixRemise: number | null;
  timestamp: Date;
  aisle?: string | null;
}

const MAX_HISTORY = 20;
let history: HistoryItem[] = [];
let listeners: (() => void)[] = [];

export function addToHistory(product: DolibarrProduct) {
  const discounted = getDiscountedPrice(product);
  const item: HistoryItem = {
    id: product.id,
    label: product.label,
    ref: product.ref,
    prixPublic: getPriceHT(product),
    prixRemise: discounted?.price ?? null,
    timestamp: new Date(),
    aisle: getActiveAisle(),
  };
  history = [item, ...history.filter((h) => h.id !== item.id)].slice(0, MAX_HISTORY);
  listeners.forEach((l) => l());
}

export function getHistory() {
  return history;
}

export function subscribeHistory(listener: () => void) {
  listeners.push(listener);
  return () => {
    listeners = listeners.filter((l) => l !== listener);
  };
}
