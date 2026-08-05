import { Catalog } from '../../lib/api';
import { posQueryKeys } from '../../app/queryKeys';
import { createFeatureQueries, emptyFeatureComponents, useFeatureQuery } from '../shared';

export const suppliersApi = { list: Catalog.suppliers };
export const suppliersKeys = posQueryKeys.suppliers;
export const suppliersQueries = createFeatureQueries(suppliersKeys, suppliersApi);
export const suppliersMutations = {};
export const suppliersHooks = {
  useList: (filters, options) => useFeatureQuery(suppliersQueries.list(filters, options)),
};
export const suppliersComponents = emptyFeatureComponents;
