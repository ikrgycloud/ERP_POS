import { ProductEndpoints } from "../../services/api";
import { erpQueryKeys } from "../../app/queryKeys";
import { createFeatureMutations, createFeatureQueries, emptyFeatureComponents, useFeatureQuery } from "../shared";

export const productsApi = ProductEndpoints;
export const productsKeys = erpQueryKeys.products;
export const productsQueries = createFeatureQueries(productsKeys, {
  list: productsApi.list,
});
export const productsMutations = createFeatureMutations(productsKeys, {
  create: productsApi.create,
  update: productsApi.update,
  remove: productsApi.remove,
});
export const productsHooks = {
  useList: (filters, options) => useFeatureQuery(productsQueries.list(filters, options)),
  // Product API mutations emit a targeted application data-change event. Do
  // not invalidate once here and again in the global listener.
  useCreate: (options = {}) => productsMutations.useCreate({ ...options, skipAutoInvalidation: true }),
  useUpdate: (options = {}) => productsMutations.useUpdate({ ...options, skipAutoInvalidation: true }),
  useRemove: (options = {}) => productsMutations.useRemove({ ...options, skipAutoInvalidation: true }),
};
export const productsComponents = emptyFeatureComponents;
