import { emitDataChange, invalidationFor } from "./sync";
import { API_BASE_URL, API_ROOT_URL } from "../config/apiConfig";

const WEB_SESSION_KEY = "erp-session";
let activeBusinessProfileId = null;
let activeAccessToken = null;
const PAGED_CACHE_TTL_MS = 15_000;
const PAGE_LIMIT = 100;
const MAX_RECORDS_PER_COLLECTION = 10_000;
const PAGE_PREFETCH_CONCURRENCY = 6;
const REQUEST_TIMEOUT_MS = 30_000;
const NETWORK_RETRY_DELAYS = [600, 1400, 3000];
const pagedRequestCache = new Map();

export class ApiError extends Error {
  constructor(message, status = 0, detail = null, code = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.detail = detail;
    this.code = code;
  }
}

export function isNetworkError(error) {
  return error?.status === 0 && ["NETWORK_ERROR", "TIMEOUT"].includes(error?.code);
}

export function isCancelledError(error) {
  return error?.code === "CANCELLED";
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function emitConnection(status, detail) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent("erp:connection", { detail: { status, detail } }));
}

function clearPagedCache(path = null, method = "POST") {
  if (!path || path.startsWith("/business-profile")) {
    pagedRequestCache.clear();
    return;
  }
  const affected = new Set(invalidationFor(path, method).domains);
  for (const [key, entry] of pagedRequestCache.entries()) {
    const cachedDomains = invalidationFor(entry.path, "GET").domains;
    if (cachedDomains.some((domain) => affected.has(domain))) {
      pagedRequestCache.delete(key);
    }
  }
}

function shouldEmitDataChange(path, method) {
  const normalizedMethod = String(method || "GET").toUpperCase();
  const cleanPath = String(path || "").split("?")[0];
  if (["GET", "HEAD"].includes(normalizedMethod)) {
    return false;
  }
  return cleanPath !== "/orders/quote";
}

function readStoredBusinessProfileId() {
  if (activeBusinessProfileId) {
    return activeBusinessProfileId;
  }
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const savedSession = window.localStorage?.getItem(WEB_SESSION_KEY);
    if (!savedSession) {
      return null;
    }
    return JSON.parse(savedSession)?.businessProfile?.id || null;
  } catch {
    return null;
  }
}

function readStoredAccessToken() {
  if (activeAccessToken) {
    return activeAccessToken;
  }
  if (typeof window === "undefined") {
    return null;
  }
  try {
    const savedSession = window.localStorage?.getItem(WEB_SESSION_KEY);
    if (!savedSession) {
      return null;
    }
    return JSON.parse(savedSession)?.accessToken || null;
  } catch {
    return null;
  }
}

function setActiveBusinessProfileId(profileId) {
  if (activeBusinessProfileId !== (profileId || null)) {
    clearPagedCache();
  }
  activeBusinessProfileId = profileId || null;
  if (!profileId) {
    activeAccessToken = null;
  }
}

function setActiveAccessToken(token) {
  activeAccessToken = token || null;
}

function authHeaders() {
  const token = readStoredAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function createAbortController(signal, timeoutMs) {
  const controller = new AbortController();
  let timeout = null;
  const abortFromSignal = () => controller.abort(signal?.reason);
  if (signal?.aborted) {
    abortFromSignal();
  } else if (signal) {
    signal.addEventListener("abort", abortFromSignal, { once: true });
  }
  if (timeoutMs > 0) {
    timeout = setTimeout(() => controller.abort(new Error("Request timed out")), timeoutMs);
  }
  return {
    signal: controller.signal,
    cleanup: () => {
      if (timeout) {
        clearTimeout(timeout);
      }
      if (signal) {
        signal.removeEventListener("abort", abortFromSignal);
      }
    },
  };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = REQUEST_TIMEOUT_MS) {
  const externalSignal = options.signal;
  const { signal, cleanup } = createAbortController(externalSignal, timeoutMs);
  try {
    return await fetch(url, { ...options, signal });
  } catch (error) {
    if (error?.name === "AbortError" || error?.name === "TimeoutError" || signal.aborted) {
      if (externalSignal?.aborted) {
        throw new ApiError("Request cancelled", 0, null, "CANCELLED");
      }
      throw new ApiError("Request timed out", 0, null, "TIMEOUT");
    }
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      throw new ApiError("You appear to be offline", 0, null, "NETWORK_ERROR");
    }
    throw new ApiError("Network request failed", 0, null, "NETWORK_ERROR");
  } finally {
    cleanup();
  }
}

