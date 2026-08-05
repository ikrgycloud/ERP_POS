import { useCallback, useEffect, useRef, useState } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import { useQueryClient } from '@tanstack/react-query';
import {
  ApiError,
  EnterprisePOS,
  isNetworkError,
} from '../lib/api';
import { billingHooks, billingQueries } from '../features/billing';
import { customersHooks } from '../features/customers';
import { invoicesHooks, invoicesQueries } from '../features/invoices';
import { settingsHooks } from '../features/settings';
import { money, rupees, qty as fmtQty, pct as fmtPct, methodLabel, dateStr } from '../lib/format';
import { useToast } from '../components/Toast';
import { Page } from '../components/Shell';
import { useAuth } from '../lib/auth';
import { ROLES } from '../lib/auth';
import {
  STORE_CONFIG,
  storeFromBranding,
  storeAddressLabel,
  storeBranchLabel,
  storeGstinLabel,
} from '../config/storeConfig';
import {
  Panel,
  Button,
  Input,
  Pill,
  Spinner,
  Empty,
  ErrorBox,
  Divider,
  ConfirmModal,
} from '../components/ui';
import { IconCheck, IconPhone, IconPlus, IconSearch, IconUser } from '../components/Icons';

const METHODS = [
  ['cash', 'Cash'],
  ['upi', 'UPI'],
  ['card', 'Card'],
  ['cheque', 'Cheque'],
  ['split', 'Split'],
];

const RECEIPT_TEMPLATES = [
  ['a4', 'A4'],
  ['thermal', 'Thermal'],
  ['compact', 'Compact'],
];

const EMPTY_TOTALS = {
  subtotal: '0.00',
  discount: '0.00',
  taxable_value: '0.00',
  cgst: '0.00',
  sgst: '0.00',
  igst: '0.00',
  grand_total: '0.00',
};

function emptyCartView(order) {
  return {
    order_id: order?.order_id,
    order_number: order?.order_number,
    lines: [],
    totals: EMPTY_TOTALS,
  };
}

const BILLING_DRAFT_KEY = 'pos.billing.draft';
const LEGACY_OFFLINE_KEYS = ['pos.billing.offline.v1', 'pos.billing.offline.products.v1'];
const CART_REPRICE_INTERVAL_MS = 5000;
const BILLING_DEBUG =
  import.meta.env.DEV || String(import.meta.env.VITE_DEBUG_BILLING || '').toLowerCase() === 'true';

function logBillingLifecycle(message, details) {
  if (!BILLING_DEBUG) return;
  if (details === undefined) console.log(`[Billing] ${message}`);
  else console.log(`[Billing] ${message}`, details);
}

function isStaleCartError(err) {
  const message = err?.message || '';
  return (
    err?.code === 'CART_NOT_EDITABLE' ||
    (err?.status === 409 && /cart is no longer editable/i.test(message)) ||
    /cart is no longer editable/i.test(message)
  );
}

function isLeaseConflict(err) {
  return err?.status === 409 && err?.code === 'CART_LEASE_HELD';
}

function isRetryableStartupError(err) {
  return isNetworkError(err) || err?.status === 429 || err?.status >= 500;
}

function transactionErrorMessage(err, fallback = 'Transaction failed') {
  const message = err?.message || fallback;
  if (err?.code === 'CANCELLED') return 'Request was cancelled. No transaction was completed.';
  if (err?.code === 'TIMEOUT') return 'Request timed out. Check invoice history before retrying.';
  if (isNetworkError(err)) return 'Offline or network unavailable. No confirmed server response was received.';
  if (err?.status === 401) return 'Session expired. Please login again before continuing billing.';
  if (err?.status === 403) return 'You do not have permission to perform this billing action.';
  if (err?.status === 409) {
    if (/stock|inventory/i.test(message)) return message;
    if (/duplicate|idempot/i.test(message)) return 'Duplicate checkout detected. Check invoice history before retrying.';
    return message;
  }
  if (err?.status === 422) return message;
  if (err?.status >= 500) return 'Server could not complete the transaction. Check invoice history before retrying.';
  return message;
}

function leaseConflictDetails(err) {
  return err?.detail?.details || {};
}

function readBillingDraft() {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.sessionStorage.getItem(BILLING_DRAFT_KEY);
    if (!raw) return null;
    const draft = JSON.parse(raw);
    if (!draft?.order?.order_id) return null;
    return draft;
  } catch {
    return null;
  }
}

function writeBillingDraft(draft) {
  if (typeof window === 'undefined' || !draft?.order?.order_id) return;
  try {
    window.sessionStorage.setItem(
      BILLING_DRAFT_KEY,
      JSON.stringify({
        order: draft.order,
        customer: draft.customer ?? null,
        interState: Boolean(draft.interState),
        method: draft.method || 'cash',
      }),
    );
  } catch {
    // Losing the draft cache should not block billing.
  }
}

function clearBillingDraft() {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(BILLING_DRAFT_KEY);
  } catch {
    // Ignore storage failures.
  }
}

function clearLegacyOfflineBilling() {
  if (typeof window === 'undefined') return;
  try {
    for (const key of LEGACY_OFFLINE_KEYS) window.localStorage.removeItem(key);
  } catch {
    // Ignore storage failures.
  }
}

function absoluteInvoiceUrl(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (typeof window === 'undefined') return url;
  return new URL(url, window.location.origin).toString();
}

