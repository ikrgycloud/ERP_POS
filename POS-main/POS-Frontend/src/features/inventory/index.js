import { Catalog } from '../../lib/api';
import { posQueryKeys } from '../../app/queryKeys';
import { createFeatureMutations, createFeatureQueries, emptyFeatureComponents, useFeatureQuery } from '../shared';

export const inventoryApi = {
  list: Catalog.products,
  lowStock: Catalog.lowStock,
  outOfStock: Catalog.outOfStock,
  damaged: Catalog.damaged,
  stockHistory: Catalog.stockHistory,
  adjustStock: Catalog.adjustStock,
};
export const inventoryKeys = posQueryKeys.inventory;
export const inventoryQueries = {
  ...createFeatureQueries(inventoryKeys, inventoryApi),
  lowStock: (options = {}) => ({
    queryKey: inventoryKeys.auxiliary('lowStock', options.scope),
    queryFn: ({ signal }) => inventoryApi.lowStock({ ...(options.request || {}), signal }),
    enabled: options.enabled ?? true,
  }),
  outOfStock: (options = {}) => ({
    queryKey: inventoryKeys.auxiliary('outOfStock', options.scope),
    queryFn: ({ signal }) => inventoryApi.outOfStock({ ...(options.request || {}), signal }),
    enabled: options.enabled ?? true,
  }),
  damaged: (options = {}) => ({
    queryKey: inventoryKeys.auxiliary('damaged', options.scope),
    queryFn: ({ signal }) => inventoryApi.damaged({ ...(options.request || {}), signal }),
    enabled: options.enabled ?? true,
  }),
};
export const inventoryMutations = createFeatureMutations(inventoryKeys, {
  create: inventoryApi.adjustStock,
});
export const inventoryHooks = {
  useList: (filters, options) => useFeatureQuery(inventoryQueries.list(filters, options)),
  useLowStock: (options) => useFeatureQuery(inventoryQueries.lowStock(options)),
  useOutOfStock: (options) => useFeatureQuery(inventoryQueries.outOfStock(options)),
  useDamaged: (options) => useFeatureQuery(inventoryQueries.damaged(options)),
  useAdjustStock: inventoryMutations.useCreate,
};
export const inventoryComponents = emptyFeatureComponents;