async function waitUntilOnline() {
  if (typeof window === "undefined" || typeof navigator === "undefined" || navigator.onLine !== false) {
    return;
  }
  await new Promise((resolve) => {
    window.addEventListener("online", resolve, { once: true });
  });
}

async function parseJsonResponse(response) {
  const text = await response.text();
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return { detail: text || `Request failed with status ${response.status}` };
  }
}

async function rawRequest(path, options = {}) {
  const method = options.method || "GET";
  const { retries: _retries, timeoutMs, ...fetchOptions } = options;
  const businessProfileId = readStoredBusinessProfileId();
  return fetchWithTimeout(`${API_BASE_URL}${path}`, {
    ...fetchOptions,
    headers: {
      "Content-Type": "application/json",
      ...authHeaders(),
      ...(businessProfileId ? { "X-Business-Profile-ID": String(businessProfileId) } : {}),
      ...(options.headers || {}),
    },
  }, timeoutMs ?? REQUEST_TIMEOUT_MS);
}

async function request(path, options = {}) {
  const method = options.method || "GET";
  const retries =
    options.retries ?? (["GET", "HEAD"].includes(String(method).toUpperCase()) ? 2 : 0);
  let response = null;

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      await waitUntilOnline();
      response = await rawRequest(path, options);
      if (attempt > 0) {
        emitConnection("online");
      }
      break;
    } catch (error) {
      if (isCancelledError(error)) {
        throw error;
      }
      if (!isNetworkError(error) || attempt >= retries) {
        emitConnection("offline", error);
        throw error;
      }
      emitConnection("offline", error);
      await sleep(NETWORK_RETRY_DELAYS[Math.min(attempt, NETWORK_RETRY_DELAYS.length - 1)]);
    }
  }

  const data = await parseJsonResponse(response);

  if (!response.ok) {
    if (response.status === 401 && path !== "/business-profile/login" && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("erp:unauthorized"));
    }
    throw new ApiError(readErrorMessage(data), response.status, data, data?.code || data?.error || null);
  }

  if (shouldEmitDataChange(path, method)) {
    clearPagedCache(path, method);
    emitDataChange(path, method);
  }
  return data;
}

async function blobRequest(path, options = {}) {
  const { timeoutMs, retries: _retries, ...fetchOptions } = options;
  const businessProfileId = readStoredBusinessProfileId();
  const response = await fetchWithTimeout(`${API_BASE_URL}${path}`, {
    ...fetchOptions,
    headers: {
      ...authHeaders(),
      ...(businessProfileId ? { "X-Business-Profile-ID": String(businessProfileId) } : {}),
      ...(options.headers || {}),
    },
  }, timeoutMs ?? REQUEST_TIMEOUT_MS);

  if (!response.ok) {
    const data = await parseJsonResponse(response);
    throw new ApiError(readErrorMessage(data), response.status, data, data?.code || data?.error || null);
  }

  return response.blob();
}

async function uploadRequest(path, formData, options = {}) {
  const method = options.method || "POST";
  const { timeoutMs, retries: _retries, ...fetchOptions } = options;
  const businessProfileId = readStoredBusinessProfileId();
  const response = await fetchWithTimeout(`${API_BASE_URL}${path}`, {
    ...fetchOptions,
    method,
    headers: {
      ...authHeaders(),
      ...(businessProfileId ? { "X-Business-Profile-ID": String(businessProfileId) } : {}),
      ...(options.headers || {}),
    },
    body: formData,
  }, timeoutMs ?? REQUEST_TIMEOUT_MS);

  const data = await parseJsonResponse(response);

  if (!response.ok) {
    if (response.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("erp:unauthorized"));
    }
    throw new ApiError(readErrorMessage(data), response.status, data, data?.code || data?.error || null);
  }

  if (shouldEmitDataChange(path, method)) {
    clearPagedCache(path, method);
    emitDataChange(path, method);
  }
  return data;
}

