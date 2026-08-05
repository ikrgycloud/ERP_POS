import { Catalog } from '../../lib/api';
import { posQueryKeys } from '../../app/queryKeys';
import { createFeatureQueries, emptyFeatureComponents, useFeatureQuery } from '../shared';

export const discountsApi = {
  list: Catalog.products,
};
export const discountsKeys = posQueryKeys.discounts;
export const discountsQueries = createFeatureQueries(discountsKeys, discountsApi);
export const discountsMutations = {};
export const discountsHooks = {
  useProductDiscountSources: (filters, options) => useFeatureQuery(discountsQueries.list(filters, options)),
};
export const discountsComponents = emptyFeatureComponents;
