import { Catalog } from '../../lib/api';
import { posQueryKeys } from '../../app/queryKeys';
import { createFeatureQueries, emptyFeatureComponents, useFeatureQuery } from '../shared';

export const categoriesApi = { list: Catalog.categories };
export const categoriesKeys = posQueryKeys.categories;
export const categoriesQueries = createFeatureQueries(categoriesKeys, categoriesApi);
export const categoriesMutations = {};
export const categoriesHooks = {
  useList: (filters, options) => useFeatureQuery(categoriesQueries.list(filters, options)),
};
export const categoriesComponents = emptyFeatureComponents;
