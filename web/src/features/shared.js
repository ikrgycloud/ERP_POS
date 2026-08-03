import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

const EMPTY_OBJECT = Object.freeze({});

export function createFeatureQueries(keys, api = {}) {
  return {
    list: (filters = EMPTY_OBJECT, options = EMPTY_OBJECT) => ({
      queryKey: keys.list(options.scope, filters, options.pagination),
      queryFn: ({ signal }) => api.list(filters, { ...(options.request || EMPTY_OBJECT), signal }),
      enabled: options.enabled ?? Boolean(api.list),
      refetchInterval: options.refetchInterval,
      refetchIntervalInBackground: options.refetchIntervalInBackground,
      staleTime: options.staleTime,
      placeholderData: options.placeholderData,
    }),
    detail: (id, options = EMPTY_OBJECT) => ({
      queryKey: keys.detail(options.scope, id),
      queryFn: ({ signal }) => api.detail(id, { ...(options.request || EMPTY_OBJECT), signal }),
      enabled: options.enabled ?? (Boolean(api.detail) && id != null),
      staleTime: options.staleTime,
      placeholderData: options.placeholderData,
    }),
  };
}

export function createFeatureMutations(keys, api = {}, invalidates = []) {
  function invalidate(queryClient, scope, skipAutoInvalidation = false) {
    if (skipAutoInvalidation) {
      return;
    }
    queryClient.invalidateQueries({ queryKey: keys.all(scope) });
    invalidates.forEach((key) => queryClient.invalidateQueries({ queryKey: key }));
  }

  return {
    useCreate(options = EMPTY_OBJECT) {
      const queryClient = useQueryClient();
      return useMutation({
        mutationFn: (variables) => api.create(variables?.payload ?? variables, variables?.idempotencyKey, options.request),
        onSuccess: (...args) => {
          invalidate(queryClient, options.scope, options.skipAutoInvalidation);
          options.onSuccess?.(...args);
        },
      });
    },
    useUpdate(options = EMPTY_OBJECT) {
      const queryClient = useQueryClient();
      return useMutation({
        mutationFn: (variables) => api.update(variables.id, variables.payload, options.request),
        onSuccess: (...args) => {
          invalidate(queryClient, options.scope, options.skipAutoInvalidation);
          options.onSuccess?.(...args);
        },
      });
    },
    useRemove(options = EMPTY_OBJECT) {
      const queryClient = useQueryClient();
      return useMutation({
        mutationFn: (variables) => api.remove(variables.id ?? variables, options.request),
        onSuccess: (...args) => {
          invalidate(queryClient, options.scope, options.skipAutoInvalidation);
          options.onSuccess?.(...args);
        },
      });
    },
  };
}

export function useFeatureQuery(queryOptions) {
  return useQuery(queryOptions);
}

export const emptyFeatureComponents = Object.freeze({});
