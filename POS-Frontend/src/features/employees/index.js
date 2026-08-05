import { Staff } from '../../lib/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { posQueryKeys } from '../../app/queryKeys';
import { createFeatureMutations, createFeatureQueries, emptyFeatureComponents, useFeatureQuery } from '../shared';

export const employeesApi = {
  list: Staff.list,
  detail: Staff.get,
  create: Staff.create,
  update: Staff.update,
  remove: Staff.remove,
  setStatus: Staff.setStatus,
};
export const employeesKeys = posQueryKeys.employees;
export const employeesQueries = createFeatureQueries(employeesKeys, employeesApi);
export const employeesMutations = createFeatureMutations(employeesKeys, employeesApi);
export const employeesHooks = {
  useList: (filters, options) => useFeatureQuery(employeesQueries.list(filters, options)),
  useDetail: (id, options) => useFeatureQuery(employeesQueries.detail(id, options)),
  useCreate(options = {}) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (payload) => employeesApi.create(payload, options.request),
      onSuccess: (...args) => {
        queryClient.invalidateQueries({ queryKey: employeesKeys.all(options.scope) });
        options.onSuccess?.(...args);
      },
    });
  },
  useUpdate: employeesMutations.useUpdate,
  useRemove: employeesMutations.useRemove,
  useSetStatus(options = {}) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ id, is_active }) => employeesApi.setStatus(id, is_active, options.request),
      onSuccess: (...args) => {
        queryClient.invalidateQueries({ queryKey: employeesKeys.all(options.scope) });
        options.onSuccess?.(...args);
      },
    });
  },
};
export const employeesComponents = emptyFeatureComponents;
