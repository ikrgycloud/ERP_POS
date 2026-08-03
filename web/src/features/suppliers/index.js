import { ProductEndpoints } from "../../services/api";
import { erpQueryKeys } from "../../app/queryKeys";
import { createFeatureQueries, emptyFeatureComponents, useFeatureQuery } from "../shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";

export const suppliersApi = {
  list: ProductEndpoints.suppliers,
  create: ProductEndpoints.createSupplier,
  update: ProductEndpoints.updateSupplier,
};
export const suppliersKeys = erpQueryKeys.suppliers;
export const suppliersQueries = createFeatureQueries(suppliersKeys, suppliersApi);

function invalidateSuppliers(queryClient) {
  queryClient.invalidateQueries({ queryKey: suppliersKeys.root });
}

export function useSuppliers(filters, options) {
  return useFeatureQuery(suppliersQueries.list(filters, options));
}

export function useSupplier(id, options = {}) {
  const query = useSuppliers(options.filters, {
    ...options,
    enabled: options.enabled ?? id != null,
  });
  const supplier = Array.isArray(query.data)
    ? query.data.find((item) => String(item.id) === String(id))
    : undefined;
  return { ...query, data: supplier };
}

export function useCreateSupplier(options = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables) => suppliersApi.create(variables?.payload ?? variables, options.request),
    onSuccess: (...args) => {
      invalidateSuppliers(queryClient);
      options.onSuccess?.(...args);
    },
  });
}

export function useUpdateSupplier(options = {}) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (variables) => suppliersApi.update(variables.id, variables.payload, options.request),
    onSuccess: (...args) => {
      invalidateSuppliers(queryClient);
      options.onSuccess?.(...args);
    },
  });
}

export function useDeleteSupplier() {
  return useMutation({
    mutationFn: () => Promise.reject(new Error("Supplier delete endpoint is not available.")),
  });
}

export const suppliersMutations = {
  useCreate: useCreateSupplier,
  useUpdate: useUpdateSupplier,
  useRemove: useDeleteSupplier,
};

export const suppliersHooks = {
  useList: useSuppliers,
  useDetail: useSupplier,
  useCreate: useCreateSupplier,
  useUpdate: useUpdateSupplier,
  useRemove: useDeleteSupplier,
};
export const suppliersComponents = emptyFeatureComponents;
