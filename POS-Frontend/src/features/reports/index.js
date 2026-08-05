import { Reports } from '../../lib/api';
import { posQueryKeys } from '../../app/queryKeys';
import { createFeatureQueries, emptyFeatureComponents, useFeatureQuery } from '../shared';

export const reportsApi = {
  list: Reports.returns,
  revenue: Reports.revenue,
  payments: Reports.payments,
  paymentsSummary: Reports.paymentsSummary,
  productInsights: Reports.productInsights,
  returnSummary: Reports.returnSummary,
  returnTrends: Reports.returnTrends,
  returnBreakdowns: Reports.returnBreakdowns,
  returnTable: Reports.returnTable,
  returnInsights: Reports.returnInsights,
  returnInventory: Reports.returnInventory,
};
export const reportsKeys = posQueryKeys.reports;
export const reportsQueries = {
  ...createFeatureQueries(reportsKeys, reportsApi),
  revenue: (options = {}) => ({
    queryKey: reportsKeys.auxiliary('revenue', options.scope),
    queryFn: ({ signal }) => reportsApi.revenue({ ...(options.request || {}), signal }),
    enabled: options.enabled ?? true,
  }),
  payments: (options = {}) => ({
    queryKey: reportsKeys.auxiliary('payments', options.scope),
    queryFn: ({ signal }) => reportsApi.payments({ ...(options.request || {}), signal }),
    enabled: options.enabled ?? true,
  }),
  paymentsSummary: (options = {}) => ({
    queryKey: reportsKeys.auxiliary('paymentsSummary', options.scope),
    queryFn: ({ signal }) => reportsApi.paymentsSummary({ ...(options.request || {}), signal }),
    enabled: options.enabled ?? true,
  }),
  productInsights: (filters = {}, options = {}) => ({
    queryKey: reportsKeys.auxiliary('productInsights', options.scope, filters),
    queryFn: ({ signal }) => reportsApi.productInsights(filters, { ...(options.request || {}), signal }),
    enabled: options.enabled ?? true,
  }),
  returnSummary: (filters = {}, options = {}) => ({
    queryKey: reportsKeys.auxiliary('returnSummary', options.scope, filters),
    queryFn: ({ signal }) => reportsApi.returnSummary(filters, { ...(options.request || {}), signal }),
    enabled: options.enabled ?? true,
  }),
  returnTrends: (filters = {}, options = {}) => ({
    queryKey: reportsKeys.auxiliary('returnTrends', options.scope, filters),
    queryFn: ({ signal }) => reportsApi.returnTrends(filters, { ...(options.request || {}), signal }),
    enabled: options.enabled ?? true,
  }),
  returnBreakdowns: (filters = {}, options = {}) => ({
    queryKey: reportsKeys.auxiliary('returnBreakdowns', options.scope, filters),
    queryFn: ({ signal }) => reportsApi.returnBreakdowns(filters, { ...(options.request || {}), signal }),
    enabled: options.enabled ?? true,
  }),
  returnTable: (filters = {}, options = {}) => ({
    queryKey: reportsKeys.auxiliary('returnTable', options.scope, filters),
    queryFn: ({ signal }) => reportsApi.returnTable(filters, { ...(options.request || {}), signal }),
    enabled: options.enabled ?? true,
  }),
  returnInsights: (filters = {}, options = {}) => ({
    queryKey: reportsKeys.auxiliary('returnInsights', options.scope, filters),
    queryFn: ({ signal }) => reportsApi.returnInsights(filters, { ...(options.request || {}), signal }),
    enabled: options.enabled ?? true,
  }),
  returnInventory: (filters = {}, options = {}) => ({
    queryKey: reportsKeys.auxiliary('returnInventory', options.scope, filters),
    queryFn: ({ signal }) => reportsApi.returnInventory(filters, { ...(options.request || {}), signal }),
    enabled: options.enabled ?? true,
  }),
};
export const reportsMutations = {};
export const reportsHooks = {
  useReturns: (filters, options) => useFeatureQuery(reportsQueries.list(filters, options)),
  useRevenue: (options) => useFeatureQuery(reportsQueries.revenue(options)),
  usePayments: (options) => useFeatureQuery(reportsQueries.payments(options)),
  usePaymentsSummary: (options) => useFeatureQuery(reportsQueries.paymentsSummary(options)),
  useProductInsights: (filters, options) => useFeatureQuery(reportsQueries.productInsights(filters, options)),
  useReturnSummary: (filters, options) => useFeatureQuery(reportsQueries.returnSummary(filters, options)),
  useReturnTrends: (filters, options) => useFeatureQuery(reportsQueries.returnTrends(filters, options)),
  useReturnBreakdowns: (filters, options) => useFeatureQuery(reportsQueries.returnBreakdowns(filters, options)),
  useReturnTable: (filters, options) => useFeatureQuery(reportsQueries.returnTable(filters, options)),
  useReturnInsights: (filters, options) => useFeatureQuery(reportsQueries.returnInsights(filters, options)),
  useReturnInventory: (filters, options) => useFeatureQuery(reportsQueries.returnInventory(filters, options)),
};
export const reportsComponents = emptyFeatureComponents;
