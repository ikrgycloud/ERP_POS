/**
 * Single API client for the whole app.
 *
 * - Attaches the bearer token to every request.
 * - On a 401, transparently refreshes once and retries the original request.
 *   Concurrent 401s share one refresh promise so we never stampede.
 * - Normalizes FastAPI's error shapes into a plain `ApiError` with `.message`.
 */

import { API_CONFIG } from '../config/appConfig';
import { ERROR_MESSAGES } from '../constants/messages';
import { emitDataChange } from './sync';

const BASE = `${API_CONFIG.baseUrl}${API_CONFIG.versionPath}`;
const REQUEST_TIMEOUT_MS = API_CONFIG.requestTimeoutMs;
const CHECKOUT_TIMEOUT_MS = 90_000;
const NETWORK_RETRY_DELAYS = [600, 1400, 3000];

const KEY_ACCESS = 'pos.access';
const KEY_REFRESH = 'pos.refresh';
const KEY_TERMINAL = 'pos.terminal_id';
const KEY_TERMINAL_SECRET = 'pos.terminal_secret';

function makeTerminalId() {
  const random =
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 8)
      : `${Date.now().toString(36)}${Math.random().toString(16).slice(2, 6)}`;
  return `TERM-${random.toUpperCase()}`;
}

export const terminal = {
  get id() {
    if (typeof localStorage === 'undefined') return 'default';
    let id = localStorage.getItem(KEY_TERMINAL);
    if (!id) {
      id = makeTerminalId();
      localStorage.setItem(KEY_TERMINAL, id);
    }
    return id;
  },
  get secret() {
    if (typeof localStorage === 'undefined') return '';
    return localStorage.getItem(KEY_TERMINAL_SECRET) || '';
  },
  setSecret(secret) {
    if (typeof localStorage === 'undefined') return;
    if (secret) localStorage.setItem(KEY_TERMINAL_SECRET, secret);
    else localStorage.removeItem(KEY_TERMINAL_SECRET);
  },
};

export const tokens = {
  get access() {
    return localStorage.getItem(KEY_ACCESS);
  },
  get refresh() {
    return localStorage.getItem(KEY_REFRESH);
  },
  set({ access_token, refresh_token }) {
    localStorage.setItem(KEY_ACCESS, access_token);
    localStorage.setItem(KEY_REFRESH, refresh_token);
  },
  clear() {
    localStorage.removeItem(KEY_ACCESS);
    localStorage.removeItem(KEY_REFRESH);
  },
};

export class ApiError extends Error {
  constructor(message, status, detail, code) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.detail = detail;
    this.code = code;
  }
}

export function isNetworkError(err) {
  return err?.status === 0 || err?.code === 'NETWORK_ERROR' || err?.code === 'TIMEOUT';
}

export function isCancelledError(err) {
  return err?.code === 'CANCELLED';
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emitConnection(status, detail) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('pos:connection', { detail: { status, detail } }));
}

/**
 * FastAPI returns `{detail: "..."}` for HTTPException and our AppError handler,
 * but `{detail: [{loc, msg, type}, ...]}` for pydantic validation failures.
 * Flatten both into one readable string.
 */
function readDetail(body, status) {
  if (!body) return `Request failed (${status})`;
  const d = body.details ?? body.detail;
  if (typeof d === 'string') return d;
  if (Array.isArray(d)) {
    const message = d
      .map((e) => {
        const field = Array.isArray(e.loc) ? e.loc.slice(1).join('.') : '';
        return field ? `${field}: ${e.msg}` : e.msg;
      })
      .join(' · ');
    if (message) return message;
  }
  if (typeof body.message === 'string') return body.message;
  if (body.error && typeof body.error.message === 'string') return body.error.message;
  return `Request failed (${status})`;
}

let refreshing = null;

async function doRefresh() {
  const rt = tokens.refresh;
  if (!rt) throw new ApiError(ERROR_MESSAGES.SESSION_EXPIRED, 401);

  const res = await fetchWithTimeout(
    `${BASE}/auth/refresh`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: rt }),
    },
  );
  if (!res.ok) {
    tokens.clear();
    throw new ApiError(ERROR_MESSAGES.SESSION_EXPIRED, 401);
  }
  const data = await res.json();
  tokens.set(data);
  return data.access_token;
}

async function refreshOnce() {
  if (!refreshing) {
    refreshing = doRefresh().finally(() => {
      refreshing = null;
    });
  }
  return refreshing;
}

