import { useMutation, useQueryClient } from "@tanstack/react-query";
import { InventoryEndpoints, ProductEndpoints } from "../../services/api";
import { erpQueryKeys } from "../../app/queryKeys";
import { createFeatureQueries, emptyFeatureComponents, useFeatureQuery } from "../shared";

export const inventoryApi = {
  list: InventoryEndpoints.products,
  damaged: InventoryEndpoints.damaged,
  supplierReturns: InventoryEndpoints.supplierReturns,
  createSupplierReturn: InventoryEndpoints.createSupplierReturn,
  dispatchSupplierReturn: InventoryEndpoints.dispatchSupplierReturn,
  resendSupplierReturnNotification: InventoryEndpoints.resendSupplierReturnNotification,
  inventoryValue: ProductEndpoints.inventoryValue,
};
export const inventoryKeys = erpQueryKeys.inventory;
export const inventoryQueries = {
  ...createFeatureQueries(inventoryKeys, inventoryApi),
  damaged: (filters = {}, options = {}) => ({
    queryKey: inventoryKeys.auxiliary("damaged", options.scope, filters),
    queryFn: ({ signal }) => inventoryApi.damaged(filters, { ...(options.request || {}), signal }),
    enabled: options.enabled ?? true,
  }),
  supplierReturns: (filters = {}, options = {}) => ({
    queryKey: inventoryKeys.auxiliary("supplierReturns", options.scope, filters),
    queryFn: ({ signal }) => inventoryApi.supplierReturns(filters, { ...(options.request || {}), signal }),
    enabled: options.enabled ?? true,
  }),
  inventoryValue: (productId, date, options = {}) => ({
    queryKey: inventoryKeys.auxiliary("inventoryValue", options.scope, { productId, date }),
    queryFn: ({ signal }) => inventoryApi.inventoryValue(productId, date, { ...(options.request || {}), signal }),
    enabled: options.enabled ?? productId != null,
  }),
};

function invalidateInventoryDomains(queryClient) {
  queryClient.invalidateQueries({ queryKey: inventoryKeys.root });
  queryClient.invalidateQueries({ queryKey: erpQueryKeys.products.root });
  queryClient.invalidateQueries({ queryKey: erpQueryKeys.dashboard.root });
}

function useInventoryMutation(mutationFn, options = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: (...args) => {
      invalidateInventoryDomains(queryClient);
      options.onSuccess?.(...args);
    },
  });
}

export function useInventory(filters, options) {
  return useFeatureQuery(inventoryQueries.list(filters, options));
}

export function useInventoryItem(id, options = {}) {
  const query = useInventory(options.filters, {
    ...options,
    enabled: options.enabled ?? id != null,
    placeholderData: options.placeholderData,
  });
  const item = Array.isArray(query.data)
    ? query.data.find((record) => String(record.id) === String(id))
    : undefined;
  return { ...query, data: item };
}

export function useStockMovements(productId, date, options) {
  return useFeatureQuery(inventoryQueries.inventoryValue(productId, date, options));
}

export function useInventoryAdjustments(options = {}) {
  return useInventoryMutation(() => Promise.reject(new Error("Inventory adjustment endpoint is not available.")), options);
}

export function useInventorySummary(filters, options) {
  return useInventory(filters, options);
}

export function useDamagedInventory(filters, options) {
  return useFeatureQuery(inventoryQueries.damaged(filters, options));
}

export function useSupplierReturns(filters, options) {
  return useFeatureQuery(inventoryQueries.supplierReturns(filters, options));
}

export function useCreateSupplierReturn(options = {}) {
  return useInventoryMutation((variables) => inventoryApi.createSupplierReturn(variables?.payload ?? variables, options.request), options);
}

export function useDispatchSupplierReturn(options = {}) {
  return useInventoryMutation((variables) => inventoryApi.dispatchSupplierReturn(variables.id, variables.payload, options.request), options);
}

export function useResendSupplierReturnNotification(options = {}) {
  return useInventoryMutation(
    (variables) =>
      inventoryApi.resendSupplierReturnNotification(variables.id, variables.phase, variables.channel, options.request),
    options
  );
}

export const inventoryHooks = {
  useList: useInventory,
  useDetail: useInventoryItem,
  useStockMovements,
  useAdjustments: useInventoryAdjustments,
  useSummary: useInventorySummary,
  useDamaged: useDamagedInventory,
  useSupplierReturns,
  useCreateSupplierReturn,
  useDispatchSupplierReturn,
  useResendSupplierReturnNotification,
};
export const inventoryComponents = emptyFeatureComponents;
