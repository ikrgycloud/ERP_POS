import { DashboardEndpoints } from "../../services/api";
import { erpQueryKeys } from "../../app/queryKeys";
import { createFeatureQueries, emptyFeatureComponents, useFeatureQuery } from "../shared";

export const dashboardApi = {
  list: DashboardEndpoints.summary,
  inventoryValueTimeline: DashboardEndpoints.inventoryValueTimeline,
  inventoryValueReport: DashboardEndpoints.inventoryValueReport,
};
export const dashboardKeys = erpQueryKeys.dashboard;
export const dashboardQueries = createFeatureQueries(dashboardKeys, dashboardApi);
dashboardQueries.inventoryValueTimeline = (filters = {}, options = {}) => ({
  queryKey: dashboardKeys.auxiliary("inventory-value-timeline", options.scope, filters, options.pagination),
  queryFn: ({ signal }) => dashboardApi.inventoryValueTimeline(filters, { ...(options.request || {}), signal }),
  enabled: options.enabled ?? true,
  staleTime: options.staleTime,
  placeholderData: options.placeholderData,
});
dashboardQueries.inventoryValueReport = (filters = {}, options = {}) => ({
  queryKey: dashboardKeys.auxiliary("inventory-value-report", options.scope, filters, options.pagination),
  queryFn: ({ signal }) => dashboardApi.inventoryValueReport(filters, { ...(options.request || {}), signal }),
  enabled: options.enabled ?? true,
  staleTime: options.staleTime,
  placeholderData: options.placeholderData,
});
export const dashboardMutations = {};

export function useDashboard(filters, options) {
  return useFeatureQuery(dashboardQueries.list(filters, options));
}

export function useInventoryValueTimeline(filters, options) {
  return useFeatureQuery(dashboardQueries.inventoryValueTimeline(filters, options));
}
export function useInventoryValueReport(filters, options) {
  return useFeatureQuery(dashboardQueries.inventoryValueReport(filters, options));
}

export const dashboardHooks = {
  useInventoryValueTimeline,
  useInventoryValueReport,
  useSummary: useDashboard,
};
export const dashboardComponents = emptyFeatureComponents;