function createAbortController(signal, timeoutMs) {
  const controller = new AbortController();
  let timeout = null;
  const abortFromSignal = () => controller.abort(signal?.reason);
  if (signal?.aborted) {
    abortFromSignal();
  } else if (signal) {
    signal.addEventListener('abort', abortFromSignal, { once: true });
  }
  if (timeoutMs > 0) {
    timeout = setTimeout(() => controller.abort(new Error('Request timed out')), timeoutMs);
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeout) clearTimeout(timeout);
      if (signal) signal.removeEventListener('abort', abortFromSignal);
    },
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const externalSignal = options.signal;
  const { signal, cleanup } = createAbortController(externalSignal, timeoutMs);
  try {
    return await fetch(url, { ...options, signal });
  } catch (err) {
    if (err?.name === 'AbortError' || signal.aborted) {
      if (externalSignal?.aborted) {
        throw new ApiError('Request cancelled', 0, null, 'CANCELLED');
      }
      throw new ApiError(ERROR_MESSAGES.TIMEOUT, 0, null, 'TIMEOUT');
    }
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      throw new ApiError(ERROR_MESSAGES.OFFLINE, 0, null, 'NETWORK_ERROR');
    }
    throw new ApiError(ERROR_MESSAGES.NETWORK, 0, null, 'NETWORK_ERROR');
  } finally {
    cleanup();
  }
}

async function waitUntilOnline() {
  if (typeof window === 'undefined' || typeof navigator === 'undefined' || navigator.onLine !== false) return;
  await new Promise((resolve) => {
    window.addEventListener('online', resolve, { once: true });
  });
}

function requestId(prefix) {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function terminalHeaders(extra = {}) {
  return {
    'X-Terminal-Id': terminal.id,
    ...(terminal.secret ? { 'X-Terminal-Secret': terminal.secret } : {}),
    ...extra,
  };
}

async function raw(
  path,
  { method = 'GET', body, params, auth = true, headers: extraHeaders, timeoutMs, signal } = {},
) {
  let url = `${BASE}${path}`;
  if (params) {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined && v !== null),
    ).toString();
    if (qs) url += `?${qs}`;
  }

  const headers = { ...(extraHeaders || {}) };
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  if (body !== undefined && !isForm) headers['Content-Type'] = 'application/json';
  if (auth && tokens.access) headers.Authorization = `Bearer ${tokens.access}`;

  const res = await fetchWithTimeout(
    url,
    {
      method,
      headers,
      signal,
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
    },
    timeoutMs ?? REQUEST_TIMEOUT_MS,
  );
  return res;
}

async function request(path, opts = {}) {
  const method = opts.method || 'GET';
  const retries =
    opts.retries ?? (['GET', 'HEAD'].includes(String(method).toUpperCase()) ? 2 : 0);

  let res;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await waitUntilOnline();
      res = await raw(path, opts);
      if (attempt > 0) emitConnection('online');
      break;
    } catch (err) {
      if (isCancelledError(err)) throw err;
      if (!isNetworkError(err) || attempt >= retries) {
        emitConnection('offline', err);
        throw err;
      }
      emitConnection('offline', err);
      await sleep(NETWORK_RETRY_DELAYS[Math.min(attempt, NETWORK_RETRY_DELAYS.length - 1)]);
    }
  }

  if (res.status === 401 && opts.auth !== false && tokens.refresh) {
    try {
      await refreshOnce();
      res = await raw(path, opts); // retry once with the fresh token
    } catch (err) {
      if (isNetworkError(err)) {
        emitConnection('offline', err);
        throw err;
      }
      tokens.clear();
      window.dispatchEvent(new CustomEvent('pos:logout'));
      throw new ApiError(ERROR_MESSAGES.SIGN_IN_AGAIN, 401);
    }
  }

  if (res.status === 204) return null;

  let payload = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) {
    payload = await res.json().catch(() => null);
  }

  if (!res.ok) {
    if (res.status === 401) {
      tokens.clear();
      window.dispatchEvent(new CustomEvent('pos:logout'));
    }
    const code =
      payload?.error && typeof payload.error === 'object'
        ? payload.error.code
        : payload?.error;
    throw new ApiError(readDetail(payload, res.status), res.status, payload, code);
  }
  if (!['GET', 'HEAD'].includes(String(method).toUpperCase())) {
    emitDataChange(path, method);
  }
  return payload;
}

