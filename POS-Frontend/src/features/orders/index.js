import { Billing } from '../../lib/api';
import { posQueryKeys } from '../../app/queryKeys';
import { createFeatureMutations, emptyFeatureComponents, useFeatureQuery } from '../shared';

export const ordersApi = {
  activeCart: Billing.activeCart,
  startCart: Billing.startCart,
  cancelCart: Billing.cancelCart,
  voidCart: Billing.voidCart,
};
export const ordersKeys = posQueryKeys.orders;
export const ordersQueries = {
  activeCart: (params = {}, options = {}) => ({
    queryKey: ordersKeys.auxiliary('activeCart', options.scope, params),
    queryFn: ({ signal }) => ordersApi.activeCart(params.inter_state ?? false, { ...(options.request || {}), signal }),
    enabled: options.enabled ?? true,
  }),
};
export const ordersMutations = createFeatureMutations(ordersKeys, {
  create: ordersApi.startCart,
  remove: ordersApi.cancelCart,
});
export const ordersHooks = {
  useActiveCart: (params, options) => useFeatureQuery(ordersQueries.activeCart(params, options)),
  useStartCart: ordersMutations.useCreate,
  useCancelCart: ordersMutations.useRemove,
};
export const ordersComponents = emptyFeatureComponents;