export default function BillingPage() {
  const toast = useToast();
  const { authReady, hasToken, user } = useAuth();
  const queryClient = useQueryClient();
  const scanRef = useRef(null);
  const retryTimerRef = useRef(null);
  const startupRef = useRef(false);
  const startupPromiseRef = useRef(null);
  const startupLoopRef = useRef(false);
  const cartRefreshInFlightRef = useRef(null);
  const lastStartupErrorRef = useRef(null);
  const scannerBufferRef = useRef({ value: '', lastAt: 0, timer: null });
  const savedDraftRef = useRef(undefined);
  if (savedDraftRef.current === undefined) {
    savedDraftRef.current = readBillingDraft();
  }
  const savedDraft = savedDraftRef.current;

  const [order, setOrder] = useState(null); // {order_id, order_number}
  const [cart, setCart] = useState(null);         // CartView from /totals
  const [barcode, setBarcode] = useState('');
  const [interState, setInterState] = useState(() => Boolean(savedDraft?.interState));
  const [method, setMethod] = useState(() => savedDraft?.method || 'cash');
  const [cashReceived, setCashReceived] = useState('');
  const [upiReference, setUpiReference] = useState('');
  const [cardReference, setCardReference] = useState('');
  const [chequeReference, setChequeReference] = useState('');
  const [allowPartial, setAllowPartial] = useState(false);
  const [splitPayments, setSplitPayments] = useState([
    { method: 'cash', amount: '', reference_no: '' },
    { method: 'upi', amount: '', reference_no: '' },
  ]);
  const [customer, setCustomer] = useState(() => savedDraft?.customer ?? null);
  const [phone, setPhone] = useState('');
  const [newCustomerPhone, setNewCustomerPhone] = useState('');
  const [newCustomerName, setNewCustomerName] = useState('');
  const [addingCustomer, setAddingCustomer] = useState(false);
  const [findingCustomer, setFindingCustomer] = useState(false);
  const [customerSearchDone, setCustomerSearchDone] = useState(false);
  const [customerErrors, setCustomerErrors] = useState({});

  const [starting, setStarting] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [busyLine, setBusyLine] = useState(null);  // order_item_id being mutated
  const [confirmLine, setConfirmLine] = useState(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const [receipt, setReceipt] = useState(null);    // invoice after checkout
  const [branding, setBranding] = useState(null);
  const [initError, setInitError] = useState(null);
  const [retryingIn, setRetryingIn] = useState(null);
  const [leaseRetrySeconds, setLeaseRetrySeconds] = useState(null);
  const [receiptTemplate, setReceiptTemplate] = useState('thermal');
  const [cashierMode, setCashierMode] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [previewInvoice, setPreviewInvoice] = useState(null);
  const [enterpriseOpen, setEnterpriseOpen] = useState(false);
  const [timeline, setTimeline] = useState([]);
  const [approvals, setApprovals] = useState([]);
  const [shift, setShift] = useState(null);
  const [enterpriseLoading, setEnterpriseLoading] = useState(false);
  const [approvalType, setApprovalType] = useState('discount');
  const [approvalReason, setApprovalReason] = useState('');
  const [openingCash, setOpeningCash] = useState('');
  const [closingCash, setClosingCash] = useState('');
  const [drawerAmount, setDrawerAmount] = useState('');
  const [drawerReason, setDrawerReason] = useState('');
  const invoiceHistory = invoicesHooks.useList({ limit: 12 }, { enabled: authReady && hasToken && historyOpen });
  const brandingQuery = settingsHooks.useInvoiceBranding({ enabled: authReady && hasToken });
  const activeCartQuery = billingHooks.useActiveCart(
    { inter_state: interState },
    { enabled: false },
  );
  const cartTotalsQuery = billingHooks.useCartTotals(
    order?.order_id,
    { inter_state: interState },
    { enabled: false },
  );
  const startCartMutation = billingHooks.useStartCart();
  const attachCustomerMutation = billingHooks.useAttachCustomer();
  const voidCartMutation = billingHooks.useVoidCart();
  const renewLeaseMutation = billingHooks.useRenewLease();
  const scanMutation = billingHooks.useScanBarcode();
  const updateLineMutation = billingHooks.useUpdateLine();
  const removeLineMutation = billingHooks.useRemoveLine();
  const checkoutMutation = billingHooks.useCheckout();
  const clearCheckoutAttempt = billingHooks.useClearCheckoutAttempt();
  const createCustomerMutation = customersHooks.useCreate();
  const lookupCustomerMutation = customersHooks.useLookupByPhone();

  const lines = cart?.lines ?? [];
  const totals = cart?.totals ?? EMPTY_TOTALS;
  const store = branding ? storeFromBranding(branding) : STORE_CONFIG;
  useEffect(() => {
    clearLegacyOfflineBilling();
  }, []);

  useEffect(() => {
    setBranding(brandingQuery.data ?? null);
  }, [brandingQuery.data]);

  useEffect(() => {
    setHistory(Array.isArray(invoiceHistory.data) ? invoiceHistory.data : []);
    setHistoryLoading(invoiceHistory.isFetching);
    setHistoryError(invoiceHistory.error?.message || '');
  }, [invoiceHistory.data, invoiceHistory.error, invoiceHistory.isFetching]);

  const loadInvoiceHistory = useCallback(async () => {
    if (!authReady || !hasToken) return;
    await invoiceHistory.refetch();
  }, [authReady, hasToken, invoiceHistory]);

  const loadEnterpriseControls = useCallback(async () => {
    if (!authReady || !hasToken) return;
    setEnterpriseLoading(true);
    try {
      const [active, approvalRows, timelineRows] = await Promise.all([
        EnterprisePOS.activeShift(),
        EnterprisePOS.approvals({ status: 'pending' }),
        EnterprisePOS.timeline({ limit: 40 }),
      ]);
      setShift(active);
      setApprovals(Array.isArray(approvalRows) ? approvalRows : []);
      setTimeline(Array.isArray(timelineRows) ? timelineRows : []);
    } catch (err) {
      toast.error(transactionErrorMessage(err));
    } finally {
      setEnterpriseLoading(false);
    }
  }, [authReady, hasToken, toast]);

  useEffect(() => {
    if (!authReady || !hasToken) return;
    EnterprisePOS.activeShift().then(setShift).catch(() => {});
  }, [authReady, hasToken]);

  useEffect(() => {
    if (historyOpen) loadInvoiceHistory();
  }, [historyOpen, loadInvoiceHistory]);

  useEffect(() => {
    if (enterpriseOpen) loadEnterpriseControls();
  }, [enterpriseOpen, loadEnterpriseControls]);

  /* ---------------------------------------------------------------- cart */
  const fetchCartTotals = useCallback(
    async (orderId, inter = interState) => {
      const result =
        order?.order_id === orderId
          ? await cartTotalsQuery.refetch()
          : {
              data: await queryClient.fetchQuery(
                billingQueries.cartTotals(orderId, { inter_state: inter }, { enabled: true }),
              ),
            };
      const view =
        result.data ??
        (await queryClient.fetchQuery(
          billingQueries.cartTotals(orderId, { inter_state: inter }, { enabled: true }),
        ));
      setCart(view);
      return view;
    },
    [cartTotalsQuery, interState, order?.order_id, queryClient],
  );

  const newCart = useCallback(
    async (customerId = null, { quiet = false } = {}) => {
      if (!authReady || !hasToken) return null;
      if (startupPromiseRef.current) {
        logBillingLifecycle('Startup already pending; joining existing request');
        return startupPromiseRef.current;
      }
      startupRef.current = true;
      startupPromiseRef.current = (async () => {
        clearBillingDraft();
        setCart(null);
        setStarting(true);
        setInitError(null);
        setLeaseRetrySeconds(null);
        setRetryingIn(null);
        try {
          logBillingLifecycle('Fetching active cart');
          const activeResult = await activeCartQuery.refetch();
          const active = activeResult.data;
          logBillingLifecycle('Active cart fetch completed', { hasActiveCart: Boolean(active) });
          let o = active
            ? { order_id: active.order_id, order_number: active.order_number }
            : await startCartMutation.mutateAsync(customerId ? { customer_id: customerId } : {});
          if (active && customerId) {
            await attachCustomerMutation.mutateAsync({
              orderId: active.order_id,
              customerId,
            });
            const refreshed = await queryClient.fetchQuery(
              billingQueries.cartTotals(
                active.order_id,
                { inter_state: interState },
                { enabled: true },
              ),
            );
            o = { order_id: refreshed.order_id, order_number: refreshed.order_number };
            setCart(refreshed);
          }
          setOrder(o);
          lastStartupErrorRef.current = null;
          setReceipt(null);
          if (!active) setCart(emptyCartView(o));
          else if (!customerId) setCart(active);
          setStarting(false);
          if (!active) fetchCartTotals(o.order_id).catch(() => {});
          setTimeout(() => scanRef.current?.focus(), 40);
          return o;
        } catch (e) {
          logBillingLifecycle(e?.code === 'TIMEOUT' ? 'Fetch aborted by timeout' : 'Startup fetch failed', e);
          lastStartupErrorRef.current = e;
          setInitError(e);
          if (isLeaseConflict(e)) {
            const seconds = Number(leaseConflictDetails(e).retry_after_seconds);
            setLeaseRetrySeconds(Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null);
          }
          if (!quiet) toast.error(transactionErrorMessage(e, 'Unable to prepare billing counter'));
          return null;
        } finally {
          startupRef.current = false;
          startupPromiseRef.current = null;
          setStarting(false);
        }
      })();
      return startupPromiseRef.current;
    },
    [
      activeCartQuery,
      attachCustomerMutation,
      authReady,
      hasToken,
      interState,
      queryClient,
      fetchCartTotals,
      startCartMutation,
      toast,
    ],
  );

  const voidCurrentCart = useCallback(async () => {
    if (!order || receipt || checkingOut) {
      await newCart(customer?.id ?? null);
      return;
    }
    try {
      await voidCartMutation.mutateAsync(order.order_id);
      clearBillingDraft();
      setOrder(null);
      setCart(null);
      await newCart(customer?.id ?? null, { quiet: true });
      toast.ok('Draft bill voided.');
    } catch (err) {
      if (isStaleCartError(err)) {
        clearBillingDraft();
        setOrder(null);
        setCart(null);
        await newCart(customer?.id ?? null, { quiet: true });
        return;
      }
      toast.error(transactionErrorMessage(err, 'Unable to void draft bill'));
    }
  }, [checkingOut, customer?.id, newCart, order, receipt, toast, voidCartMutation]);

  useEffect(() => {
    if (!order || receipt) return;
    writeBillingDraft({ order, customer, interState, method });
  }, [customer, interState, method, order, receipt]);

  useEffect(() => {
    if (
      !authReady ||
      order ||
      receipt ||
      isLeaseConflict(lastStartupErrorRef.current) ||
      startupLoopRef.current
    ) return undefined;
    let cancelled = false;
    const delays = [1000, 2000, 4000, 8000, 12000];

    async function startWithBackoff() {
      startupLoopRef.current = true;
      logBillingLifecycle('Startup polling loop started');
      let attempt = 0;
      try {
        while (!cancelled && !order && !receipt) {
          const started = await newCart(customer?.id ?? null, { quiet: attempt > 0 });
          if (started || cancelled) return;

          const startupError = lastStartupErrorRef.current;
          if (isLeaseConflict(startupError) || !isRetryableStartupError(startupError)) return;

          const wait = delays[Math.min(attempt, delays.length - 1)];
          attempt += 1;
          setRetryingIn(Math.ceil(wait / 1000));
          await new Promise((resolve) => {
            retryTimerRef.current = window.setTimeout(resolve, wait);
          });
        }
      } finally {
        startupLoopRef.current = false;
      }
    }

    startWithBackoff();
    return () => {
      cancelled = true;
      logBillingLifecycle('Startup polling loop unmounted');
      if (retryTimerRef.current) window.clearTimeout(retryTimerRef.current);
    };
  }, [authReady, customer?.id, newCart, order, receipt]);

  useEffect(() => {
    const retry = () => {
      if (
        authReady &&
        !order &&
        !receipt &&
        !isLeaseConflict(lastStartupErrorRef.current) &&
        !startupPromiseRef.current &&
        !startupLoopRef.current
      ) {
        logBillingLifecycle('Retry requested after network restored');
        newCart(customer?.id ?? null, { quiet: true });
      }
    };
    window.addEventListener('online', retry);
    window.addEventListener('pos:network-restored', retry);
    return () => {
      window.removeEventListener('online', retry);
      window.removeEventListener('pos:network-restored', retry);
    };
  }, [authReady, customer?.id, newCart, order, receipt]);

  useEffect(() => {
    if (!isLeaseConflict(initError) || !leaseRetrySeconds) return undefined;
    const id = window.setInterval(() => {
      setLeaseRetrySeconds((seconds) => (seconds && seconds > 1 ? seconds - 1 : 0));
    }, 1000);
    return () => window.clearInterval(id);
  }, [initError, leaseRetrySeconds]);

  useEffect(() => {
    if (!authReady || !order || receipt) return undefined;
    const renew = () => {
      renewLeaseMutation.mutateAsync(order.order_id).catch((err) => {
        if (isLeaseConflict(err)) {
          clearBillingDraft();
          setOrder(null);
          setCart(null);
          lastStartupErrorRef.current = err;
          setInitError(err);
          const seconds = Number(leaseConflictDetails(err).retry_after_seconds);
          setLeaseRetrySeconds(Number.isFinite(seconds) && seconds > 0 ? Math.ceil(seconds) : null);
          toast.error(transactionErrorMessage(err, 'Unable to renew cart lease'));
        }
      });
    };
    const id = window.setInterval(renew, 45000);
    return () => window.clearInterval(id);
  }, [authReady, order, receipt, renewLeaseMutation, toast]);

  // Re-price when the inter-state toggle flips.
  useEffect(() => {
    if (order && !receipt) fetchCartTotals(order.order_id, interState).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [interState]);

  // Keep the active cart in sync with ERP-side product discount changes.
  useEffect(() => {
    if (!authReady || !order || receipt) return undefined;
    let cancelled = false;

    const refreshLiveCart = async () => {
      if (cancelled || cartRefreshInFlightRef.current) return;
      logBillingLifecycle('Fetching cart totals');
      cartRefreshInFlightRef.current = fetchCartTotals(order.order_id, interState);
      try {
        await cartRefreshInFlightRef.current;
        logBillingLifecycle('Cart totals fetch completed');
      } catch (err) {
        if (isStaleCartError(err)) {
          clearBillingDraft();
          setOrder(null);
          setCart(null);
        } else if (err?.code === 'TIMEOUT') {
          logBillingLifecycle('Cart totals fetch aborted by timeout');
        }
      } finally {
        cartRefreshInFlightRef.current = null;
      }
    };

    const onFocus = () => {
      refreshLiveCart();
    };

    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', onFocus);
    const id = window.setInterval(refreshLiveCart, CART_REPRICE_INTERVAL_MS);

    return () => {
      cancelled = true;
      logBillingLifecycle('Cart polling unmounted');
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
      document.removeEventListener('visibilitychange', onFocus);
    };
  }, [authReady, fetchCartTotals, interState, order, receipt]);

  /* ---------------------------------------------------------------- scan */
  const processScanCode = useCallback(async (rawCode) => {
    const code = String(rawCode || '').trim();
    if (!code || !order || scanning) return;

    setScanning(true);
    try {
      await scanMutation.mutateAsync({ orderId: order.order_id, barcode: code, quantity: 1 });
      setBarcode('');
      await fetchCartTotals(order.order_id);
    } catch (err) {
      if (isStaleCartError(err)) {
        clearBillingDraft();
        const freshOrder = await newCart(customer?.id ?? null, { quiet: true });
        if (freshOrder) {
          try {
            await scanMutation.mutateAsync({
              orderId: freshOrder.order_id,
              barcode: code,
              quantity: 1,
            });
            setBarcode('');
            await fetchCartTotals(freshOrder.order_id);
            toast.ok('Recovered the active cart and added the item.');
          } catch (retryErr) {
            toast.error(transactionErrorMessage(retryErr, 'Unable to scan barcode'));
            scanRef.current?.select();
          }
          return;
        }
      }
      toast.error(transactionErrorMessage(err, 'Unable to scan barcode'));
      // keep the value so a typo can be corrected, but select it for overwrite
      scanRef.current?.select();
    } finally {
      setScanning(false);
      scanRef.current?.focus();
    }
  }, [
    customer?.id,
    newCart,
    order,
    fetchCartTotals,
    scanMutation,
    scanning,
    toast,
  ]);

  async function onScan(e) {
    e.preventDefault();
    await processScanCode(barcode);
  }

  async function changeQty(line, delta) {
    if (!order || busyLine) return;
    const next = Number(line.quantity) + delta;

    if (next <= 0) {
      setConfirmLine(line);
      return;
    }

    setBusyLine(line.order_item_id);
    try {
      const updatedCart = await updateLineMutation.mutateAsync({
        orderId: order.order_id,
        itemId: line.order_item_id,
        productId: line.product_id,
        quantity: next,
      });
      setCart(updatedCart);
    } catch (err) {
      if (isStaleCartError(err)) {
        clearBillingDraft();
        const recovered = await newCart(customer?.id ?? null, { quiet: true });
        if (recovered) {
          try {
            const updatedCart = await updateLineMutation.mutateAsync({
              orderId: recovered.order_id,
              itemId: line.order_item_id,
              productId: line.product_id,
              quantity: next,
            });
            setCart(updatedCart);
            toast.ok('Recovered the active cart and updated the line.');
            return;
          } catch (retryErr) {
            toast.error(transactionErrorMessage(retryErr, 'Unable to update cart line'));
            return;
          }
        }
      }
      toast.error(transactionErrorMessage(err, 'Unable to update cart line'));
    } finally {
      setBusyLine(null);
    }
  }

  async function removeLine(line) {
    if (!order) return false;
    setBusyLine(line.order_item_id);
    try {
      const updatedCart = await removeLineMutation.mutateAsync({
        orderId: order.order_id,
        itemId: line.order_item_id,
      });
      setCart(updatedCart);
      toast.ok(`${line.product_name || 'Item'} removed from cart.`);
      return true;
    } catch (err) {
      if (isStaleCartError(err)) {
        clearBillingDraft();
        const recovered = await newCart(customer?.id ?? null, { quiet: true });
        if (recovered) {
          try {
            const updatedCart = await removeLineMutation.mutateAsync({
              orderId: recovered.order_id,
              itemId: line.order_item_id,
            });
            setCart(updatedCart);
            toast.ok('Recovered the active cart and removed the line.');
            return true;
          } catch (retryErr) {
            toast.error(transactionErrorMessage(retryErr, 'Unable to remove cart line'));
            return false;
          }
        }
      }
      toast.error(transactionErrorMessage(err, 'Unable to remove cart line'));
      return false;
    } finally {
      setBusyLine(null);
    }
  }

  /* ------------------------------------------------------------ customer */
  function cleanPhone(value) {
    return value.replace(/\D/g, '').slice(0, 10);
  }

  function cleanName(value) {
    return value.replace(/[^a-zA-Z ]/g, '').replace(/\s+/g, ' ').slice(0, 50);
  }

  function validPhone(value) {
    return /^\d{10}$/.test(value);
  }

  function validName(value) {
    return /^[A-Za-z ]{2,50}$/.test(value.trim());
  }

  function customerErrorMessage(err) {
    if (err instanceof ApiError && err.status === 401) return 'Please login again';
    if (err instanceof ApiError && err.status === 409) return 'Customer already exists';
    if (err instanceof ApiError && err.status === 0) return 'Unable to connect. Retrying...';
    return err.message;
  }

  async function attachCustomer(c, successMessage) {
    if (order) {
      try {
        await attachCustomerMutation.mutateAsync({
          orderId: order.order_id,
          customerId: c.id,
        });
      } catch (err) {
        if (!isStaleCartError(err)) throw err;
        clearBillingDraft();
        const started = await newCart(c.id, { quiet: true });
        if (!started) throw err;
      }
    } else {
      const started = await newCart(c.id);
      if (!started) return;
    }
    setCustomer(c);
    setCustomerSearchDone(false);
    setCustomerErrors({});
    toast.ok(successMessage);
  }

  async function lookupCustomer(e) {
    e.preventDefault();
    if (findingCustomer) return;

    const p = cleanPhone(phone);
    if (!validPhone(p)) {
      setCustomerErrors({ searchPhone: 'Enter valid 10 digit mobile number' });
      return;
    }

    setFindingCustomer(true);
    setCustomerErrors({});
    setPhone(p);
    try {
      const c = await lookupCustomerMutation.mutateAsync(p);
      await attachCustomer(c, `${c.name || 'Customer'} attached`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 404) {
        setCustomerSearchDone(true);
        toast.error('Customer not found');
      } else toast.error(customerErrorMessage(err));
    } finally {
      setFindingCustomer(false);
    }
  }

  async function addCustomer(e) {
    e.preventDefault();
    if (addingCustomer) return;

    const customerPhone = cleanPhone(newCustomerPhone);
    const customerName = cleanName(newCustomerName).trim();
    const nextErrors = {};
    if (!validPhone(customerPhone)) {
      nextErrors.newCustomerPhone = 'Enter valid 10 digit mobile number';
    }
    if (!validName(customerName)) {
      nextErrors.newCustomerName = 'Enter customer name between 2 and 50 letters';
    }
    if (Object.keys(nextErrors).length) {
      setCustomerErrors(nextErrors);
      setNewCustomerPhone(customerPhone);
      setNewCustomerName(customerName);
      return;
    }

    setAddingCustomer(true);
    setCustomerErrors({});
    setNewCustomerPhone(customerPhone);
    setNewCustomerName(customerName);
    try {
      try {
        const existing = await lookupCustomerMutation.mutateAsync(customerPhone);
        await attachCustomer(existing, 'Existing customer attached.');
        setNewCustomerPhone('');
        setNewCustomerName('');
        return;
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 404)) throw err;
      }

      const created = await createCustomerMutation.mutateAsync({
        phone: customerPhone,
        name: customerName,
      });
      await attachCustomer(created, 'Customer added successfully.');
      setNewCustomerPhone('');
      setNewCustomerName('');
    } catch (err) {
      toast.error(customerErrorMessage(err));
    } finally {
      setAddingCustomer(false);
    }
  }

  /* ------------------------------------------------------------ checkout */
  async function recoverCompletedCheckout(orderId) {
    for (const wait of [1000, 2000, 3000]) {
      await new Promise((resolve) => window.setTimeout(resolve, wait));
      try {
        const rows = await queryClient.fetchQuery(
          invoicesQueries.list({ limit: 25 }, { enabled: true }),
        );
        const completed = Array.isArray(rows)
          ? rows.find((invoice) => Number(invoice.order_id) === Number(orderId))
          : null;
        if (completed) {
          return await queryClient.fetchQuery(
            invoicesQueries.detail(completed.id, { enabled: true }),
          );
        }
      } catch {
        // The checkout transaction may still be committing; keep checking briefly.
      }
    }
    return null;
  }

  async function doCheckout() {
    if (!order || !lines.length || checkingOut) return;
    setCheckingOut(true);
    const checkoutPayload = buildCheckoutPayload({
      method,
      interState,
      totals,
      cashReceived,
      upiReference,
      cardReference,
      chequeReference,
      allowPartial,
      splitPayments,
    });
    try {
      const inv = await checkoutMutation.mutateAsync({
        orderId: order.order_id,
        payload: checkoutPayload,
      });
      clearBillingDraft();
      setReceipt(inv);
      loadInvoiceHistory().catch(() => {});
      toast.ok(`Invoice ${inv.invoice_number} · ${rupees(totals.grand_total)}`);
    } catch (err) {
      const checkoutMayStillBeProcessing =
        err?.status === 409 && /still processing/i.test(err?.message || '');
      if (isNetworkError(err) || checkoutMayStillBeProcessing) {
        const recovered = await recoverCompletedCheckout(order.order_id);
        if (recovered) {
          clearCheckoutAttempt(order.order_id);
          clearBillingDraft();
          setReceipt(recovered);
          loadInvoiceHistory().catch(() => {});
          toast.ok(`Invoice ${recovered.invoice_number} completed.`);
          return;
        }
        toast.error('Checkout status could not be confirmed. Check invoice history before retrying.');
        return;
      }
      if (isStaleCartError(err)) {
        clearBillingDraft();
        await newCart(customer?.id ?? null, { quiet: true });
      }
      toast.error(transactionErrorMessage(err, 'Unable to complete checkout'));
    } finally {
      setCheckingOut(false);
    }
  }

  async function reprintInvoice(inv, { preview = false } = {}) {
    try {
      const full =
        inv?.items || inv?.lines
          ? inv
          : await queryClient.fetchQuery(invoicesQueries.detail(inv.id, { enabled: true }));
      if (preview) {
        setPreviewInvoice(full);
        return;
      }
      await printInvoice({
        invoice: full,
        lines: invoiceLinesForReceipt(full),
        totals: invoiceTotalsForReceipt(full),
        customer: invoiceCustomerObject(full),
        store,
        template: receiptTemplate,
      });
      toast.ok(`Receipt ${full.invoice_number} sent to printer.`);
    } catch (err) {
      toast.error(transactionErrorMessage(err, 'Unable to print invoice'));
    }
  }

  async function requestEnterpriseApproval(e) {
    e.preventDefault();
    if (!approvalReason.trim()) {
      toast.error('Enter approval reason.');
      return;
    }
    try {
      await EnterprisePOS.requestApproval({
        approval_type: approvalType,
        reason: approvalReason.trim(),
        order_id: order?.order_id,
        invoice_id: receipt?.id,
        payload: {
          cart_total: totals.grand_total,
          lines: lines.length,
          cashier_note: approvalReason.trim(),
        },
      });
      setApprovalReason('');
      toast.ok('Approval requested.');
      await loadEnterpriseControls();
    } catch (err) {
      toast.error(transactionErrorMessage(err));
    }
  }

  async function decideApproval(id, status) {
    try {
      if (status === 'approved') await EnterprisePOS.approve(id, { decision_note: 'Approved at POS' });
      else await EnterprisePOS.reject(id, { decision_note: 'Rejected at POS' });
      toast.ok(`Approval ${status}.`);
      await loadEnterpriseControls();
    } catch (err) {
      toast.error(transactionErrorMessage(err));
    }
  }

  async function openShift(e) {
    e.preventDefault();
    try {
      const opened = await EnterprisePOS.openShift({
        opening_cash: Number(openingCash || 0),
        note: 'Opened from Billing counter',
      });
      setShift(opened);
      setOpeningCash('');
      toast.ok('Shift opened.');
      await loadEnterpriseControls();
    } catch (err) {
      toast.error(transactionErrorMessage(err));
    }
  }

  async function closeShift(e) {
    e.preventDefault();
    if (!shift) return;
    try {
      const closed = await EnterprisePOS.closeShift(shift.id, {
        closing_cash: Number(closingCash || 0),
        note: 'Closed from Billing counter',
      });
      setShift(closed.status === 'open' ? closed : null);
      setClosingCash('');
      toast.ok('Shift closed.');
      await loadEnterpriseControls();
    } catch (err) {
      toast.error(transactionErrorMessage(err));
    }
  }

  async function recordDrawerEvent(e) {
    e.preventDefault();
    try {
      await EnterprisePOS.drawerEvent({
        event_type: 'manual_open',
        amount: drawerAmount ? Number(drawerAmount) : undefined,
        reason: drawerReason || 'Manual drawer event',
        metadata: { source: 'billing' },
      });
      setDrawerAmount('');
      setDrawerReason('');
      toast.ok('Drawer event recorded.');
      await loadEnterpriseControls();
    } catch (err) {
      toast.error(transactionErrorMessage(err));
    }
  }

  async function printCurrentReceipt({ preview = false } = {}) {
    if (!receipt) return;
    if (preview) {
      setPreviewInvoice({
        ...receipt,
        items: invoiceLinesForReceipt({ ...receipt, items: lines }),
      });
      return;
    }
    await printInvoice({
      invoice: receipt,
      lines,
      totals,
      customer,
      store,
      template: receiptTemplate,
    });
  }

  /* ----------------------------------------------------------- shortcuts */
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'F9') {
        e.preventDefault();
        if (!receipt) doCheckout();
      }
      if (e.key === 'Escape' && !checkingOut) {
        e.preventDefault();
        voidCurrentCart();
      }
      if (e.key === 'F2') {
        e.preventDefault();
        scanRef.current?.focus();
      }
      if (e.key === 'F4') {
        e.preventDefault();
        setHistoryOpen((v) => !v);
      }
      if (e.key === 'F6') {
        e.preventDefault();
        setCashierMode((v) => !v);
      }
      if (e.key === 'F7') {
        e.preventDefault();
        if (receipt) printCurrentReceipt({ preview: true });
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault();
        if (receipt) printCurrentReceipt();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [checkingOut, receipt, voidCurrentCart, doCheckout]);

  useEffect(() => {
    function isEditableTarget(target) {
      const tag = target?.tagName?.toLowerCase();
      return tag === 'input' || tag === 'textarea' || tag === 'select' || target?.isContentEditable;
    }

    function flushBuffer() {
      const value = scannerBufferRef.current.value;
      scannerBufferRef.current.value = '';
      if (value.length >= 3) {
        setBarcode(value);
        processScanCode(value);
      }
    }

    function onScannerKey(e) {
      if (receipt || checkingOut || isEditableTarget(e.target)) return;
      if (e.key === 'Enter') {
        if (scannerBufferRef.current.value) {
          e.preventDefault();
          flushBuffer();
        }
        return;
      }
      if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;
      const now = Date.now();
      if (now - scannerBufferRef.current.lastAt > 80) scannerBufferRef.current.value = '';
      scannerBufferRef.current.value += e.key;
      scannerBufferRef.current.lastAt = now;
      if (scannerBufferRef.current.timer) window.clearTimeout(scannerBufferRef.current.timer);
      scannerBufferRef.current.timer = window.setTimeout(flushBuffer, 90);
    }

    window.addEventListener('keydown', onScannerKey);
    return () => {
      window.removeEventListener('keydown', onScannerKey);
      if (scannerBufferRef.current.timer) window.clearTimeout(scannerBufferRef.current.timer);
    };
  }, [checkingOut, processScanCode, receipt]);

  useEffect(() => {
    if (!receipt && !starting) {
      const id = window.setTimeout(() => scanRef.current?.focus(), 120);
      return () => window.clearTimeout(id);
    }
    return undefined;
  }, [lines.length, receipt, starting]);

  return (
    <Page
      title="Billing Counter"
      subtitle={storeBranchLabel(store)}
      chip={order?.order_number}
    >
      <div className="hidden" aria-hidden="true">
        {receipt && (
          <PrintableInvoice
            invoice={receipt}
            lines={lines}
            totals={totals}
            customer={customer}
            store={store}
          />
        )}
      </div>

      <CashierToolbar
        cashierMode={cashierMode}
        setCashierMode={setCashierMode}
        historyOpen={historyOpen}
        setHistoryOpen={setHistoryOpen}
        enterpriseOpen={enterpriseOpen}
        setEnterpriseOpen={setEnterpriseOpen}
        receiptTemplate={receiptTemplate}
        setReceiptTemplate={setReceiptTemplate}
        receipt={receipt}
        onPreview={() => printCurrentReceipt({ preview: true })}
        onPrint={() => printCurrentReceipt()}
      />

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_484px]">
        {/* ------------------------------------------------- left column */}
        <div className={`min-w-0 space-y-3 ${cashierMode ? 'xl:space-y-2' : ''}`}>
          {enterpriseOpen ? (
            <EnterpriseControlsPanel
              user={user}
              shift={shift}
              approvals={approvals}
              timeline={timeline}
              loading={enterpriseLoading}
              approvalType={approvalType}
              setApprovalType={setApprovalType}
              approvalReason={approvalReason}
              setApprovalReason={setApprovalReason}
              openingCash={openingCash}
              setOpeningCash={setOpeningCash}
              closingCash={closingCash}
              setClosingCash={setClosingCash}
              drawerAmount={drawerAmount}
              setDrawerAmount={setDrawerAmount}
              drawerReason={drawerReason}
              setDrawerReason={setDrawerReason}
              onRefresh={loadEnterpriseControls}
              onRequestApproval={requestEnterpriseApproval}
              onDecideApproval={decideApproval}
              onOpenShift={openShift}
              onCloseShift={closeShift}
              onDrawerEvent={recordDrawerEvent}
            />
          ) : null}

          {historyOpen ? (
            <InvoiceHistoryPanel
              rows={history}
              loading={historyLoading}
              error={historyError}
              onRefresh={loadInvoiceHistory}
              onPreview={(inv) => reprintInvoice(inv, { preview: true })}
              onReprint={(inv) => reprintInvoice(inv)}
            />
          ) : null}

          {initError && !order && (
            <ErrorBox
              error={{
                ...initError,
                message: isLeaseConflict(initError)
                  ? `${initError.message}. ${
                      leaseRetrySeconds > 0
                        ? `The lease may be available in about ${leaseRetrySeconds}s.`
                        : 'The lease may now be available.'
                    } Automatic retries are paused to protect the active sale.`
                  : retryingIn
                    ? `${initError.message} Retrying in ${retryingIn}s.`
                    : initError.message,
              }}
              onRetry={() => newCart(customer?.id ?? null)}
            />
          )}

          {!order && !initError && (
            <Panel className="p-4">
              <div className="flex items-center gap-3 text-mute">
                <Spinner className="h-5 w-5" />
                <span className="text-sm">Preparing billing counter…</span>
              </div>
            </Panel>
          )}

          <form onSubmit={onScan}>
            <div className="flex h-[62px] items-center gap-4 rounded-card border-[1.5px] border-amber bg-amber/[0.05] px-5">
              <span className="text-2xl text-amber">⌷</span>
              <input
                ref={scanRef}
                value={barcode}
                onChange={(e) => setBarcode(e.target.value)}
                disabled={!!receipt || starting}
                placeholder="Scan or type barcode"
                autoComplete="off"
                className="flex-1 bg-transparent font-mono text-[17px] text-bone caret-amber outline-none placeholder:font-sans placeholder:text-[13px] placeholder:text-mute disabled:opacity-40"
              />
              {scanning ? (
                <Spinner className="h-5 w-5 text-amber" />
              ) : (
                <kbd className="hidden rounded border border-hair bg-raised px-2.5 py-1.5 font-mono text-[11px] text-dim sm:block">
                  F2 Search
                </kbd>
              )}
            </div>
          </form>
          <Panel className="overflow-hidden">
            <div className="flex items-center gap-3 px-5 pb-3 pt-4">
              <span className="text-[11px] font-semibold tracking-[0.12em] text-mute">
                CART
              </span>
              <span className="font-mono text-[11px] font-semibold text-amber">
                {lines.length} {lines.length === 1 ? 'item' : 'items'}
              </span>
            </div>

            <div className="border-t border-hairsoft">
              {starting ? (
                <div className="flex justify-center py-16">
                  <Spinner className="h-6 w-6 text-mute" />
                </div>
              ) : lines.length === 0 ? (
                <Empty
                  icon="⌷"
                  title="Cart is empty"
                  sub="Scan a barcode to add the first item."
                />
              ) : (
                <table className="w-full table-fixed">
                  <colgroup>
                    <col className="w-[19%]" />
                    <col className="w-[14%]" />
                    <col className="w-[13%]" />
                    <col className="w-[10%]" />
                    <col className="w-[8%]" />
                    <col className="w-[16%]" />
                  </colgroup>
                  <thead>
                    <tr className="text-[9.5px] font-semibold tracking-wider text-mute">
                      <th className="px-5 py-3 text-left">ITEM</th>
                      <th className="px-3 py-3 text-center">QTY</th>
                      <th className="px-8 py-3 text-right">RATE</th>
                      <th className="px-3 py-3 text-right">DISC</th>
                      <th className="px-3 py-3 text-right">GST</th>
                      <th className="px-12 py-3 text-right">AMOUNT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l, i) => {
                      const busy = busyLine === l.order_item_id;
                      return (
                        <tr
                          key={l.order_item_id}
                          className={`group border-t border-hairsoft ${
                            i % 2 ? 'bg-raised/40' : ''
                          } ${busy ? 'opacity-50' : ''}`}
                        >
                          <td className="px-5 py-3">
                            <p className="truncate text-[13.5px] font-medium text-bone">
                              {l.product_name}
                            </p>
                            <p className="font-mono text-[10.5px] text-mute">
                              #{l.product_id}
                            </p>
                          </td>
                          <td className="px-3 py-3">
                            <div className="mx-auto flex w-[74px] items-center justify-between rounded-md border border-hair bg-raised px-1">
                              <button
                                onClick={() => changeQty(l, -1)}
                                disabled={busy || !!receipt}
                                className="h-6 w-6 text-mute hover:text-bone disabled:opacity-40"
                                aria-label="Decrease"
                              >
                                −
                              </button>
                              <span className="font-mono text-[13px] font-semibold text-bone">
                                {fmtQty(l.quantity)}
                              </span>
                              <button
                                onClick={() => changeQty(l, 1)}
                                disabled={busy || !!receipt}
                                className="h-6 w-6 text-mute hover:text-bone disabled:opacity-40"
                                aria-label="Increase"
                              >
                                +
                              </button>
                            </div>
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-[13px] text-dim">
                            {money(l.rate)}
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-[13px] text-mute">
                            {Number(l.discount_pct) > 0 ? (
                              <span className="font-semibold text-dim">
                                {fmtPct(l.discount_pct)}
                              </span>
                            ) : (
                              <span className="font-semibold text-mute">0%</span>
                            )}
                          </td>
                          <td className="px-3 py-3 text-right font-mono text-[12.5px] text-mute">
                            {fmtQty(l.gst_rate)}%
                          </td>
                          <td className="px-3 py-3 text-right">
                            <div className="flex items-center justify-end gap-3">
                              <span className="font-mono text-[14px] font-semibold text-bone">
                                {money(l.line_total)}
                              </span>
                            {!receipt && (
                              <button
                                onClick={() => setConfirmLine(l)}
                                disabled={busy}
                                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-danger/30 bg-danger/10 text-[18px] font-semibold leading-none text-danger opacity-0 transition hover:border-danger/50 hover:bg-danger/15 focus:opacity-100 focus:outline-none focus:ring-2 focus:ring-danger/35 group-hover:opacity-100 disabled:cursor-not-allowed disabled:opacity-40"
                                aria-label="Remove line"
                                title="Remove item"
                              >
                                ×
                              </button>
                            )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </Panel>

        </div>

        {/* ------------------------------------------------ right column */}
        <div className="space-y-3">
          <Panel className="p-5">
            {receipt ? (
              <ReceiptDone
                invoice={receipt}
                total={totals.grand_total}
                totals={totals}
                lines={lines}
                customer={customer}
                store={store}
                onNew={() => newCart(customer?.id ?? null)}
                template={receiptTemplate}
                onPrint={() => printCurrentReceipt()}
              />
            ) : (
              <>
                {/* customer */}
                <p className="text-[10px] font-semibold tracking-[0.12em] text-mute">
                  CUSTOMER
                </p>
                {customer ? (
                  <div className="mt-3 flex items-center gap-3 rounded-ctl border border-hair bg-raised p-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-amberdim text-amber">
                      <IconUser className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[13.5px] font-medium text-bone">
                        {customer.name || 'Unnamed'}
                      </p>
                      <p className="mt-0.5 flex items-center gap-1.5 font-mono text-[11px] text-mute">
                        <IconPhone className="h-3 w-3" />
                        {customer.phone || '—'}
                      </p>
                    </div>
                    {customer.purchase_count > 0 && <Pill tone="ok">LOYAL</Pill>}
                    <button
                      onClick={() => {
                        setCustomer(null);
                        setPhone('');
                        if (order) {
                          attachCustomerMutation
                            .mutateAsync({ orderId: order.order_id, customerId: null })
                            .catch((err) => toast.error(transactionErrorMessage(err)));
                        }
                      }}
                      className="rounded-ctl px-2.5 py-1.5 text-[11px] font-medium text-mute transition hover:bg-hair/60 hover:text-bone"
                      aria-label="Detach customer"
                    >
                      Change
                    </button>
                  </div>
                ) : (
                  <div className="mt-3 space-y-4">
                    <form onSubmit={lookupCustomer}>
                      <div className="flex gap-2">
                        <div className="relative flex-1">
                          <IconPhone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" />
                          <Input
                            mono
                            inputMode="numeric"
                            placeholder="Search phone number"
                            value={phone}
                            onChange={(e) => {
                              setPhone(cleanPhone(e.target.value));
                              setCustomerErrors((prev) => ({ ...prev, searchPhone: '' }));
                            }}
                            className="pl-9"
                          />
                        </div>
                        <Button
                          variant="secondary"
                          type="submit"
                          loading={findingCustomer}
                          className="px-4"
                        >
                          <IconSearch className="h-4 w-4" />
                          Find
                        </Button>
                      </div>
                      {customerErrors.searchPhone ? (
                        <p className="mt-1.5 text-[11px] text-danger">
                          {customerErrors.searchPhone}
                        </p>
                      ) : null}
                    </form>

                    {customerSearchDone ? (
                      <div className="rounded-ctl border border-hair bg-raised px-3 py-2 text-[12px] text-mute">
                        Customer not found
                      </div>
                    ) : null}

                    <Divider>{customerSearchDone ? 'ADD NEW CUSTOMER' : 'OR'}</Divider>

                    <form onSubmit={addCustomer} className="space-y-2.5">
                      <div>
                        <div className="relative">
                          <IconPhone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" />
                          <Input
                            mono
                            inputMode="numeric"
                            placeholder="Customer phone number *"
                            value={newCustomerPhone}
                            onChange={(e) => {
                              setNewCustomerPhone(cleanPhone(e.target.value));
                              setCustomerErrors((prev) => ({ ...prev, newCustomerPhone: '' }));
                            }}
                            className="pl-9"
                          />
                        </div>
                        {customerErrors.newCustomerPhone ? (
                          <p className="mt-1.5 text-[11px] text-danger">
                            {customerErrors.newCustomerPhone}
                          </p>
                        ) : null}
                      </div>
                      <div>
                        <div className="relative">
                          <IconUser className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-mute" />
                          <Input
                            placeholder="Customer name *"
                            value={newCustomerName}
                            onChange={(e) => {
                              setNewCustomerName(cleanName(e.target.value));
                              setCustomerErrors((prev) => ({ ...prev, newCustomerName: '' }));
                            }}
                            className="pl-9"
                          />
                        </div>
                        {customerErrors.newCustomerName ? (
                          <p className="mt-1.5 text-[11px] text-danger">
                            {customerErrors.newCustomerName}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex justify-end">
                        <Button
                          type="submit"
                          loading={addingCustomer}
                          className="px-4 py-2.5"
                        >
                          <IconPlus className="h-4 w-4" />
                          Add Customer
                        </Button>
                      </div>
                    </form>
                  </div>
                )}

                <div className="my-4 border-t border-hairsoft" />

                {/* totals */}
                <Row label="Subtotal" value={money(totals.subtotal)} />
                <Row
                  label="Discount"
                  value={`−${money(totals.discount)}`}
                  tone={Number(totals.discount) > 0 ? 'amber' : 'dim'}
                />
                <Row label="Taxable Value" value={money(totals.taxable_value)} />

                <div className="my-3 border-t border-dashed border-hairsoft" />

                <button
                  onClick={() => setInterState((v) => !v)}
                  className="mb-2 flex w-full items-center justify-between rounded-ctl border border-hair bg-raised px-3 py-2 text-left transition hover:border-amber/40"
                >
                  <span className="text-[11px] text-dim">
                    {interState ? 'Inter-state (IGST)' : 'Intra-state (CGST + SGST)'}
                  </span>
                  <span
                    className={`relative h-4 w-8 rounded-full transition ${
                      interState ? 'bg-amber' : 'bg-hair'
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 h-3 w-3 rounded-full bg-ground transition-all ${
                        interState ? 'left-[18px]' : 'left-0.5'
                      }`}
                    />
                  </span>
                </button>

                <Row label="CGST" value={money(totals.cgst)} faded={interState} />
                <Row label="SGST" value={money(totals.sgst)} faded={interState} />
                <Row label="IGST" value={money(totals.igst)} faded={!interState} />

                {/* grand total */}
                <div className="mt-4 rounded-card border border-amber/35 bg-amber/10 px-5 py-4">
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-[10.5px] font-semibold tracking-[0.12em] text-amber">
                        GRAND TOTAL
                      </p>
                      <p className="mt-0.5 text-[10.5px] text-mute">
                        {lines.length} {lines.length === 1 ? 'line' : 'lines'} · incl. all tax
                      </p>
                    </div>
                    <p className="font-mono text-[30px] font-bold leading-none text-amber">
                      {rupees(totals.grand_total)}
                    </p>
                  </div>
                </div>

                {/* tender */}
                <p className="mt-5 text-[10px] font-semibold tracking-[0.12em] text-mute">
                  PAYMENT METHOD
                </p>
                <div className="mt-2 grid grid-cols-5 gap-2">
                  {METHODS.map(([value, label]) => (
                    <button
                      key={value}
                      onClick={() => setMethod(value)}
                      className={`rounded-ctl border py-2.5 text-[12.5px] transition ${
                        method === value
                          ? 'border-amber bg-amber/15 font-semibold text-amber'
                          : 'border-hair bg-raised text-dim hover:text-bone'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <TenderFields
                  method={method}
                  total={totals.grand_total}
                  cashReceived={cashReceived}
                  setCashReceived={setCashReceived}
                  upiReference={upiReference}
                  setUpiReference={setUpiReference}
                  cardReference={cardReference}
                  setCardReference={setCardReference}
                  chequeReference={chequeReference}
                  setChequeReference={setChequeReference}
                  allowPartial={allowPartial}
                  setAllowPartial={setAllowPartial}
                  splitPayments={splitPayments}
                  setSplitPayments={setSplitPayments}
                />

                <Button
                  onClick={doCheckout}
                  loading={checkingOut}
                  disabled={!lines.length}
                  className="mt-5 w-full py-3.5 text-[15px]"
                >
                  {checkingOut
                    ? 'Processing…'
                    : `CHECKOUT · ${rupees(totals.grand_total)}`}
                </Button>

                <p className="mt-3 text-center font-mono text-[10.5px] text-mute">
                  F9 Checkout · ESC Void Bill
                </p>
              </>
            )}
          </Panel>

        </div>
      </div>

      <ConfirmModal
        open={Boolean(confirmLine)}
        danger
        icon="!"
        title="Remove item from cart?"
        message={
          confirmLine
            ? `${confirmLine.product_name || 'This item'} · Qty ${fmtQty(confirmLine.quantity)} · ${money(confirmLine.line_total)} will be removed from this bill.`
            : ''
        }
        confirmLabel="Remove item"
        loading={Boolean(confirmLine && busyLine === confirmLine.order_item_id)}
        onCancel={() => (busyLine ? null : setConfirmLine(null))}
        onConfirm={async () => {
          if (!confirmLine) return;
          const removed = await removeLine(confirmLine);
          if (removed) setConfirmLine(null);
        }}
      />

      <ReceiptPreviewModal
        invoice={previewInvoice}
        store={store}
        template={receiptTemplate}
        onClose={() => setPreviewInvoice(null)}
        onPrint={async () => {
          if (!previewInvoice) return;
          await printInvoice({
            invoice: previewInvoice,
            lines: invoiceLinesForReceipt(previewInvoice),
            totals: invoiceTotalsForReceipt(previewInvoice),
            customer: invoiceCustomerObject(previewInvoice),
            store,
            template: receiptTemplate,
          });
        }}
      />
    </Page>
  );
}

function Row({ label, value, tone = 'dim', faded }) {
  const colors = { dim: 'text-dim', amber: 'text-amber' };
  return (
    <div className={`flex items-center justify-between py-1.5 ${faded ? 'opacity-40' : ''}`}>
      <span className="text-[12.5px] text-mute">{label}</span>
      <span className={`font-mono text-[13px] ${colors[tone]}`}>{value}</span>
    </div>
  );
}

function CashierToolbar({
  cashierMode,
  setCashierMode,
  historyOpen,
  setHistoryOpen,
  enterpriseOpen,
  setEnterpriseOpen,
  receiptTemplate,
  setReceiptTemplate,
  receipt,
  onPreview,
  onPrint,
}) {
  return (
    <Panel className="mb-4 p-3">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant={cashierMode ? 'primary' : 'secondary'}
            className="px-3 py-2 text-[12px]"
            onClick={() => setCashierMode((v) => !v)}
          >
            Cashier Mode
          </Button>
          <Button
            variant={historyOpen ? 'primary' : 'secondary'}
            className="px-3 py-2 text-[12px]"
            onClick={() => setHistoryOpen((v) => !v)}
          >
            Invoice History
          </Button>
          <Button
            variant={enterpriseOpen ? 'primary' : 'secondary'}
            className="px-3 py-2 text-[12px]"
            onClick={() => setEnterpriseOpen((v) => !v)}
          >
            Enterprise Controls
          </Button>
          <Button
            variant="secondary"
            className="px-3 py-2 text-[12px]"
            disabled={!receipt}
            onClick={onPreview}
          >
            Print Preview
          </Button>
          <Button
            variant="secondary"
            className="px-3 py-2 text-[12px]"
            disabled={!receipt}
            onClick={onPrint}
          >
            Reprint
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[10px] font-semibold tracking-[0.12em] text-mute">TEMPLATE</span>
          {RECEIPT_TEMPLATES.map(([value, label]) => (
            <button
              key={value}
              onClick={() => setReceiptTemplate(value)}
              className={`rounded-ctl border px-3 py-2 text-[11px] transition ${
                receiptTemplate === value
                  ? 'border-amber bg-amber/15 font-semibold text-amber'
                  : 'border-hair bg-raised text-dim hover:text-bone'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-2 font-mono text-[10px] text-mute">
        F2 scan · F4 history · F6 cashier mode · F7 preview · Ctrl+P print · F9 checkout
      </p>
    </Panel>
  );
}

function InvoiceHistoryPanel({ rows, loading, error, onRefresh, onPreview, onReprint }) {
  return (
    <Panel className="overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.12em] text-mute">
            RECENT INVOICES
          </p>
          <p className="mt-1 font-mono text-[10px] text-mute">
            reprint or preview without leaving billing
          </p>
        </div>
        <Button variant="secondary" className="px-3 py-2 text-[11px]" onClick={onRefresh}>
          Refresh
        </Button>
      </div>
      {error ? <p className="border-t border-hairsoft px-5 py-3 text-[12px] text-danger">{error}</p> : null}
      {loading ? (
        <div className="flex justify-center border-t border-hairsoft py-5">
          <Spinner className="h-5 w-5 text-mute" />
        </div>
      ) : !rows.length ? (
        <div className="border-t border-hairsoft">
          <Empty icon="⎘" title="No invoices" sub="Completed sales appear here." />
        </div>
      ) : (
        <div className="divide-y divide-hairsoft border-t border-hairsoft">
          {rows.map((inv) => (
            <div
              key={inv.id}
              className="grid grid-cols-1 gap-3 px-5 py-3 transition hover:bg-raised/60 md:grid-cols-[minmax(0,1fr)_auto]"
            >
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="font-mono text-[13px] font-semibold text-bone">
                    {inv.invoice_number}
                  </p>
                  <Pill tone={inv.is_reverse ? 'danger' : 'ok'}>
                    {(inv.status || 'completed').toUpperCase()}
                  </Pill>
                  <span className="font-mono text-[10px] text-mute">{dateStr(inv.date || inv.created_at)}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px] text-mute sm:grid-cols-4">
                  <span className="truncate">{inv.party_name || 'Walk-in customer'}</span>
                  <span className="font-mono uppercase">{methodLabel(inv.payment_method)}</span>
                  <span className="font-mono">{invoiceLineCount(inv)} lines</span>
                  <span className="text-right font-mono font-semibold text-amber sm:text-left">
                    {rupees(invoiceGrandTotal(inv))}
                  </span>
                </div>
              </div>
              <div className="flex items-center justify-end gap-2">
                <Button variant="secondary" className="px-3 py-1.5 text-[11px]" onClick={() => onPreview(inv)}>
                  Preview
                </Button>
                <Button className="px-3 py-1.5 text-[11px]" onClick={() => onReprint(inv)}>
                  Print
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}

function EnterpriseControlsPanel({
  user,
  shift,
  approvals,
  timeline,
  loading,
  approvalType,
  setApprovalType,
  approvalReason,
  setApprovalReason,
  openingCash,
  setOpeningCash,
  closingCash,
  setClosingCash,
  drawerAmount,
  setDrawerAmount,
  drawerReason,
  setDrawerReason,
  onRefresh,
  onRequestApproval,
  onDecideApproval,
  onOpenShift,
  onCloseShift,
  onDrawerEvent,
}) {
  const canApprove = user?.role === ROLES.BM || user?.role === ROLES.SM;
  return (
    <Panel className="overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4">
        <div>
          <p className="text-[11px] font-semibold tracking-[0.12em] text-mute">
            ENTERPRISE CONTROLS
          </p>
          <p className="mt-1 font-mono text-[10px] text-mute">
            approvals · audit timeline · shift · drawer
          </p>
        </div>
        <Button variant="secondary" className="px-3 py-2 text-[11px]" onClick={onRefresh}>
          {loading ? 'Loading' : 'Refresh'}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 border-t border-hairsoft p-5 xl:grid-cols-3">
        <div className="space-y-3">
          <p className="text-[10px] font-semibold tracking-[0.12em] text-mute">SHIFT</p>
          {shift ? (
            <div className="rounded-ctl border border-ok/30 bg-ok/10 p-3">
              <p className="font-mono text-[12px] font-semibold text-ok">OPEN #{shift.id}</p>
              <p className="mt-1 text-[11px] text-mute">Opening cash {money(shift.opening_cash)}</p>
              <form onSubmit={onCloseShift} className="mt-3 flex gap-2">
                <Input
                  value={closingCash}
                  onChange={(e) => setClosingCash(e.target.value.replace(/[^\d.]/g, ''))}
                  placeholder="Closing cash"
                  inputMode="decimal"
                />
                <Button className="px-3" type="submit">Close</Button>
              </form>
            </div>
          ) : (
            <form onSubmit={onOpenShift} className="rounded-ctl border border-hair bg-raised p-3">
              <Input
                value={openingCash}
                onChange={(e) => setOpeningCash(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="Opening cash"
                inputMode="decimal"
              />
              <Button className="mt-2 w-full py-2.5" type="submit">Open Shift</Button>
            </form>
          )}

          <form onSubmit={onDrawerEvent} className="rounded-ctl border border-hair bg-raised p-3">
            <p className="text-[10px] font-semibold tracking-[0.12em] text-mute">CASH DRAWER</p>
            <div className="mt-2 grid grid-cols-2 gap-2">
              <Input
                value={drawerAmount}
                onChange={(e) => setDrawerAmount(e.target.value.replace(/[^\d.]/g, ''))}
                placeholder="Amount"
                inputMode="decimal"
              />
              <Input
                value={drawerReason}
                onChange={(e) => setDrawerReason(e.target.value)}
                placeholder="Reason"
              />
            </div>
            <Button variant="secondary" className="mt-2 w-full py-2.5" type="submit">
              Record Drawer Event
            </Button>
          </form>
        </div>

        <div className="space-y-3">
          <p className="text-[10px] font-semibold tracking-[0.12em] text-mute">APPROVALS</p>
          <form onSubmit={onRequestApproval} className="rounded-ctl border border-hair bg-raised p-3">
            <select
              value={approvalType}
              onChange={(e) => setApprovalType(e.target.value)}
              className="h-10 w-full rounded-ctl border border-hair bg-ground px-3 text-[12px] text-bone"
            >
              <option value="discount">Discount Approval</option>
              <option value="price_override">Price Override</option>
              <option value="refund">Refund Approval</option>
              <option value="supervisor_override">Supervisor Override</option>
              <option value="manager_approval">Manager Approval</option>
              <option value="cash_drawer">Cash Drawer Approval</option>
            </select>
            <Input
              value={approvalReason}
              onChange={(e) => setApprovalReason(e.target.value)}
              placeholder="Reason"
              className="mt-2"
            />
            <Button className="mt-2 w-full py-2.5" type="submit">Request Approval</Button>
          </form>
          <div className="max-h-[230px] space-y-2 overflow-auto pr-1">
            {approvals.length ? approvals.map((approval) => (
              <div key={approval.id} className="rounded-ctl border border-hair bg-raised p-3">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-mono text-[11px] font-semibold uppercase text-amber">
                      {approval.approval_type}
                    </p>
                    <p className="mt-1 text-[11px] text-mute">{approval.reason}</p>
                  </div>
                  <Pill tone="amber">{approval.status.toUpperCase()}</Pill>
                </div>
                {canApprove ? (
                  <div className="mt-2 flex gap-2">
                    <Button className="flex-1 py-1.5 text-[11px]" onClick={() => onDecideApproval(approval.id, 'approved')}>
                      Approve
                    </Button>
                    <Button variant="danger" className="flex-1 py-1.5 text-[11px]" onClick={() => onDecideApproval(approval.id, 'rejected')}>
                      Reject
                    </Button>
                  </div>
                ) : null}
              </div>
            )) : (
              <p className="rounded-ctl border border-hair bg-raised p-3 text-[12px] text-mute">
                No pending approvals.
              </p>
            )}
          </div>
        </div>

        <div className="space-y-3">
          <p className="text-[10px] font-semibold tracking-[0.12em] text-mute">ACTIVITY TIMELINE</p>
          <div className="max-h-[360px] space-y-2 overflow-auto pr-1">
            {timeline.length ? timeline.map((row) => (
              <div key={row.id} className="rounded-ctl border border-hair bg-raised p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-[11px] font-semibold uppercase text-bone">{row.action}</p>
                  <Pill tone={row.severity === 'warning' ? 'amber' : row.severity === 'error' ? 'danger' : 'mute'}>
                    {row.entity_type}
                  </Pill>
                </div>
                <p className="mt-1 font-mono text-[10px] text-mute">
                  staff #{row.staff_id ?? '-'} · terminal {row.terminal_id || '-'}
                </p>
                <p className="mt-1 text-[10.5px] text-dim">{row.created_at ? dateStr(row.created_at) : ''}</p>
              </div>
            )) : (
              <p className="rounded-ctl border border-hair bg-raised p-3 text-[12px] text-mute">
                No activity yet.
              </p>
            )}
          </div>
        </div>
      </div>
    </Panel>
  );
}

function ReceiptPreviewModal({ invoice, store, template, onClose, onPrint }) {
  const previewRef = useRef(null);
  const [qrUrl, setQrUrl] = useState('');

  useEffect(() => {
    let alive = true;
    qrDataUrl(absoluteInvoiceUrl(invoice?.public_invoice_url), template === 'thermal' ? 112 : 136)
      .then((url) => {
        if (alive) setQrUrl(url);
      });
    return () => {
      alive = false;
    };
  }, [invoice?.public_invoice_url, template]);

  useEffect(() => {
    if (!previewRef.current) return;
    const barcodeNodes = Array.from(
      previewRef.current.querySelectorAll('.invoice-barcode, .receipt-barcode'),
    );
    barcodeNodes.forEach((node) => renderBarcodeNode(node));
  }, [invoice, qrUrl, template]);

  if (!invoice) return null;
  const lines = invoiceLinesForReceipt(invoice);
  const totals = invoiceTotalsForReceipt(invoice);
  const customer = invoiceCustomerObject(invoice);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/60 p-4">
      <div className="max-h-[92vh] w-full max-w-5xl overflow-hidden rounded-card border border-hair bg-ground shadow-2xl">
        <div className="flex items-center justify-between border-b border-hairsoft px-5 py-3">
          <div>
            <p className="font-mono text-[13px] font-semibold text-bone">{invoice.invoice_number}</p>
            <p className="text-[11px] text-mute">{template.toUpperCase()} print preview</p>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" className="px-3 py-2 text-[12px]" onClick={onClose}>
              Close
            </Button>
            <Button className="px-3 py-2 text-[12px]" onClick={onPrint}>
              Print
            </Button>
          </div>
        </div>
        <div className="max-h-[78vh] overflow-auto bg-receipt-frame p-5">
          <div className={template === 'thermal' ? 'mx-auto w-[320px]' : 'mx-auto max-w-[900px]'}>
            <div ref={previewRef} className="receipt-paper shadow-xl">
              <style>{template === 'thermal' ? thermalPrintStyles() : printStyles(template)}</style>
              {template === 'thermal' ? (
                <PrintableThermalReceipt
                  invoice={invoice}
                  lines={lines}
                  totals={totals}
                  customer={customer}
                  store={store}
                  qrUrl={qrUrl}
                />
              ) : (
                <PrintableInvoice
                  invoice={invoice}
                  lines={lines}
                  totals={totals}
                  customer={customer}
                  store={store}
                  qrUrl={qrUrl}
                  compact={template === 'compact'}
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function amountNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function buildCheckoutPayload({
  method,
  interState,
  totals,
  cashReceived,
  upiReference,
  cardReference,
  chequeReference,
  allowPartial,
  splitPayments,
}) {
  const total = Number(totals?.grand_total || 0);
  if (method === 'split') {
    return {
      payment_method: 'split',
      payments: splitPayments
        .map((payment) => ({
          method: payment.method,
          amount: amountNumber(payment.amount),
          reference_no: payment.reference_no || undefined,
        }))
        .filter((payment) => payment.amount > 0),
      allow_partial: allowPartial,
      inter_state: interState,
    };
  }
  return {
    payment_method: method,
    cash_received: method === 'cash' && cashReceived ? amountNumber(cashReceived) : undefined,
    upi_reference: method === 'upi' ? upiReference : undefined,
    card_reference: method === 'card' ? cardReference : undefined,
    cheque_reference: method === 'cheque' ? chequeReference : undefined,
    allow_partial: allowPartial,
    payments:
      method !== 'cash' && allowPartial
        ? [{ method, amount: total, reference_no: undefined }]
        : undefined,
    inter_state: interState,
  };
}

function TenderFields({
  method,
  total,
  cashReceived,
  setCashReceived,
  upiReference,
  setUpiReference,
  cardReference,
  setCardReference,
  chequeReference,
  setChequeReference,
  allowPartial,
  setAllowPartial,
  splitPayments,
  setSplitPayments,
}) {
  const totalNumber = Number(total || 0);
  const changeDue = Math.max(amountNumber(cashReceived) - totalNumber, 0);

  function updateSplit(index, patch) {
    setSplitPayments((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  return (
    <div className="mt-3 space-y-2">
      {method === 'cash' ? (
        <>
          <Input
            value={cashReceived}
            onChange={(e) => setCashReceived(e.target.value.replace(/[^\d.]/g, ''))}
            placeholder="Cash received"
            inputMode="decimal"
          />
          <Row label="Change Due" value={money(changeDue)} tone={changeDue > 0 ? 'amber' : 'dim'} />
        </>
      ) : null}
      {method === 'upi' ? (
        <Input value={upiReference} onChange={(e) => setUpiReference(e.target.value)} placeholder="UPI reference" />
      ) : null}
      {method === 'card' ? (
        <Input value={cardReference} onChange={(e) => setCardReference(e.target.value)} placeholder="Card reference" />
      ) : null}
      {method === 'cheque' ? (
        <Input value={chequeReference} onChange={(e) => setChequeReference(e.target.value)} placeholder="Cheque number / reference" />
      ) : null}
      {method === 'split' ? (
        <div className="space-y-2">
          {splitPayments.map((payment, index) => (
            <div key={index} className="grid grid-cols-[92px_1fr_1fr] gap-2">
              <select
                value={payment.method}
                onChange={(e) => updateSplit(index, { method: e.target.value, reference_no: '' })}
                className="rounded-ctl border border-hair bg-raised px-2 text-[12px] text-dim"
              >
                <option value="cash">Cash</option>
                <option value="upi">UPI</option>
                <option value="card">Card</option>
                <option value="cheque">Cheque</option>
              </select>
              <Input
                value={payment.amount}
                onChange={(e) => updateSplit(index, { amount: e.target.value.replace(/[^\d.]/g, '') })}
                placeholder="Amount"
                inputMode="decimal"
              />
              <Input
                value={payment.reference_no}
                onChange={(e) => updateSplit(index, { reference_no: e.target.value })}
                placeholder={payment.method === 'cash' ? 'Reference' : 'Ref required'}
              />
            </div>
          ))}
        </div>
      ) : null}
      <label className="flex items-center gap-2 text-[11px] text-dim">
        <input
          type="checkbox"
          checked={allowPartial}
          onChange={(e) => setAllowPartial(e.target.checked)}
        />
        Allow partial payment
      </label>
    </div>
  );
}

function ReceiptDone({
  invoice,
  total,
  onNew,
  template,
  onPrint,
}) {
  return (
    <div className="py-4 text-center">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full border border-ok/40 bg-ok/10 text-2xl text-ok">
        ✓
      </div>
      <p className="mt-4 text-[15px] font-semibold text-bone">Payment complete</p>
      <p className="mt-1 font-mono text-[12px] text-mute">{invoice.invoice_number}</p>

      <p className="mt-5 font-mono text-[32px] font-bold text-amber">{rupees(total)}</p>
      <p className="mt-1 text-[11px] text-mute">via {methodLabel(invoice.payment_method)}</p>
      <PaymentSummary invoice={invoice} />

      <div className="mt-6 grid grid-cols-2 gap-2">
        <Button variant="secondary" className="flex-1 py-2.5" onClick={onPrint}>
          Reprint
        </Button>
        <Button className="flex-1 py-2.5" onClick={onNew}>
          New Bill
        </Button>
      </div>
      <p className="mt-4 font-mono text-[10px] text-mute">
        {template.toUpperCase()} template · invoice is immutable · returns issue a reversal
      </p>
    </div>
  );
}

function printDateTime(invoice) {
  const raw = invoice?.created_at || invoice?.date || new Date().toISOString();
  const d = new Date(raw);
  const safe = Number.isNaN(+d) ? new Date() : d;
  return {
    date: dateStr(safe.toISOString()),
    time: safe.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }),
  };
}

function barcodeValue(line) {
  return String(line?.barcode || line?.product_barcode || line?.sku || line?.product_id || '');
}

function renderBarcodeNode(node, options = {}) {
  const value = node?.getAttribute('data-barcode-value') || '';
  if (!node || !value) return;
  try {
    JsBarcode(node, value, {
      format: 'CODE128',
      width: options.width ?? 1.15,
      height: options.height ?? 30,
      displayValue: true,
      font: 'monospace',
      fontSize: options.fontSize ?? 8,
      margin: 0,
    });
  } catch {
    const fallback = node.ownerDocument.createElement('div');
    fallback.textContent = value;
    fallback.style.fontFamily = '"Courier New", monospace';
    fallback.style.fontSize = '10px';
    fallback.style.wordBreak = 'break-all';
    node.replaceWith(fallback);
  }
}

function invoiceCustomer(invoice, customer) {
  if (!customer && !invoice?.customer_id) return null;
  const name = customer?.name || invoice?.party_name || '';
  return {
    name: name.trim() || 'Customer',
    phone: customer?.phone || '—',
  };
}

function printStyles(template = 'a4') {
  const compact = template === 'compact';
  return `
    @page { size: A4; margin: 12mm; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: #fff;
      color: #111;
      font-family: Arial, Helvetica, sans-serif;
      font-size: 11px;
      line-height: 1.35;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .invoice {
      position: relative;
      width: 100%;
      max-width: 190mm;
      margin: 0 auto;
      background: #fff;
      color: #111;
      padding: ${compact ? '8mm' : '10mm'};
    }
    .invoice, .invoice * {
      color: #111 !important;
      text-shadow: none !important;
    }
    .invoice-content {
      position: relative;
      z-index: 1;
    }
    .invoice-header {
      display: grid;
      grid-template-columns: 1.25fr 0.75fr;
      gap: 16px;
      border: 1.5px solid #111;
      padding: 14px 16px;
      background: #fff;
    }
    .store-heading {
      display: flex;
      align-items: flex-start;
      gap: 10px;
      min-width: 0;
    }
    .store-name {
      margin: 0;
      font-size: 24px;
      font-weight: 900;
      letter-spacing: 0;
      color: #111 !important;
    }
    .store-meta, .invoice-meta, .customer-box, .footer {
      color: #222 !important;
    }
    .store-meta {
      max-width: 105mm;
    }
    .store-meta p, .invoice-meta p, .customer-box p {
      margin: 2px 0;
    }
    .invoice-title {
      margin: 0 0 7px;
      font-size: 16px;
      font-weight: 900;
      text-align: right;
      text-transform: uppercase;
      color: #111 !important;
    }
    .invoice-qr {
      width: ${compact ? '26mm' : '32mm'};
      height: ${compact ? '26mm' : '32mm'};
      margin-top: 8px;
      margin-left: auto;
      object-fit: contain;
    }
    .invoice-meta {
      text-align: right;
      font-family: "Courier New", monospace;
    }
    .section-title {
      margin: 14px 0 6px;
      font-size: 10px;
      font-weight: 900;
      letter-spacing: 0.08em;
      text-transform: uppercase;
      color: #111 !important;
    }
    .customer-box {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      border: 1px solid #111;
      padding: 8px 10px;
      gap: 3px 12px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      table-layout: fixed;
      font-size: ${compact ? '9px' : '10px'};
    }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
    th, td {
      border: 1px solid #111;
      padding: ${compact ? '3px 4px' : '5px 6px'};
      vertical-align: top;
      word-break: break-word;
      color: #111 !important;
    }
    th {
      background: #e5e7eb;
      color: #111 !important;
      font-size: 9px;
      text-align: left;
      text-transform: uppercase;
      font-weight: 900;
    }
    tbody tr { page-break-inside: avoid; break-inside: avoid; }
    .num, .money, .pct {
      text-align: right;
      font-family: "Courier New", monospace;
      white-space: nowrap;
    }
    .center { text-align: center; }
    .product-name {
      font-weight: 700;
      margin-bottom: 2px;
      overflow-wrap: anywhere;
    }
    .product-code {
      font-family: "Courier New", monospace;
      font-size: 9px;
      color: #333 !important;
    }
    .barcode-cell {
      text-align: center;
      padding: 3px;
    }
    .invoice-barcode {
      display: block;
      width: 100%;
      max-width: 32mm;
      height: 38px;
      margin: 0 auto;
    }
    .totals-wrap {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 74mm;
      gap: 14px;
      margin-top: 14px;
      align-items: start;
    }
    .tax-note {
      border: 1px solid #111;
      min-height: 72px;
      padding: 10px;
      background: #fafafa;
      color: #222 !important;
    }
    .tax-note p {
      margin: 5px 0 0;
    }
    .invoice-summary {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 6px;
      margin-top: 10px;
      font-family: "Courier New", monospace;
      font-size: 9px;
    }
    .payment-box {
      display: flex;
      flex-wrap: wrap;
      gap: 8px 14px;
      margin-top: 12px;
      border: 1px solid #111;
      background: #fafafa;
      padding: 8px 10px;
      font-family: "Courier New", monospace;
      font-size: 10px;
    }
    .payment-box strong {
      font-family: Arial, Helvetica, sans-serif;
      text-transform: uppercase;
    }
    .empty-lines {
      padding: 14px;
      text-align: center;
      color: #555;
    }
    .totals-table td {
      padding: 6px 8px;
    }
    .totals-table .label {
      font-weight: 700;
      text-transform: uppercase;
    }
    .grand-total td {
      background: #111;
      color: #fff !important;
      font-size: 14px;
      font-weight: 800;
    }
    .grand-total td * {
      color: #fff !important;
    }
    .footer {
      margin-top: 16px;
      border-top: 1px solid #111;
      padding-top: 10px;
      text-align: center;
      font-size: 10px;
    }
    .footer strong {
      display: block;
      margin-bottom: 3px;
      font-size: 12px;
    }
    .public-link {
      margin-top: 4px;
      font-family: "Courier New", monospace;
      font-size: 8px;
      word-break: break-all;
    }
    .compact .invoice-header { padding: 9px 10px; }
    .compact .store-name { font-size: 18px; }
    .compact .section-title { margin: 9px 0 4px; }
    .compact .totals-wrap { margin-top: 8px; }
    .compact .footer { margin-top: 9px; }
    .compact .invoice-summary { grid-template-columns: 1fr; }
    @media print {
      html, body { width: 210mm; min-height: 297mm; }
      .invoice { max-width: none; padding: 0; }
    }
  `;
}

function thermalPrintStyles() {
  return `
    @page { size: 80mm auto; margin: 4mm; }
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      background: #fff;
      color: #111;
      font-family: Arial, Helvetica, sans-serif;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .receipt {
      position: relative;
      width: 72mm;
      margin: 0 auto;
      padding: 4mm;
      overflow: hidden;
      background: #fff;
      color: #111;
      font-size: 9px;
      line-height: 1.35;
    }
    .receipt, .receipt * {
      color: #111 !important;
      text-shadow: none !important;
    }
    .receipt-content { position: relative; z-index: 1; }
    h1 {
      margin: 0;
      text-align: center;
      font-size: 14px;
      font-weight: 900;
      letter-spacing: 0;
      text-transform: uppercase;
    }
    .mono, .row, .muted, .footer-text { font-family: "Courier New", monospace; }
    .center { text-align: center; margin: 2px 0; }
    .dash { border-top: 1px dashed #111; margin: 7px 0; }
    .row { display: flex; justify-content: space-between; gap: 8px; margin: 2px 0; }
    .row span { min-width: 0; overflow-wrap: anywhere; }
    .row span:last-child { text-align: right; }
    .strong { font-weight: 700; }
    .item { margin: 5px 0; break-inside: avoid; }
    .item-name { font-weight: 700; overflow-wrap: anywhere; }
    .muted { color: #222 !important; font-size: 8px; }
    .empty-receipt-lines {
      margin: 7px 0;
      border: 1px dashed #111;
      padding: 5px;
      text-align: center;
      font-family: "Courier New", monospace;
      font-size: 8px;
    }
    .total {
      display: flex;
      justify-content: space-between;
      margin-top: 7px;
      border: 1px solid #111;
      background: #111;
      color: #fff !important;
      padding: 5px 6px;
      font-family: "Courier New", monospace;
      font-weight: 800;
      font-size: 11px;
    }
    .total span { color: #fff !important; }
    .payment-row { margin-top: 6px; font-weight: 700; }
    .receipt-barcode {
      display: block;
      width: 100%;
      max-width: 62mm;
      margin: 8px auto 0;
    }
    .receipt-qr {
      display: block;
      width: 28mm;
      height: 28mm;
      margin: 7px auto 0;
      object-fit: contain;
    }
    .public-link { word-break: break-all; }
    .footer-text { font-size: 8px; color: #222 !important; }
  `;
}

function waitForImages(doc) {
  const images = Array.from(doc.images || []);
  return Promise.all(
    images.map((img) => {
      if (img.complete) return Promise.resolve();
      return new Promise((resolve) => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      });
    }),
  );
}

function PaymentSummary({ invoice }) {
  const payments = invoice?.payments || [];
  if (!payments.length && !invoice?.amount_paid) return null;
  return (
    <div className="mt-4 rounded-ctl border border-hair bg-raised px-3 py-2 text-left">
      <p className="text-[9px] font-semibold tracking-[0.12em] text-mute">PAYMENT</p>
      {payments.map((payment) => (
        <div key={payment.id || `${payment.method}-${payment.reference_no}`} className="mt-2 flex justify-between gap-3 text-[11px]">
          <span className="text-dim">
            {methodLabel(payment.method)}
            {payment.reference_no ? ` · ${payment.reference_no}` : ''}
          </span>
          <span className="font-mono text-bone">{money(payment.amount)}</span>
        </div>
      ))}
      <Row label="Amount Paid" value={money(invoice.amount_paid ?? totalPaid(payments))} />
      {Number(invoice.change_due || 0) > 0 ? <Row label="Change Due" value={money(invoice.change_due)} tone="amber" /> : null}
      {Number(invoice.balance_due || 0) > 0 ? <Row label="Balance Due" value={money(invoice.balance_due)} tone="amber" /> : null}
    </div>
  );
}

function totalPaid(payments) {
  return payments.reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
}

function invoiceGrandTotal(invoice) {
  return (
    invoice?.grand_total ??
    invoice?.total ??
    Number(invoice?.taxable_value || 0) +
      Number(invoice?.cgst || 0) +
      Number(invoice?.sgst || 0) +
      Number(invoice?.igst || 0)
  );
}

function invoiceLineCount(invoice) {
  return invoiceLinesForReceipt(invoice).length;
}

function invoiceLinesForReceipt(invoice) {
  const rows = invoice?.items || invoice?.lines || invoice?.order_items || invoice?.products;
  if (!Array.isArray(rows)) return [];
  return rows.map((line, index) => ({
    order_item_id: line.order_item_id || line.id || index,
    product_id: line.product_id,
    product_name: line.product_name || line.name || line.description || `Product #${line.product_id ?? '—'}`,
    barcode: line.barcode || line.product_barcode || line.sku || '',
    quantity: line.quantity || line.qty || '1.000',
    rate: line.rate || line.unit_price || line.price || '0.00',
    discount_pct: line.discount_pct || line.discount_rate || '0.00',
    gst_rate: line.gst_rate || line.tax_rate || line.gst || '0.00',
    line_total: line.line_total || line.total || Number(line.unit_price || line.rate || 0) * Number(line.quantity || 1),
  }));
}

function invoiceTotalsForReceipt(invoice) {
  return {
    subtotal: invoice?.subtotal ?? invoice?.taxable_value ?? '0.00',
    discount: invoice?.discount ?? '0.00',
    taxable_value: invoice?.taxable_value ?? '0.00',
    cgst: invoice?.cgst ?? '0.00',
    sgst: invoice?.sgst ?? '0.00',
    igst: invoice?.igst ?? '0.00',
    grand_total: invoiceGrandTotal(invoice),
  };
}

function invoiceCustomerObject(invoice) {
  if (!invoice?.customer_id && !invoice?.party_name) return null;
  return {
    id: invoice.customer_id,
    name: invoice.party_name || 'Customer',
    phone: invoice.customer_phone || invoice.phone || '',
  };
}

async function qrDataUrl(value, width = 130) {
  if (!value) return '';
  try {
    return await QRCode.toDataURL(value, { width, margin: 1 });
  } catch {
    return '';
  }
}

async function printInvoice({
  invoice,
  lines,
  totals,
  customer,
  store = STORE_CONFIG,
  template = 'thermal',
}) {
  const printWindow = window.open('', '_blank', 'width=980,height=720');
  if (!printWindow) return;
  const invoiceUrl = absoluteInvoiceUrl(invoice?.public_invoice_url);
  const qrUrl = await qrDataUrl(invoiceUrl, template === 'thermal' ? 112 : 136);

  const invoiceHtml = renderToStaticMarkup(
    template === 'thermal' ? (
      <PrintableThermalReceipt
        invoice={invoice}
        lines={lines}
        totals={totals}
        customer={customer}
        store={store}
        qrUrl={qrUrl}
      />
    ) : (
      <PrintableInvoice
        invoice={invoice}
        lines={lines}
        totals={totals}
        customer={customer}
        store={store}
        qrUrl={qrUrl}
        compact={template === 'compact'}
      />
    ),
  );

  printWindow.document.open();
  printWindow.document.write(`
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>${invoice?.invoice_number || 'Invoice'}</title>
        <style>${template === 'thermal' ? thermalPrintStyles() : printStyles(template)}</style>
      </head>
      <body>${invoiceHtml}</body>
    </html>
  `);
  printWindow.document.close();

  await new Promise((resolve) => {
    if (printWindow.document.readyState === 'complete') resolve();
    else printWindow.addEventListener('load', resolve, { once: true });
  });

  const barcodeNodes = Array.from(
    printWindow.document.querySelectorAll('.invoice-barcode, .receipt-barcode'),
  );
  await Promise.resolve();
  barcodeNodes.forEach((node) => renderBarcodeNode(node));

  await printWindow.document.fonts?.ready;
  await waitForImages(printWindow.document);
  await new Promise((resolve) => printWindow.setTimeout(resolve, 150));
  printWindow.focus();
  printWindow.print();
  printWindow.onafterprint = () => printWindow.close();
}

function PrintableInvoice({
  invoice,
  lines = [],
  totals = EMPTY_TOTALS,
  customer,
  store = STORE_CONFIG,
  qrUrl = '',
  compact = false,
}) {
  const issued = printDateTime(invoice);
  const billedTo = invoiceCustomer(invoice, customer);
  const grandTotal =
    totals?.grand_total ??
    Number(invoice?.taxable_value || 0) +
      Number(invoice?.cgst || 0) +
      Number(invoice?.sgst || 0) +
      Number(invoice?.igst || 0);

  return (
    <main className={`invoice ${compact ? 'compact' : ''}`}>
      <div className="invoice-content">
        <header className="invoice-header">
          <section className="store-heading">
            <div>
              <h1 className="store-name">{store.name}</h1>
              <div className="store-meta">
                {storeBranchLabel(store) && <p>{storeBranchLabel(store)}</p>}
                {storeAddressLabel(store) && <p>{storeAddressLabel(store)}</p>}
                {storeGstinLabel(store) && <p>{storeGstinLabel(store)}</p>}
              </div>
            </div>
          </section>
          <section className="invoice-meta">
            <h2 className="invoice-title">Tax Invoice</h2>
            <p><strong>Invoice:</strong> {invoice?.invoice_number || '—'}</p>
            <p><strong>Status:</strong> {invoice?.status || 'Completed'}</p>
            <p><strong>Date:</strong> {issued.date}</p>
            <p><strong>Time:</strong> {issued.time}</p>
            <p><strong>Payment:</strong> {methodLabel(invoice?.payment_method)}</p>
            {qrUrl ? <img className="invoice-qr" src={qrUrl} alt="Invoice QR" /> : null}
          </section>
        </header>

        {billedTo ? (
          <>
            <h3 className="section-title">Customer Details</h3>
            <section className="customer-box">
              <p><strong>Name:</strong> {billedTo.name}</p>
              <p><strong>Phone:</strong> {billedTo.phone}</p>
              <p><strong>Customer ID:</strong> {invoice?.customer_id || '—'}</p>
              <p><strong>Sold By:</strong> Staff #{invoice?.staff_id ?? '—'}</p>
            </section>
          </>
        ) : null}

      <h3 className="section-title">Purchased Products</h3>
      <table>
        <thead>
          <tr>
            <th style={{ width: '8mm' }} className="center">#</th>
            <th style={{ width: '42mm' }}>Product</th>
            <th style={{ width: '20mm' }}>Product ID</th>
            <th style={{ width: '32mm' }}>Barcode</th>
            <th style={{ width: '14mm' }} className="num">Qty</th>
            <th style={{ width: '22mm' }} className="money">Unit Price</th>
            <th style={{ width: '16mm' }} className="pct">Disc %</th>
            <th style={{ width: '14mm' }} className="pct">GST %</th>
            <th style={{ width: '24mm' }} className="money">Line Total</th>
          </tr>
        </thead>
        <tbody>
          {lines.length ? lines.map((line, index) => {
            const code = barcodeValue(line);
            return (
              <tr key={line.order_item_id || `${line.product_id}-${index}`}>
                <td className="center">{index + 1}</td>
                <td>
                  <div className="product-name">{line.product_name || 'Product'}</div>
                  <div className="product-code">Code: {code}</div>
                </td>
                <td className="product-code">{line.product_id || '—'}</td>
                <td className="barcode-cell">
                  <svg className="invoice-barcode" data-barcode-value={code} />
                </td>
                <td className="num">{fmtQty(line.quantity)}</td>
                <td className="money">{money(line.rate)}</td>
                <td className="pct">{fmtQty(line.discount_pct)}%</td>
                <td className="pct">{fmtQty(line.gst_rate)}%</td>
                <td className="money">{money(line.line_total)}</td>
              </tr>
            );
          }) : (
            <tr>
              <td colSpan={9} className="empty-lines">
                Product line details are unavailable for this invoice record.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <section className="totals-wrap">
        <div className="tax-note">
          <strong>Return / Exchange Note</strong>
          <p>Returns or exchanges are accepted as per store policy with the original invoice and intact barcode labels.</p>
          <div className="invoice-summary">
            <span>Lines: {lines.length}</span>
            <span>Invoice ID: {invoice?.id || '—'}</span>
            <span>Outlet: {invoice?.outlet_id || '—'}</span>
          </div>
        </div>
        <table className="totals-table">
          <tbody>
            <tr><td className="label">Subtotal</td><td className="money">{money(totals?.subtotal)}</td></tr>
            <tr><td className="label">Discount</td><td className="money">{money(totals?.discount)}</td></tr>
            <tr><td className="label">Taxable Value</td><td className="money">{money(totals?.taxable_value ?? invoice?.taxable_value)}</td></tr>
            <tr><td className="label">CGST</td><td className="money">{money(totals?.cgst ?? invoice?.cgst)}</td></tr>
            <tr><td className="label">SGST</td><td className="money">{money(totals?.sgst ?? invoice?.sgst)}</td></tr>
            <tr><td className="label">IGST</td><td className="money">{money(totals?.igst ?? invoice?.igst)}</td></tr>
            <tr className="grand-total"><td>Grand Total</td><td className="money">{rupees(grandTotal)}</td></tr>
          </tbody>
        </table>
      </section>

      <section className="payment-box">
        <strong>Payment Summary</strong>
        <span>{methodLabel(invoice?.payment_method)} · Paid {money(invoice?.amount_paid ?? grandTotal)}</span>
        {Number(invoice?.change_due || 0) > 0 ? <span>Change Due {money(invoice.change_due)}</span> : null}
        {Number(invoice?.balance_due || 0) > 0 ? <span>Balance Due {money(invoice.balance_due)}</span> : null}
      </section>

      <footer className="footer">
        <strong>{store.name}</strong>
        <div>Computer Generated Invoice</div>
        <div>{store.receiptFooter}</div>
        {invoice?.public_invoice_url ? <div className="public-link">{absoluteInvoiceUrl(invoice.public_invoice_url)}</div> : null}
      </footer>
      </div>
    </main>
  );
}

function PrintableThermalReceipt({
  invoice,
  lines = [],
  totals = EMPTY_TOTALS,
  customer,
  store = STORE_CONFIG,
  qrUrl = '',
}) {
  const issued = printDateTime(invoice);
  const billedTo = invoiceCustomer(invoice, customer);
  const grandTotal = totals?.grand_total ?? invoiceGrandTotal(invoice);

  return (
    <main className="receipt">
      <div className="receipt-content">
        <h1>{store.name}</h1>
        {storeBranchLabel(store) ? <p className="center">{storeBranchLabel(store)}</p> : null}
        {storeAddressLabel(store) ? <p className="center muted">{storeAddressLabel(store)}</p> : null}
        {storeGstinLabel(store) ? <p className="center mono">{storeGstinLabel(store)}</p> : null}
        <div className="dash" />
        <div className="row strong"><span>TAX INVOICE</span><span>{invoice?.invoice_number || '—'}</span></div>
        <div className="row"><span>{issued.date}</span><span>{issued.time}</span></div>
        <div className="row"><span>Payment</span><span>{methodLabel(invoice?.payment_method)}</span></div>
        <div className="row"><span>Lines</span><span>{lines.length}</span></div>
        {billedTo ? (
          <>
            <div className="dash" />
            <div className="row"><span>Customer</span><span>{billedTo.name}</span></div>
            <div className="row"><span>Phone</span><span>{billedTo.phone}</span></div>
          </>
        ) : null}
        <div className="dash" />
        {lines.length ? lines.map((line, index) => (
          <section key={line.order_item_id || index} className="item">
            <div className="item-name">{line.product_name || 'Product'}</div>
            <div className="row"><span>{fmtQty(line.quantity)} x {money(line.rate)}</span><span>{money(line.line_total)}</span></div>
            <div className="muted">GST {fmtQty(line.gst_rate)}% · BC {barcodeValue(line) || '—'}</div>
          </section>
        )) : (
          <p className="empty-receipt-lines">Product line details unavailable.</p>
        )}
        <div className="dash" />
        <div className="row"><span>Taxable</span><span>{money(totals.taxable_value)}</span></div>
        <div className="row"><span>CGST</span><span>{money(totals.cgst)}</span></div>
        <div className="row"><span>SGST</span><span>{money(totals.sgst)}</span></div>
        <div className="row"><span>IGST</span><span>{money(totals.igst)}</span></div>
        <div className="total"><span>TOTAL</span><span>{rupees(grandTotal)}</span></div>
        <div className="row payment-row"><span>Paid</span><span>{money(invoice?.amount_paid ?? grandTotal)}</span></div>
        {Number(invoice?.change_due || 0) > 0 ? <div className="row"><span>Change</span><span>{money(invoice.change_due)}</span></div> : null}
        {Number(invoice?.balance_due || 0) > 0 ? <div className="row"><span>Balance</span><span>{money(invoice.balance_due)}</span></div> : null}
        <svg className="receipt-barcode" data-barcode-value={invoice?.invoice_number || ''} />
        {qrUrl ? <img className="receipt-qr" src={qrUrl} alt="Invoice QR" /> : null}
        {invoice?.public_invoice_url ? (
          <p className="center footer-text public-link">{absoluteInvoiceUrl(invoice.public_invoice_url)}</p>
        ) : null}
        <p className="center footer-text">{store.receiptFooter}</p>
        <p className="center footer-text">Computer Generated Invoice</p>
      </div>
    </main>
  );
}
