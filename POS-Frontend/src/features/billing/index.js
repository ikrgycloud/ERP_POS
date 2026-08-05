import { useCallback } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Billing } from '../../lib/api';
import { posQueryKeys } from '../../app/queryKeys';
import { emptyFeatureComponents, useFeatureQuery } from '../shared';

export const billingApi = {
  activeCart: Billing.activeCart,
  renewLease: Billing.renewLease,
  startCart: Billing.startCart,
  cancelCart: Billing.cancelCart,
  voidCart: Billing.voidCart,
  cleanupExpiredCarts: Billing.cleanupExpiredCarts,
  attachCustomer: Billing.attachCustomer,
  scan: Billing.scan,
  updateLine: Billing.updateLine,
  removeLine: Billing.removeLine,
  totals: Billing.totals,
  checkout: Billing.checkout,
  clearCheckoutAttempt: Billing.clearCheckoutAttempt,
};

export const billingKeys = posQueryKeys.orders;

export const billingQueries = {
  activeCart: (params = {}, options = {}) => ({
    queryKey: billingKeys.auxiliary('activeCart', options.scope, params),
    queryFn: ({ signal }) =>
      billingApi.activeCart(params.inter_state ?? false, { ...(options.request || {}), signal }),
    enabled: options.enabled ?? true,
  }),
  cartTotals: (orderId, params = {}, options = {}) => ({
    queryKey: billingKeys.auxiliary('cartTotals', options.scope, {
      orderId,
      inter_state: params.inter_state ?? false,
    }),
    queryFn: ({ signal }) =>
      billingApi.totals(orderId, params.inter_state ?? false, {
        ...(options.request || {}),
        signal,
      }),
    enabled: options.enabled ?? orderId != null,
  }),
};

function invalidateCart(queryClient) {
  queryClient.invalidateQueries({ queryKey: posQueryKeys.orders.all() });
}

function invalidateCheckout(queryClient) {
  [
    posQueryKeys.orders,
    posQueryKeys.inventory,
    posQueryKeys.dashboard,
    posQueryKeys.invoices,
    posQueryKeys.payments,
    posQueryKeys.reports,
    posQueryKeys.customers,
    posQueryKeys.products,
    posQueryKeys.employees,
  ].forEach((keys) => queryClient.invalidateQueries({ queryKey: keys.all() }));
}

export const billingMutations = {};

export const billingHooks = {
  useActiveCart: (params, options) => useFeatureQuery(billingQueries.activeCart(params, options)),
  useCartTotals: (orderId, params, options) =>
    useFeatureQuery(billingQueries.cartTotals(orderId, params, options)),
  useCartItems(orderId, params, options) {
    const query = useFeatureQuery(billingQueries.cartTotals(orderId, params, options));
    return {
      ...query,
      data: query.data?.lines ?? [],
      cart: query.data,
    };
  },
  useStartCart(options = {}) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (payload = {}) => billingApi.startCart(payload, options.request),
      onSuccess: (...args) => {
        invalidateCart(queryClient);
        options.onSuccess?.(...args);
      },
    });
  },
  useAttachCustomer(options = {}) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ orderId, customerId }) =>
        billingApi.attachCustomer(orderId, customerId, options.request),
      onSuccess: (...args) => {
        invalidateCart(queryClient);
        queryClient.invalidateQueries({ queryKey: posQueryKeys.customers.all() });
        options.onSuccess?.(...args);
      },
    });
  },
  useVoidCart(options = {}) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: (orderId) => billingApi.voidCart(orderId, options.request),
      onSuccess: (...args) => {
        invalidateCart(queryClient);
        options.onSuccess?.(...args);
      },
    });
  },
  useRenewLease(options = {}) {
    return useMutation({
      mutationFn: (orderId) => billingApi.renewLease(orderId, options.request),
      onSuccess: options.onSuccess,
    });
  },
  useScanBarcode(options = {}) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ orderId, barcode, quantity = 1 }) =>
        billingApi.scan(orderId, barcode, quantity, options.request),
      onSuccess: (...args) => {
        invalidateCart(queryClient);
        options.onSuccess?.(...args);
      },
    });
  },
  useUpdateLine(options = {}) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ orderId, itemId, productId, quantity }) =>
        billingApi.updateLine(orderId, itemId, { product_id: productId, quantity }, options.request),
      onSuccess: (...args) => {
        invalidateCart(queryClient);
        options.onSuccess?.(...args);
      },
    });
  },
  useRemoveLine(options = {}) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ orderId, itemId }) => billingApi.removeLine(orderId, itemId, options.request),
      onSuccess: (...args) => {
        invalidateCart(queryClient);
        options.onSuccess?.(...args);
      },
    });
  },
  useCheckout(options = {}) {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: ({ orderId, payload }) => billingApi.checkout(orderId, payload, undefined, options.request),
      onSuccess: (...args) => {
        invalidateCheckout(queryClient);
        options.onSuccess?.(...args);
      },
    });
  },
  useClearCheckoutAttempt() {
    return useCallback((orderId) => billingApi.clearCheckoutAttempt(orderId), []);
  },
};

export const billingComponents = emptyFeatureComponents;
