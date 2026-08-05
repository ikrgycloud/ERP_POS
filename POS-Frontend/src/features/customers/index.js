import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Customers } from '../../lib/api';
import { posQueryKeys } from '../../app/queryKeys';
import { createFeatureMutations, createFeatureQueries, emptyFeatureComponents, useFeatureQuery } from '../shared';

export const customersApi = {
  list: Customers.list,
  byPhone: Customers.byPhone,
  create: Customers.create,
  update: Customers.update,
};
export const customersKeys = posQueryKeys.customers;
export const customersQueries = createFeatureQueries(customersKeys, customersApi);
export const customersMutations = createFeatureMutations(customersKeys, customersApi);
export const customersHooks = {
  useList: (filters, options) => useFeatureQuery(customersQueries.list(filters, options)),
  useByPhone: (phone, options) => useFeatureQuery({
    queryKey: customersKeys.auxiliary('byPhone', options?.scope, { phone }),
    queryFn: ({ signal }) => customersApi.byPhone(phone, { ...(options?.request || {}), signal }),
    enabled: options?.enabled ?? Boolean(phone),
  }),
  useLookupByPhone(options = {}) {
    return useMutation({
      mutationFn: (phone) => customersApi.byPhone(phone, options.request),
      onSuccess: options.onSuccess,
    });
  },
  useCreate(options = {}) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (payload) => customersApi.create(payload, options.request),
      onSuccess: (...args) => {
        queryClient.invalidateQueries({ queryKey: customersKeys.all(options.scope) });
        options.onSuccess?.(...args);
      },
    });
  },
  useUpdate: customersMutations.useUpdate,
};
export const customersComponents = emptyFeatureComponents;
