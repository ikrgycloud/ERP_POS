import { Invoices, Reports } from '../../lib/api';
import { posQueryKeys } from '../../app/queryKeys';
import { emptyFeatureComponents, useFeatureQuery } from '../shared';

export const paymentsApi = {
  list: Invoices.payments,
  summary: Reports.paymentsSummary,
};
export const paymentsKeys = posQueryKeys.payments;
export const paymentsQueries = {
  byInvoice: (invoiceId, options = {}) => ({
    queryKey: paymentsKeys.detail(options.scope, invoiceId),
    queryFn: ({ signal }) => paymentsApi.list(invoiceId, { ...(options.request || {}), signal }),
    enabled: options.enabled ?? invoiceId != null,
  }),
  summary: (options = {}) => ({
    queryKey: paymentsKeys.auxiliary('summary', options.scope),
    queryFn: ({ signal }) => paymentsApi.summary({ ...(options.request || {}), signal }),
    enabled: options.enabled ?? true,
  }),
};
export const paymentsMutations = {};
export const paymentsHooks = {
  useByInvoice: (invoiceId, options) => useFeatureQuery(paymentsQueries.byInvoice(invoiceId, options)),
  useSummary: (options) => useFeatureQuery(paymentsQueries.summary(options)),
};
export const paymentsComponents = emptyFeatureComponents;
