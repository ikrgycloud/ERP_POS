import { DiscountEndpoints } from "../../services/api";
import { erpQueryKeys } from "../../app/queryKeys";
import { createFeatureMutations, createFeatureQueries, emptyFeatureComponents, useFeatureQuery } from "../shared";

export const discountsApi = DiscountEndpoints;
export const discountsKeys = erpQueryKeys.discounts;
export const discountsQueries = createFeatureQueries(discountsKeys, discountsApi);
export const discountsMutations = createFeatureMutations(discountsKeys, discountsApi);
export const discountsHooks = {
  useList: (filters, options) => useFeatureQuery(discountsQueries.list(filters, options)),
  useCreate: discountsMutations.useCreate,
  useUpdate: discountsMutations.useUpdate,
};
export const discountsComponents = emptyFeatureComponents;
