import { STORE, compactLabel } from './appConfig';

export const STORE_CONFIG = STORE;

export function storeFromApi(settings) {
  return {
    ...STORE_CONFIG,
    ...(settings || {}),
  };
}

export function storeFromBranding(branding) {
  return {
    ...STORE_CONFIG,
    name: branding?.company_name || STORE_CONFIG.name,
  };
}

export function storeBranchLabel(store = STORE_CONFIG) {
  return compactLabel([store.branch, store.register]);
}

export function storeAddressLabel(store = STORE_CONFIG) {
  return compactLabel([store.address, store.city], ', ');
}

export function storeGstinLabel(store = STORE_CONFIG) {
  return store.gstin ? `GSTIN ${store.gstin}` : '';
}
