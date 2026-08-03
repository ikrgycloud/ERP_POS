import { WaybillEndpoints } from "../../services/api";
import { erpQueryKeys } from "../../app/queryKeys";
import { createFeatureMutations, createFeatureQueries, emptyFeatureComponents, useFeatureQuery } from "../shared";

export const waybillsApi = WaybillEndpoints;
export const waybillsKeys = erpQueryKeys.waybills;
export const waybillsQueries = createFeatureQueries(waybillsKeys, waybillsApi);
export const waybillsMutations = createFeatureMutations(waybillsKeys, waybillsApi, [
  erpQueryKeys.reports.root,
  erpQueryKeys.dashboard.root,
]);
export const waybillsHooks = {
  useList: (filters, options) => useFeatureQuery(waybillsQueries.list(filters, options)),
  useUpdate: waybillsMutations.useUpdate,
  useRemove: waybillsMutations.useRemove,
};
export const waybillsComponents = emptyFeatureComponents;
