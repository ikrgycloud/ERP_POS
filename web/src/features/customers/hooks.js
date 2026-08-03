import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CustomerEndpoints } from "../../services/api";
import { erpQueryKeys } from "../../app/queryKeys";

const customerScope = (profileId, outletId) => ({ businessProfileId: profileId, outletId });

export function useCustomerList(profileId, outletId, filters = {}) {
  return useQuery({
    queryKey: erpQueryKeys.customers.list(customerScope(profileId, outletId), filters),
    queryFn: ({ signal }) => CustomerEndpoints.list(profileId, outletId, filters, { signal }),
    enabled: Boolean(profileId && outletId),
    staleTime: 30_000,
  });
}

function useCustomerMutation(mutationFn) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: erpQueryKeys.customers.root }),
  });
}

export function useCreateCustomer() {
  return useCustomerMutation(({ profileId, outletId, payload }) => CustomerEndpoints.create(profileId, outletId, payload));
}

export function useUpdateCustomer() {
  return useCustomerMutation(({ profileId, outletId, customerId, payload }) =>
    CustomerEndpoints.update(profileId, outletId, customerId, payload)
  );
}

export function useDeleteCustomer() {
  return useCustomerMutation(({ profileId, outletId, customerId }) => CustomerEndpoints.remove(profileId, outletId, customerId));
}
