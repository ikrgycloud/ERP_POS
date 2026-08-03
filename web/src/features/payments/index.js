import { InvoiceEndpoints } from "../../services/api";
import { erpQueryKeys } from "../../app/queryKeys";
import { createFeatureMutations, emptyFeatureComponents, useFeatureQuery } from "../shared";

export const paymentsApi = {
  list: InvoiceEndpoints.payments,
  create: InvoiceEndpoints.createPayment,
  remove: InvoiceEndpoints.reversePayment,
};
export const paymentsKeys = erpQueryKeys.payments;
export const paymentsQueries = {
  byInvoice: (invoiceId, options = {}) => ({
    queryKey: paymentsKeys.detail(options.scope, invoiceId),
    queryFn: ({ signal }) => paymentsApi.list(invoiceId, { ...(options.request || {}), signal }),
    enabled: options.enabled ?? invoiceId != null,
  }),
};
export const paymentsMutations = createFeatureMutations(paymentsKeys, paymentsApi);
export const paymentsHooks = {
  useByInvoice: (invoiceId, options) => useFeatureQuery(paymentsQueries.byInvoice(invoiceId, options)),
  useCreate: paymentsMutations.useCreate,
  useRemove: paymentsMutations.useRemove,
};
export const paymentsComponents = emptyFeatureComponents;