async function appendLogoFile(formData, logoAsset) {
  const fileName = logoAsset.fileName || logoAsset.uri?.split("/").pop() || `company-logo-${Date.now()}.jpg`;
  const mimeType = logoAsset.mimeType || logoAsset.type || "image/jpeg";

  if (logoAsset.file) {
    formData.append("logo", logoAsset.file, fileName);
    return;
  }

  if (typeof window !== "undefined" && typeof fetch === "function") {
    const response = await fetch(logoAsset.uri);
    const blob = await response.blob();
    formData.append("logo", blob, fileName);
    return;
  }

  formData.append("logo", {
    uri: logoAsset.uri,
    name: fileName,
    type: mimeType,
  });
}

function readErrorMessage(data) {
  const detail = data?.message || data?.detail;
  if (!detail) {
    return "API request failed";
  }
  if (typeof detail === "string") {
    return detail;
  }
  if (Array.isArray(detail)) {
    return detail
      .map((item) => item?.msg || item?.message || JSON.stringify(item))
      .join("\n");
  }
  return detail?.msg || detail?.message || JSON.stringify(detail);
}

export function buildQuery(params = {}) {
  const query = Object.entries(params)
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");

  return query ? `?${query}` : "";
}

async function requestAll(path, params = {}, options = {}) {
  const key = JSON.stringify([readStoredBusinessProfileId(), path, params]);
  const cached = pagedRequestCache.get(key);
  if (!options.bypassCache && cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }
  const pending = (async () => {
    const requestOptions = options.signal ? { signal: options.signal } : {};
    const firstPage = await request(`${path}${buildQuery({ ...params, skip: 0, limit: PAGE_LIMIT })}`, requestOptions);
    if (!Array.isArray(firstPage)) return firstPage;
    const records = [...firstPage];
    if (firstPage.length < PAGE_LIMIT) {
      return records;
    }

    while (records.length < MAX_RECORDS_PER_COLLECTION) {
      const pageOffsets = Array.from(
        { length: PAGE_PREFETCH_CONCURRENCY },
        (_, index) => records.length + index * PAGE_LIMIT
      ).filter((offset) => offset < MAX_RECORDS_PER_COLLECTION);
      const pages = await Promise.all(
        pageOffsets.map((skip) =>
          request(`${path}${buildQuery({ ...params, skip, limit: PAGE_LIMIT })}`, requestOptions)
        )
      );
      for (const page of pages) {
        if (!Array.isArray(page)) return page;
        records.push(...page);
        if (page.length < PAGE_LIMIT) {
          return records;
        }
      }
    }
    return records;
  })();
  if (!options.bypassCache) {
    pagedRequestCache.set(key, { path, value: pending, expiresAt: Date.now() + PAGED_CACHE_TTL_MS });
  }
  try {
    const value = await pending;
    if (!options.bypassCache) {
      pagedRequestCache.set(key, { path, value, expiresAt: Date.now() + PAGED_CACHE_TTL_MS });
    }
    return value;
  } catch (error) {
    pagedRequestCache.delete(key);
    throw error;
  }
}

