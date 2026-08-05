import { Catalog } from '../../lib/api';
import { posQueryKeys } from '../../app/queryKeys';
import { createFeatureMutations, createFeatureQueries, emptyFeatureComponents, useFeatureQuery } from '../shared';

export const productsApi = {
  list: Catalog.products,
  detail: Catalog.product,
  create: Catalog.createProduct,
  update: Catalog.updateProduct,
};
export const productsKeys = posQueryKeys.products;
export const productsQueries = createFeatureQueries(productsKeys, productsApi);
export const productsMutations = createFeatureMutations(productsKeys, productsApi);
export const productsHooks = {
  useList: (filters, options) => useFeatureQuery(productsQueries.list(filters, options)),
  useDetail: (id, options) => useFeatureQuery(productsQueries.detail(id, options)),
  useCreate: productsMutations.useCreate,
  useUpdate: productsMutations.useUpdate,
};
export const productsComponents = emptyFeatureComponents;
