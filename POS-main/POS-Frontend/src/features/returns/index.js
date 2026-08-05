import { Returns } from '../../lib/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { posQueryKeys } from '../../app/queryKeys';
import { createFeatureMutations, createFeatureQueries, emptyFeatureComponents, useFeatureQuery } from '../shared';

export const returnsApi = {
  list: Returns.list,
  detail: Returns.get,
  create: Returns.submit,
  update: Returns.setStatus,
  lookup: Returns.lookup,
  process: Returns.process,
  evidenceLink: Returns.evidenceLink,
  evidence: Returns.evidence,
};
export const returnsKeys = posQueryKeys.returns;
export const returnsQueries = {
  ...createFeatureQueries(returnsKeys, returnsApi),
  evidence: (returnId, options = {}) => ({
    queryKey: returnsKeys.auxiliary('evidence', options.scope, { returnId }),
    queryFn: ({ signal }) => returnsApi.evidence(returnId, { ...(options.request || {}), signal }),
    enabled: options.enabled ?? returnId != null,
  }),
};
export const returnsMutations = createFeatureMutations(returnsKeys, returnsApi);
function invalidateReturnFlow(queryClient) {
  [
    posQueryKeys.returns,
    posQueryKeys.inventory,
    posQueryKeys.dashboard,
    posQueryKeys.reports,
    posQueryKeys.invoices,
    posQueryKeys.payments,
  ].forEach((keys) => queryClient.invalidateQueries({ queryKey: keys.all() }));
}
export const returnsHooks = {
  useList: (filters, options) => useFeatureQuery(returnsQueries.list(filters, options)),
  useDetail: (id, options) => useFeatureQuery(returnsQueries.detail(id, options)),
  useEvidence: (returnId, options) => useFeatureQuery(returnsQueries.evidence(returnId, options)),
  useCreate(options = {}) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (payload) => returnsApi.create(payload, options.request),
      onSuccess: (...args) => {
        invalidateReturnFlow(queryClient);
        options.onSuccess?.(...args);
      },
    });
  },
  useUpdate(options = {}) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ id, status }) => returnsApi.update(id, status, options.request),
      onSuccess: (...args) => {
        invalidateReturnFlow(queryClient);
        options.onSuccess?.(...args);
      },
    });
  },
  useLookup(options = {}) {
    return useMutation({
      mutationFn: (payload) => returnsApi.lookup(payload, options.request),
      onSuccess: options.onSuccess,
    });
  },
  useProcess(options = {}) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ id, interState = false }) => returnsApi.process(id, interState, options.request),
      onSuccess: (...args) => {
        invalidateReturnFlow(queryClient);
        options.onSuccess?.(...args);
      },
    });
  },
  useEvidenceLink(options = {}) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ id, apiBase }) => returnsApi.evidenceLink(id, apiBase, options.request),
      onSuccess: (...args) => {
        queryClient.invalidateQueries({ queryKey: returnsKeys.all() });
        options.onSuccess?.(...args);
      },
    });
  },
};
export const returnsComponents = emptyFeatureComponents;