export const api = {
  get: (p, params, opts) => request(p, { ...opts, params }),
  post: (p, body, params, opts) => request(p, { ...opts, method: 'POST', body, params }),
  put: (p, body, opts) => request(p, { ...opts, method: 'PUT', body }),
  patch: (p, body, params, opts) => request(p, { ...opts, method: 'PATCH', body, params }),
  del: (p, opts) => request(p, { ...opts, method: 'DELETE' }),
  upload: (p, file, opts) => {
    const form = new FormData();
    form.append('file', file);
    return request(p, { ...opts, method: 'POST', body: form });
  },
};

/* ------------------------------------------------------------------ *
 * Typed endpoint wrappers — one per route in pos_api_endpoints.md.
 * Keeping them here means screens never build URLs by hand.
 * ------------------------------------------------------------------ */
export const Auth = {
  login: (employee_code, password, opts) =>
    request('/auth/login', {
      ...opts,
      method: 'POST',
      body: { employee_code, password },
      auth: false,
    }),
  me: (opts) => api.get('/auth/me', undefined, opts),
  changePassword: (old_password, new_password, opts) =>
    api.post('/auth/change-password', { old_password, new_password }, undefined, opts),
};

export const Staff = {
  list: (params, opts) => api.get('/staff', params, opts),
  get: (id, opts) => api.get(`/staff/${id}`, undefined, opts),
  create: (payload, opts) => api.post('/staff', payload, undefined, opts),
  update: (id, payload, opts) => api.put(`/staff/${id}`, payload, opts),
  setStatus: (id, is_active, opts) => api.patch(`/staff/${id}/status`, { is_active }, undefined, opts),
  resetPassword: (id, new_password, opts) =>
    api.post(`/staff/${id}/reset-password`, { new_password }, undefined, opts),
  report: (id, opts) => api.get(`/staff/${id}/report`, undefined, opts),
  remove: (id, opts) => api.del(`/staff/${id}`, opts),
};

export const Catalog = {
  products: (params, opts) => api.get('/products', params, opts),
  product: (id, opts) => api.get(`/products/${id}`, undefined, opts),
  scan: (barcode, quantity = 1, opts) =>
    api.get(`/products/barcode/${encodeURIComponent(barcode)}`, { quantity }, opts),
  createProduct: (payload, opts) => api.post('/products', payload, undefined, opts),
  updateProduct: (id, payload, opts) => api.put(`/products/${id}`, payload, opts),
  categories: (opts) => api.get('/categories', undefined, opts),
  suppliers: (opts) => api.get('/suppliers', undefined, opts),
  lowStock: (opts) => api.get('/inventory/low-stock', undefined, opts),
  outOfStock: (opts) => api.get('/inventory/out-of-stock', undefined, opts),
  damaged: (opts) => api.get('/inventory/damaged', undefined, opts),
  stockHistory: (id, opts) => api.get(`/products/${id}/quantities`, undefined, opts),
  adjustStock: (id, payload, opts) => api.post(`/products/${id}/quantities`, payload, undefined, opts),
};

export const Customers = {
  list: (opts) => api.get('/customers', undefined, opts),
  byPhone: (phone, opts) => api.get(`/customers/phone/${encodeURIComponent(phone)}`, undefined, opts),
  create: (payload, opts) => api.post('/customers', payload, undefined, opts),
  update: (id, payload, opts) => api.put(`/customers/${id}`, payload, opts),
};

const checkoutAttempts = new Map();

