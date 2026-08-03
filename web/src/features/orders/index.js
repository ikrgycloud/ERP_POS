import { OrderEndpoints } from "../../services/api";
import { erpQueryKeys } from "../../app/queryKeys";
import { createFeatureMutations, createFeatureQueries, emptyFeatureComponents, useFeatureQuery } from "../shared";

export const ordersApi = OrderEndpoints;
export const ordersKeys = erpQueryKeys.orders;
export const ordersQueries = createFeatureQueries(ordersKeys, ordersApi);
export const ordersMutations = createFeatureMutations(ordersKeys, ordersApi, [
  erpQueryKeys.dashboard.root,
  erpQueryKeys.inventory.root,
  erpQueryKeys.products.root,
]);

export function useOrders(filters, options) {
  return useFeatureQuery(ordersQueries.list(filters, options));
}

export function useOrder(id, options = {}) {
  const query = useOrders(options.filters, {
    ...options,
    enabled: options.enabled ?? id != null,
    placeholderData: options.placeholderData,
  });
  const order = Array.isArray(query.data)
    ? query.data.find((item) => String(item.id) === String(id))
    : undefined;
  return { ...query, data: order };
}

export const useCreateOrder = ordersMutations.useCreate;
export const useUpdateOrder = ordersMutations.useUpdate;
export const useDeleteOrder = ordersMutations.useRemove;

export const ordersHooks = {
  useList: useOrders,
  useDetail: useOrder,
  useCreate: useCreateOrder,
  useUpdate: useUpdateOrder,
  useRemove: useDeleteOrder,
};
export const ordersComponents = emptyFeatureComponents;
