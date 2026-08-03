import { DashboardEndpoints } from "../../services/api";
import { erpQueryKeys } from "../../app/queryKeys";
import { createFeatureQueries, emptyFeatureComponents, useFeatureQuery } from "../shared";

export const reportsApi = { list: DashboardEndpoints.summary };
export const reportsKeys = erpQueryKeys.reports;
export const reportsQueries = createFeatureQueries(reportsKeys, reportsApi);
export const reportsMutations = {};
export const reportsHooks = {
  useDashboardBackedSummary: (filters, options) => useFeatureQuery(reportsQueries.list(filters, options)),
};
export const reportsComponents = emptyFeatureComponents;