export const Billing = {
  activeCart: (inter_state = false, opts) =>
    api.get('/pos/cart/active', { inter_state }, { ...opts, headers: terminalHeaders(opts?.headers), retries: opts?.retries ?? 0 }),
  renewLease: (orderId, opts) =>
    api.post(`/pos/cart/${orderId}/lease/renew`, undefined, undefined, {
      ...opts,
      headers: terminalHeaders(opts?.headers),
    }),
  startCart: (payload = {}, opts) =>
    api.post('/pos/cart', payload, undefined, { ...opts, headers: terminalHeaders(opts?.headers) }),
  cancelCart: (orderId, opts) =>
    api.post(`/pos/cart/${orderId}/cancel`, undefined, undefined, { ...opts, headers: terminalHeaders(opts?.headers) }),
  voidCart: (orderId, opts) =>
    api.post(`/pos/cart/${orderId}/void`, undefined, undefined, { ...opts, headers: terminalHeaders(opts?.headers) }),
  cleanupExpiredCarts: (opts) =>
    api.post('/pos/cart/cleanup', undefined, undefined, { ...opts, headers: terminalHeaders(opts?.headers) }),
  attachCustomer: (orderId, customer_id, opts) =>
    api.patch(`/pos/cart/${orderId}/customer`, { customer_id }, undefined, {
      ...opts,
      headers: terminalHeaders(opts?.headers),
    }),
  scan: (orderId, barcode, quantity = 1, opts) =>
    api.post(`/pos/cart/${orderId}/scan`, { barcode, quantity }, undefined, {
      ...opts,
      headers: terminalHeaders(opts?.headers),
    }),
  updateLine: (orderId, itemId, { product_id, quantity }, opts) =>
    api.patch(`/pos/cart/${orderId}/items/${itemId}`, {
      product_id,
      quantity,
    }, undefined, {
      ...opts,
      headers: terminalHeaders(opts?.headers),
    }),
  removeLine: (orderId, itemId, opts) =>
    api.del(`/pos/cart/${orderId}/items/${itemId}`, { ...opts, headers: terminalHeaders(opts?.headers) }),
  totals: (orderId, inter_state = false, opts) =>
    api.get(`/pos/cart/${orderId}/totals`, { inter_state }, { ...opts, headers: terminalHeaders(opts?.headers) }),
  checkout: (orderId, payloadOrMethod, inter_state = false, opts) => {
    const payload =
      typeof payloadOrMethod === 'string'
        ? { payment_method: payloadOrMethod, inter_state }
        : { ...(payloadOrMethod || {}), inter_state: payloadOrMethod?.inter_state ?? inter_state };
    let idempotencyKey = checkoutAttempts.get(orderId);
    if (!idempotencyKey) {
      idempotencyKey = requestId(`pos-checkout-${orderId}`);
      checkoutAttempts.set(orderId, idempotencyKey);
    }
    return api.post(`/pos/cart/${orderId}/checkout`, payload, undefined, {
      ...opts,
      headers: terminalHeaders({ ...(opts?.headers || {}), 'Idempotency-Key': idempotencyKey }),
      timeoutMs: CHECKOUT_TIMEOUT_MS,
    }).then(
      (result) => {
        checkoutAttempts.delete(orderId);
        return result;
      },
      (error) => {
        // Preserve the key when delivery is uncertain, preventing duplicate invoices on retry.
        if (!isNetworkError(error) && error?.status !== 409) checkoutAttempts.delete(orderId);
        throw error;
      },
    );
  },
  clearCheckoutAttempt: (orderId) => checkoutAttempts.delete(orderId),
};

export const EnterprisePOS = {
  timeline: (params = {}, opts) => api.get('/pos/enterprise/timeline', params, { ...opts, headers: terminalHeaders(opts?.headers) }),
  approvals: (params = {}, opts) => api.get('/pos/enterprise/approvals', params, { ...opts, headers: terminalHeaders(opts?.headers) }),
  requestApproval: (payload, opts) =>
    api.post('/pos/enterprise/approvals', payload, undefined, { ...opts, headers: terminalHeaders(opts?.headers) }),
  approve: (id, payload = {}, opts) =>
    api.post(`/pos/enterprise/approvals/${id}/approve`, payload, undefined, { ...opts, headers: terminalHeaders(opts?.headers) }),
  reject: (id, payload = {}, opts) =>
    api.post(`/pos/enterprise/approvals/${id}/reject`, payload, undefined, { ...opts, headers: terminalHeaders(opts?.headers) }),
  shifts: (opts) => api.get('/pos/enterprise/shifts', undefined, { ...opts, headers: terminalHeaders(opts?.headers) }),
  activeShift: (opts) => api.get('/pos/enterprise/shifts/active', undefined, { ...opts, headers: terminalHeaders(opts?.headers) }),
  openShift: (payload, opts) =>
    api.post('/pos/enterprise/shifts/open', payload, undefined, { ...opts, headers: terminalHeaders(opts?.headers) }),
  closeShift: (id, payload, opts) =>
    api.post(`/pos/enterprise/shifts/${id}/close`, payload, undefined, { ...opts, headers: terminalHeaders(opts?.headers) }),
  drawerEvent: (payload, opts) =>
    api.post('/pos/enterprise/drawer-events', payload, undefined, { ...opts, headers: terminalHeaders(opts?.headers) }),
  registerTerminal: (payload, opts) =>
    api.post('/pos/enterprise/terminals/register', payload, undefined, {
      ...opts,
      headers: terminalHeaders(opts?.headers),
    }).then((result) => {
      if (payload?.secret) terminal.setSecret(payload.secret);
      return result;
    }),
};

