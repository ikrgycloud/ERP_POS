import { Settings } from '../../lib/api';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { posQueryKeys } from '../../app/queryKeys';
import { emptyFeatureComponents, useFeatureQuery } from '../shared';

export const settingsApi = {
  list: Settings.invoiceBranding,
  update: Settings.updateInvoiceBranding,
};
export const settingsKeys = posQueryKeys.settings;
export const settingsQueries = {
  invoiceBranding: (options = {}) => ({
    queryKey: settingsKeys.auxiliary('invoiceBranding', options.scope),
    queryFn: ({ signal }) => settingsApi.list({ ...(options.request || {}), signal }),
    enabled: options.enabled ?? true,
  }),
};
export const settingsMutations = {};
export const settingsHooks = {
  useInvoiceBranding: (options) => useFeatureQuery(settingsQueries.invoiceBranding(options)),
  useUpdateInvoiceBranding(options = {}) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (payload) => settingsApi.update(payload, options.request),
      onSuccess: (...args) => {
        queryClient.invalidateQueries({ queryKey: settingsKeys.all(options.scope) });
        options.onSuccess?.(...args);
      },
    });
  },
};
export const settingsComponents = emptyFeatureComponents;
