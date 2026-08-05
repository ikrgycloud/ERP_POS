import { Invoices } from '../../lib/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { posQueryKeys } from '../../app/queryKeys';
import { createFeatureQueries, emptyFeatureComponents, useFeatureQuery } from '../shared';

export const invoicesApi = {
  list: Invoices.list,
  detail: Invoices.get,
  payments: Invoices.payments,
  notifications: Invoices.notifications,
  resendNotification: Invoices.resendNotification,
};
export const invoicesKeys = posQueryKeys.invoices;
export const invoicesQueries = {
  ...createFeatureQueries(invoicesKeys, invoicesApi),
  payments: (invoiceId, options = {}) => ({
    queryKey: invoicesKeys.auxiliary('payments', options.scope, { invoiceId }),
    queryFn: ({ signal }) => invoicesApi.payments(invoiceId, { ...(options.request || {}), signal }),
    enabled: options.enabled ?? invoiceId != null,
  }),
  notifications: (invoiceId, options = {}) => ({
    queryKey: invoicesKeys.auxiliary('notifications', options.scope, { invoiceId }),
    queryFn: ({ signal }) => invoicesApi.notifications(invoiceId, { ...(options.request || {}), signal }),
    enabled: options.enabled ?? invoiceId != null,
  }),
};
export const invoicesMutations = {};
export const invoicesHooks = {
  useList: (filters, options) => useFeatureQuery(invoicesQueries.list(filters, options)),
  useDetail: (id, options) => useFeatureQuery(invoicesQueries.detail(id, options)),
  usePayments: (invoiceId, options) => useFeatureQuery(invoicesQueries.payments(invoiceId, options)),
  useNotifications: (invoiceId, options) => useFeatureQuery(invoicesQueries.notifications(invoiceId, options)),
  useResendNotification(options = {}) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ invoiceId, channel }) =>
        invoicesApi.resendNotification(invoiceId, channel, options.request),
      onSuccess: (_data, variables, ...args) => {
        queryClient.invalidateQueries({
          queryKey: invoicesKeys.auxiliary('notifications', options.scope, {
            invoiceId: variables.invoiceId,
          }),
        });
        options.onSuccess?.(_data, variables, ...args);
      },
    });
  },
};
export const invoicesComponents = emptyFeatureComponents;
