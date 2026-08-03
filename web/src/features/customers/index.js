import { CustomerEndpoints } from "../../services/api";
import { erpQueryKeys } from "../../app/queryKeys";
import { createFeatureMutations, createFeatureQueries, emptyFeatureComponents, useFeatureQuery } from "../shared";

export const customersApi = CustomerEndpoints;
export const customersKeys = erpQueryKeys.customers;
export const customersQueries = createFeatureQueries(customersKeys, {
  list: customersApi.list,
});
export const customersMutations = createFeatureMutations(customersKeys, {
  create: customersApi.create,
  update: customersApi.update,
  remove: customersApi.remove,
});
export const customersHooks = {
  useList: (filters, options) => useFeatureQuery(customersQueries.list(filters, options)),
  useCreate: customersMutations.useCreate,
  useUpdate: customersMutations.useUpdate,
  useRemove: customersMutations.useRemove,
};
export const customersComponents = emptyFeatureComponents;
