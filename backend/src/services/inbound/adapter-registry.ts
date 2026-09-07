import { AppError } from '../../utils/AppError';
import type { VendorAdapter } from './types';
import { sampleAdapter } from './adapters/sample.adapter';
import { mobileAccessoriesAdapter } from './adapters/mobile-accessories.adapter';
import { hubbleAdapter } from './adapters/hubble.adapter';

// The in-code registry of inbound vendor adapters. Adding a new vendor = write
// one adapter file and register it here (no migration — VendorSource.adapter is
// a free string keyed to this map).
const ADAPTERS: Record<string, VendorAdapter> = {
  [sampleAdapter.key]: sampleAdapter,
  [mobileAccessoriesAdapter.key]: mobileAccessoriesAdapter,
  [hubbleAdapter.key]: hubbleAdapter,
};

/** Adapter options for the admin dropdown (key + human label). */
export function listAdapters(): { key: string; label: string }[] {
  return Object.values(ADAPTERS).map((a) => ({ key: a.key, label: a.label }));
}

/** All registered adapters — used to auto-provision one VendorSource per adapter. */
export function allAdapters(): VendorAdapter[] {
  return Object.values(ADAPTERS);
}

export function getAdapter(key: string): VendorAdapter {
  const a = ADAPTERS[key];
  if (!a) throw AppError.badRequest(`Unknown vendor adapter: ${key}`);
  return a;
}