export const Invoices = {
  list: (params, opts) => api.get('/invoices', params, opts),
  get: (id, opts) => api.get(`/invoices/${id}`, undefined, opts),
  byNumber: (n, opts) => api.get(`/invoices/number/${encodeURIComponent(n)}`, undefined, opts),
  payments: (id, opts) => api.get(`/invoices/${id}/payments`, undefined, opts),
  notifications: (id, opts) => api.get(`/invoices/${id}/notifications`, undefined, opts),
  resendNotification: (id, channel, opts) =>
    api.post(`/invoices/${id}/notifications/resend`, { channel }, undefined, opts),
};

export const Returns = {
  list: (params, opts) => api.get('/returns', params, opts),
  get: (id, opts) => api.get(`/returns/${id}`, undefined, opts),
  submit: (payload, opts) => api.post('/returns', payload, undefined, opts),
  lookup: (payload, opts) => api.post('/returns/lookup', payload, undefined, opts),
  setStatus: (id, status, opts) => api.patch(`/returns/${id}/status`, { status }, undefined, opts),
  process: (id, inter_state = false, opts) =>
    api.post(`/returns/${id}/process`, undefined, { inter_state }, opts),
  evidenceLink: (id, api_base, opts) =>
    api.post(`/returns/${id}/evidence-link`, undefined, api_base ? { api_base } : undefined, opts),
  evidence: (id, opts) => api.get(`/returns/${id}/evidence`, undefined, opts),
  damageTypes: (opts) => api.get('/returns/damage-types', undefined, opts),
};

export const PublicReturnEvidence = {
  info: (token, opts) =>
    request(`/returns/public/evidence/${encodeURIComponent(token)}`, {
      ...opts,
      auth: false,
      retries: 0,
    }),
  upload: (token, file, note, opts) => {
    const form = new FormData();
    form.append('file', file);
    if (note) form.append('note', note);
    return request(`/returns/public/evidence/${encodeURIComponent(token)}`, {
      ...opts,
      method: 'POST',
      body: form,
      auth: false,
      retries: 0,
    });
  },
};

export const Settings = {
  invoiceBranding: (opts) => api.get('/settings/invoice-branding', undefined, opts),
  updateInvoiceBranding: (payload, opts) => api.put('/settings/invoice-branding', payload, opts),
};

export const Reports = {
  bmDashboard: (opts) => api.get('/dashboard/branch-manager', undefined, opts),
  smDashboard: (opts) => api.get('/dashboard/sales-manager', undefined, opts),
  spDashboard: (opts) => api.get('/dashboard/sales-person', undefined, opts),
  revenue: (opts) => api.get('/reports/revenue', undefined, opts),
  payments: (opts) => api.get('/reports/payments', undefined, opts),
  returns: (opts) => api.get('/reports/returns', undefined, opts),
  returnSummary: (params, opts) => api.get('/reports/returns/summary', params, opts),
  returnTrends: (params, opts) => api.get('/reports/returns/trends', params, opts),
  returnBreakdowns: (params, opts) => api.get('/reports/returns/breakdowns', params, opts),
  returnTable: (params, opts) => api.get('/reports/returns/table', params, opts),
  returnInsights: (params, opts) => api.get('/reports/returns/insights', params, opts),
  returnProductHealth: (params, opts) => api.get('/reports/returns/product-health', params, opts),
  returnSuppliers: (params, opts) => api.get('/reports/returns/supplier', params, opts),
  returnCustomers: (params, opts) => api.get('/reports/returns/customer', params, opts),
  returnEmployees: (params, opts) => api.get('/reports/returns/employee', params, opts),
  returnInventory: (params, opts) => api.get('/reports/returns/inventory', params, opts),
  productInsights: (params, opts) => api.get('/reports/products/insights', params, opts),
  paymentsSummary: (opts) => api.get('/payments/summary', undefined, opts),
  notificationAnalytics: (opts) => api.get('/reports/notifications', undefined, opts),
};

export const PublicInvoices = {
  get: (token, opts) =>
    request(`/public/invoices/${encodeURIComponent(token)}`, {
      ...opts,
      auth: false,
    }),
};

export const apiClient = {
  request,
  raw,
  get: api.get,
  post: api.post,
  put: api.put,
  patch: api.patch,
  del: api.del,
  upload: api.upload,
};

export const PosEndpoints = {
  auth: Auth,
  staff: Staff,
  catalog: Catalog,
  customers: Customers,
  billing: Billing,
  enterprise: EnterprisePOS,
  invoices: Invoices,
  returns: Returns,
  reports: Reports,
  settings: Settings,
  publicInvoices: PublicInvoices,
  publicReturnEvidence: PublicReturnEvidence,
};