export function createRequestKey(prefix = "erp") {
  const randomPart = typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${randomPart}`;
}

export const api = {
  setActiveBusinessProfileId,
  setActiveAccessToken,
  login: async (payload) => {
    const result = await request("/business-profile/login", { method: "POST", body: JSON.stringify(payload) });
    setActiveBusinessProfileId(result?.businessProfile?.id);
    setActiveAccessToken(result?.accessToken);
    return result;
  },
  registerAdmin: (payload) =>
    request("/business-profile/register-admin", { method: "POST", body: JSON.stringify(payload) }),
  uploadBusinessLogo: async (profileId, logoAsset) => {
    const formData = new FormData();
    await appendLogoFile(formData, logoAsset);
    return uploadRequest(`/business-profile/${profileId}/logo`, formData);
  },
  getBusinessProfile: () => request("/business-profile"),
  saveBusinessProfile: (profile) =>
    profile.id
      ? request(`/business-profile/${profile.id}`, { method: "PUT", body: JSON.stringify(profile) })
      : request("/business-profile", { method: "POST", body: JSON.stringify(profile) }),
  getDashboard: (filters) => request(`/dashboard${buildQuery(filters)}`),
  getOutlets: (profileId) => request(`/business-profile/${profileId}/outlets`),
  createOutlet: (profileId, payload) =>
    request(`/business-profile/${profileId}/outlets`, { method: "POST", body: JSON.stringify(payload) }),
  updateOutlet: (profileId, outletId, payload) =>
    request(`/business-profile/${profileId}/outlets/${outletId}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteOutlet: (profileId, outletId) =>
    request(`/business-profile/${profileId}/outlets/${outletId}`, { method: "DELETE" }),
  getPosStaff: (profileId) => request(`/business-profile/${profileId}/pos-staff`),
  createPosStaff: (profileId, payload) =>
    request(`/business-profile/${profileId}/pos-staff`, { method: "POST", body: JSON.stringify(payload) }),
  getCustomers: (profileId, outletId, filters, options) =>
    requestAll(`/business-profile/${profileId}/outlets/${outletId}/customers`, filters, options),
  createCustomer: (profileId, outletId, payload) =>
    request(`/business-profile/${profileId}/outlets/${outletId}/customers`, {
      method: "POST",
      body: JSON.stringify(payload),
    }),
  updateCustomer: (profileId, outletId, customerId, payload) =>
    request(`/business-profile/${profileId}/outlets/${outletId}/customers/${customerId}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    }),
  deleteCustomer: (profileId, outletId, customerId) =>
    request(`/business-profile/${profileId}/outlets/${outletId}/customers/${customerId}`, {
      method: "DELETE",
    }),
  getProducts: (filters, options) => requestAll("/products", filters, options),
  getDamagedInventory: (filters, options) => requestAll("/products/inventory/damaged", filters, options),
  getSupplierReturns: (filters, options) => requestAll("/supplier-returns", filters, options),
  createSupplierReturn: (payload) =>
    request("/supplier-returns", { method: "POST", body: JSON.stringify(payload) }),
  dispatchSupplierReturn: (id, payload) =>
    request(`/supplier-returns/${id}/dispatch`, { method: "POST", body: JSON.stringify(payload) }),
  resendSupplierReturnNotification: (id, phase, channel) =>
    request(`/supplier-returns/${id}/notifications/${phase}/${channel}/resend`, { method: "POST" }),
  downloadSupplierReturnPdf: (id) => blobRequest(`/supplier-returns/${id}/pdf`),
  getCategories: (filters, options) => requestAll("/categories", filters, options),
  createCategory: (payload) => request("/categories", { method: "POST", body: JSON.stringify(payload) }),
  getSuppliers: (filters, options) => requestAll("/suppliers", filters, options),
  getProductInventoryValue: (productId, date) => request(`/products/${productId}/inventory-value${buildQuery({ date })}`),
  getAllProductDiscounts: (filters, options) => requestAll("/products/discounts", filters, options),
  getProductDiscounts: (productId) => request(`/products/${productId}/discounts`),
  createProductDiscount: (productId, payload) => request(`/products/${productId}/discounts`, { method: "POST", body: JSON.stringify(payload) }),
  updateProductDiscount: (productId, discountId, payload) =>
    request(`/products/${productId}/discounts/${discountId}`, { method: "PUT", body: JSON.stringify(payload) }),
  deactivateProductDiscount: (productId, discountId) =>
    request(`/products/${productId}/discounts/${discountId}`, { method: "DELETE" }),
  deleteProductDiscount: (productId, discountId) =>
    request(`/products/${productId}/discounts/${discountId}/hard`, { method: "DELETE" }),
  createSupplier: (payload) => request("/suppliers", { method: "POST", body: JSON.stringify(payload) }),
  updateSupplier: (id, payload) => request(`/suppliers/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  createProduct: (payload, idempotencyKey) => request("/products", {
    method: "POST",
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {},
    body: JSON.stringify(payload),
  }),
  updateProduct: (id, payload) => request(`/products/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteProduct: (id) => request(`/products/${id}`, { method: "DELETE" }),
  getOrders: (filters, options) => requestAll("/orders", filters, options),
  createOrder: (payload, idempotencyKey) => request("/orders", {
    method: "POST",
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {},
    body: JSON.stringify(payload),
  }),
  quoteOrder: (payload) => request("/orders/quote", { method: "POST", body: JSON.stringify(payload) }),
  updateOrder: (id, payload) => request(`/orders/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteOrder: (id) => request(`/orders/${id}`, { method: "DELETE" }),
  getInvoices: (filters, options) => requestAll("/invoices", filters, options),
  getWaybills: (filters, options) => requestAll("/waybills", filters, options),
  updateWaybill: (id, payload) => request(`/waybills/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteWaybill: (id) => request(`/waybills/${id}`, { method: "DELETE" }),
  createInvoice: (payload) => request("/invoices", { method: "POST", body: JSON.stringify(payload) }),
  updateInvoice: (id, payload) => request(`/invoices/${id}`, { method: "PUT", body: JSON.stringify(payload) }),
  deleteInvoice: (id) => request(`/invoices/${id}`, { method: "DELETE" }),
  reverseInvoice: (id, payload) => request(`/invoices/${id}/reverse`, { method: "POST", body: JSON.stringify(payload) }),
  approveReverseInvoice: (id) => request(`/invoices/${id}/approve-reverse`, { method: "POST" }),
  generateInvoice: (payload, requestKey = null) =>
    request("/invoices/generate", {
      method: "POST",
      body: JSON.stringify(payload),
      headers: requestKey ? { "Idempotency-Key": requestKey } : undefined,
    }),
  downloadInvoicePdf: (id) => blobRequest(`/invoices/${id}/pdf`),
  getInvoiceNotifications: (id) => request(`/invoices/${id}/notifications`),
  resendInvoiceNotification: (id, channel) => request(`/invoices/${id}/notifications/${channel}/resend`, { method: "POST" }),
  getInvoicePayments: (id) => request(`/invoices/${id}/payments`),
  getInvoicePaymentSummary: (id) => request(`/invoices/${id}/summary`),
  createInvoicePayment: (id, payload, idempotencyKey) => request(`/invoices/${id}/payments`, {
    method: "POST",
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {},
    body: JSON.stringify(payload),
  }),
  reverseInvoicePayment: (id, idempotencyKey) => request(`/payments/${id}/reverse`, {
    method: "POST",
    headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {},
  }),
  downloadPaymentReceipt: (id) => blobRequest(`/payments/${id}/receipt`),
  getFiles: (options) => requestAll("/files", {}, options),
  uploadFile: (file) => {
    const formData = new FormData();
    formData.append("upload", file, file.name);
    return uploadRequest("/files", formData);
  },
  submitFileProducts: (id, rowOverrides, idempotencyKey) =>
    request(`/files/${id}/submit-products`, {
      method: "POST",
      headers: idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {},
      body: JSON.stringify(rowOverrides ? { rowOverrides } : {}),
    }),
  deleteFile: (id) => request(`/files/${id}`, { method: "DELETE" }),
  productQrUrl: (id) => `${API_BASE_URL}/products/${id}/qr`,
  productBarcodeUrl: (id) => `${API_BASE_URL}/products/${id}/barcode`,
  productScanUrl: (id) => `${API_BASE_URL}/products/${id}/scan`,
};

export const apiClient = {
  request,
  requestAll,
  blobRequest,
  uploadRequest,
  buildQuery,
  setActiveBusinessProfileId,
  setActiveAccessToken,
};

export const BusinessEndpoints = {
  profile: (options) => request("/business-profile", options),
  saveProfile: (profile, options) =>
    profile.id
      ? request(`/business-profile/${profile.id}`, { ...options, method: "PUT", body: JSON.stringify(profile) })
      : request("/business-profile", { ...options, method: "POST", body: JSON.stringify(profile) }),
  outlets: (profileId, options) => request(`/business-profile/${profileId}/outlets`, options),
  createOutlet: (profileId, payload, options) =>
    request(`/business-profile/${profileId}/outlets`, { ...options, method: "POST", body: JSON.stringify(payload) }),
  updateOutlet: (profileId, outletId, payload, options) =>
    request(`/business-profile/${profileId}/outlets/${outletId}`, { ...options, method: "PUT", body: JSON.stringify(payload) }),
  deleteOutlet: (profileId, outletId, options) =>
    request(`/business-profile/${profileId}/outlets/${outletId}`, { ...options, method: "DELETE" }),
  uploadLogo: api.uploadBusinessLogo,
};

export const ProductEndpoints = {
  list: (filters, options) => requestAll("/products", filters, options),
  create: (payload, idempotencyKey, options) =>
    request("/products", {
      ...options,
      method: "POST",
      headers: idempotencyKey ? { ...(options?.headers || {}), "Idempotency-Key": idempotencyKey } : options?.headers,
      body: JSON.stringify(payload),
    }),
  update: (id, payload, options) => request(`/products/${id}`, { ...options, method: "PUT", body: JSON.stringify(payload) }),
  remove: (id, options) => request(`/products/${id}`, { ...options, method: "DELETE" }),
  categories: (filters, options) => requestAll("/categories", filters, options),
  createCategory: (payload, options) => request("/categories", { ...options, method: "POST", body: JSON.stringify(payload) }),
  suppliers: (filters, options) => requestAll("/suppliers", filters, options),
  createSupplier: (payload, options) => request("/suppliers", { ...options, method: "POST", body: JSON.stringify(payload) }),
  updateSupplier: (id, payload, options) => request(`/suppliers/${id}`, { ...options, method: "PUT", body: JSON.stringify(payload) }),
  inventoryValue: (productId, date, options) => request(`/products/${productId}/inventory-value${buildQuery({ date })}`, options),
};

export const DiscountEndpoints = {
  list: (filters, options) => requestAll("/products/discounts", filters, options),
  byProduct: (productId, options) => request(`/products/${productId}/discounts`, options),
  create: (productId, payload, options) => request(`/products/${productId}/discounts`, { ...options, method: "POST", body: JSON.stringify(payload) }),
  update: (productId, discountId, payload, options) =>
    request(`/products/${productId}/discounts/${discountId}`, { ...options, method: "PUT", body: JSON.stringify(payload) }),
  deactivate: (productId, discountId, options) => request(`/products/${productId}/discounts/${discountId}`, { ...options, method: "DELETE" }),
  remove: (productId, discountId, options) => request(`/products/${productId}/discounts/${discountId}/hard`, { ...options, method: "DELETE" }),
};

export const CustomerEndpoints = {
  list: (profileId, outletId, filters, options) =>
    requestAll(`/business-profile/${profileId}/outlets/${outletId}/customers`, filters, options),
  create: (profileId, outletId, payload, options) =>
    request(`/business-profile/${profileId}/outlets/${outletId}/customers`, { ...options, method: "POST", body: JSON.stringify(payload) }),
  update: (profileId, outletId, customerId, payload, options) =>
    request(`/business-profile/${profileId}/outlets/${outletId}/customers/${customerId}`, { ...options, method: "PUT", body: JSON.stringify(payload) }),
  remove: (profileId, outletId, customerId, options) =>
    request(`/business-profile/${profileId}/outlets/${outletId}/customers/${customerId}`, { ...options, method: "DELETE" }),
};

export const InventoryEndpoints = {
  products: (filters, options) => requestAll("/products", filters, options),
  damaged: (filters, options) => requestAll("/products/inventory/damaged", filters, options),
  supplierReturns: (filters, options) => requestAll("/supplier-returns", filters, options),
  createSupplierReturn: (payload, options) => request("/supplier-returns", { ...options, method: "POST", body: JSON.stringify(payload) }),
  dispatchSupplierReturn: (id, payload, options) => request(`/supplier-returns/${id}/dispatch`, { ...options, method: "POST", body: JSON.stringify(payload) }),
  resendSupplierReturnNotification: (id, phase, channel, options) =>
    request(`/supplier-returns/${id}/notifications/${phase}/${channel}/resend`, { ...options, method: "POST" }),
  downloadSupplierReturnPdf: (id, options) => blobRequest(`/supplier-returns/${id}/pdf`, options),
};

export const OrderEndpoints = {
  list: (filters, options) => requestAll("/orders", filters, options),
  create: (payload, idempotencyKey, options) =>
    request("/orders", {
      ...options,
      method: "POST",
      headers: idempotencyKey ? { ...(options?.headers || {}), "Idempotency-Key": idempotencyKey } : options?.headers,
      body: JSON.stringify(payload),
    }),
  quote: (payload, options) => request("/orders/quote", { ...options, method: "POST", body: JSON.stringify(payload) }),
  update: (id, payload, options) => request(`/orders/${id}`, { ...options, method: "PUT", body: JSON.stringify(payload) }),
  remove: (id, options) => request(`/orders/${id}`, { ...options, method: "DELETE" }),
};

export const InvoiceEndpoints = {
  list: (filters, options) => requestAll("/invoices", filters, options),
  create: (payload, options) => request("/invoices", { ...options, method: "POST", body: JSON.stringify(payload) }),
  update: (id, payload, options) => request(`/invoices/${id}`, { ...options, method: "PUT", body: JSON.stringify(payload) }),
  remove: (id, options) => request(`/invoices/${id}`, { ...options, method: "DELETE" }),
  generate: (payload, requestKey = null, options) =>
    request("/invoices/generate", {
      ...options,
      method: "POST",
      body: JSON.stringify(payload),
      headers: requestKey ? { ...(options?.headers || {}), "Idempotency-Key": requestKey } : options?.headers,
    }),
  reverse: (id, payload, options) => request(`/invoices/${id}/reverse`, { ...options, method: "POST", body: JSON.stringify(payload) }),
  approveReverse: (id, options) => request(`/invoices/${id}/approve-reverse`, { ...options, method: "POST" }),
  downloadPdf: (id, options) => blobRequest(`/invoices/${id}/pdf`, options),
  notifications: (id, options) => request(`/invoices/${id}/notifications`, options),
  resendNotification: (id, channel, options) => request(`/invoices/${id}/notifications/${channel}/resend`, { ...options, method: "POST" }),
  payments: (id, options) => request(`/invoices/${id}/payments`, options),
  paymentSummary: (id, options) => request(`/invoices/${id}/summary`, options),
  createPayment: (id, payload, idempotencyKey, options) =>
    request(`/invoices/${id}/payments`, {
      ...options,
      method: "POST",
      headers: idempotencyKey ? { ...(options?.headers || {}), "Idempotency-Key": idempotencyKey } : options?.headers,
      body: JSON.stringify(payload),
    }),
  reversePayment: (id, idempotencyKey, options) =>
    request(`/payments/${id}/reverse`, {
      ...options,
      method: "POST",
      headers: idempotencyKey ? { ...(options?.headers || {}), "Idempotency-Key": idempotencyKey } : options?.headers,
    }),
  downloadPaymentReceipt: (id, options) => blobRequest(`/payments/${id}/receipt`, options),
};

export const WaybillEndpoints = {
  list: (filters, options) => requestAll("/waybills", filters, options),
  update: (id, payload, options) => request(`/waybills/${id}`, { ...options, method: "PUT", body: JSON.stringify(payload) }),
  remove: (id, options) => request(`/waybills/${id}`, { ...options, method: "DELETE" }),
};

export const FileEndpoints = {
  list: (options) => requestAll("/files", {}, options),
  upload: (file, options) => {
    const formData = new FormData();
    formData.append("upload", file, file.name);
    return uploadRequest("/files", formData, options);
  },
  submitProducts: (id, rowOverrides, idempotencyKey, options) =>
    request(`/files/${id}/submit-products`, {
      ...options,
      method: "POST",
      headers: idempotencyKey ? { ...(options?.headers || {}), "Idempotency-Key": idempotencyKey } : options?.headers,
      body: JSON.stringify(rowOverrides ? { rowOverrides } : {}),
    }),
  remove: (id, options) => request(`/files/${id}`, { ...options, method: "DELETE" }),
};

export const DashboardEndpoints = {
  summary: (filters, options) => request(`/dashboard${buildQuery(filters)}`, options),
  inventoryValueTimeline: (filters, options) =>
    request(`/dashboard/inventory-value-timeline${buildQuery(filters)}`, options),
  inventoryValueReport: (filters, options) =>
    request(`/dashboard/inventory-value-report${buildQuery(filters)}`, options),
};

export const ErpEndpoints = {
  business: BusinessEndpoints,
  products: ProductEndpoints,
  discounts: DiscountEndpoints,
  customers: CustomerEndpoints,
  inventory: InventoryEndpoints,
  orders: OrderEndpoints,
  invoices: InvoiceEndpoints,
  waybills: WaybillEndpoints,
  files: FileEndpoints,
  dashboard: DashboardEndpoints,
};
