import { readFileSync, writeFileSync, existsSync } from 'fs';
import { SeenAuction, SeenAuctionsStore } from './types.js';

const STORAGE_PATH = process.env.STORAGE_PATH || './seen-auctions.json';

export function loadSeenAuctions(): SeenAuctionsStore {
  if (!existsSync(STORAGE_PATH)) {
    return {};
  }
  try {
    const raw = readFileSync(STORAGE_PATH, 'utf-8');
    return JSON.parse(raw) as SeenAuctionsStore;
  } catch {
    console.warn('[Storage] Failed to parse seen-auctions.json, starting fresh');
    return {};
  }
}

export function saveSeenAuctions(store: SeenAuctionsStore): void {
  try {
    writeFileSync(STORAGE_PATH, JSON.stringify(store, null, 2), 'utf-8');
  } catch (err) {
    console.error('[Storage] Failed to write seen-auctions.json:', err);
  }
}

export function markAsSeen(
  store: SeenAuctionsStore,
  auctionAddress: string,
  data: SeenAuction,
): void {
  store[auctionAddress.toLowerCase()] = data;
  saveSeenAuctions(store);
}

export function hasSeen(store: SeenAuctionsStore, auctionAddress: string): boolean {
  return auctionAddress.toLowerCase() in store;
}
