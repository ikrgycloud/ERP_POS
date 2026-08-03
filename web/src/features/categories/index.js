import { ProductEndpoints } from "../../services/api";
import { erpQueryKeys } from "../../app/queryKeys";
import { createFeatureMutations, createFeatureQueries, emptyFeatureComponents, useFeatureQuery } from "../shared";

export const categoriesApi = {
  list: ProductEndpoints.categories,
  create: ProductEndpoints.createCategory,
};
export const categoriesKeys = erpQueryKeys.categories;
export const categoriesQueries = createFeatureQueries(categoriesKeys, categoriesApi);
export const categoriesMutations = createFeatureMutations(categoriesKeys, categoriesApi);
export const categoriesHooks = {
  useList: (filters, options) => useFeatureQuery(categoriesQueries.list(filters, options)),
  useCreate: categoriesMutations.useCreate,
};
export const categoriesComponents = emptyFeatureComponents;
