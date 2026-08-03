import { InventoryEndpoints } from "../../services/api";
import { erpQueryKeys } from "../../app/queryKeys";
import { createFeatureMutations, createFeatureQueries, emptyFeatureComponents, useFeatureQuery } from "../shared";

export const returnsApi = {
  list: InventoryEndpoints.supplierReturns,
  create: InventoryEndpoints.createSupplierReturn,
  dispatch: InventoryEndpoints.dispatchSupplierReturn,
};
export const returnsKeys = erpQueryKeys.returns;
export const returnsQueries = createFeatureQueries(returnsKeys, returnsApi);
export const returnsMutations = createFeatureMutations(returnsKeys, returnsApi);
export const returnsHooks = {
  useList: (filters, options) => useFeatureQuery(returnsQueries.list(filters, options)),
  useCreate: returnsMutations.useCreate,
};
export const returnsComponents = emptyFeatureComponents;
