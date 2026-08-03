import { useMutation, useQueryClient } from "@tanstack/react-query";
import { InvoiceEndpoints } from "../../services/api";
import { erpQueryKeys } from "../../app/queryKeys";
import { createFeatureQueries, emptyFeatureComponents, useFeatureQuery } from "../shared";

export const invoicesApi = InvoiceEndpoints;
export const invoicesKeys = erpQueryKeys.invoices;
export const invoicesQueries = createFeatureQueries(invoicesKeys, invoicesApi);

function invalidateInvoiceDomains(queryClient, scope) {
  queryClient.invalidateQueries({ queryKey: invoicesKeys.all(scope) });
  queryClient.invalidateQueries({ queryKey: erpQueryKeys.dashboard.root });
  queryClient.invalidateQueries({ queryKey: erpQueryKeys.payments.root });
  queryClient.invalidateQueries({ queryKey: erpQueryKeys.inventory.root });
  queryClient.invalidateQueries({ queryKey: erpQueryKeys.products.root });
  queryClient.invalidateQueries({ queryKey: erpQueryKeys.waybills.root });
}

function useInvoiceMutation(mutationFn, options = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (...args) => {
      invalidateInvoiceDomains(queryClient, options.scope);
      options.onSuccess?.(...args);
    },
  });
}

export function useInvoices(filters, options) {
  return useFeatureQuery(invoicesQueries.list(filters, options));
}

export function useInvoice(id, options = {}) {
  const query = useInvoices(options.filters, {
    ...options,
    enabled: options.enabled ?? id != null,
    placeholderData: options.placeholderData,
  });
  const invoice = Array.isArray(query.data)
    ? query.data.find((item) => String(item.id) === String(id))
    : undefined;
  return { ...query, data: invoice };
}

export function useCreateInvoice(options = {}) {
  return useInvoiceMutation((variables) => invoicesApi.create(variables?.payload ?? variables, options.request), options);
}

export function useUpdateInvoice(options = {}) {
  return useInvoiceMutation((variables) => invoicesApi.update(variables.id, variables.payload, options.request), options);
}

export function useDeleteInvoice(options = {}) {
  return useInvoiceMutation((variables) => invoicesApi.remove(variables.id ?? variables, options.request), options);
}

export function useGenerateInvoice(options = {}) {
  return useInvoiceMutation(
    (variables) => invoicesApi.generate(variables?.payload ?? variables, variables?.idempotencyKey, options.request),
    options
  );
}

export function useReverseInvoice(options = {}) {
  return useInvoiceMutation((variables) => invoicesApi.reverse(variables.id, variables.payload, options.request), options);
}

export function useApproveReverseInvoice(options = {}) {
  return useInvoiceMutation((variables) => invoicesApi.approveReverse(variables.id ?? variables, options.request), options);
}

export function useCreateInvoicePayment(options = {}) {
  return useInvoiceMutation(
    (variables) => invoicesApi.createPayment(variables.id, variables.payload, variables.idempotencyKey, options.request),
    options
  );
}

export function useReverseInvoicePayment(options = {}) {
  return useInvoiceMutation(
    (variables) => invoicesApi.reversePayment(variables.id ?? variables, variables?.idempotencyKey, options.request),
    options
  );
}

export const invoicesHooks = {
  useList: useInvoices,
  useDetail: useInvoice,
  useCreate: useCreateInvoice,
  useUpdate: useUpdateInvoice,
  useRemove: useDeleteInvoice,
  useGenerate: useGenerateInvoice,
  useReverse: useReverseInvoice,
  useApproveReverse: useApproveReverseInvoice,
  useCreatePayment: useCreateInvoicePayment,
  useReversePayment: useReverseInvoicePayment,
};
export const invoicesComponents = emptyFeatureComponents;
