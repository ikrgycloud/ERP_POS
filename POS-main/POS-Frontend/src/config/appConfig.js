export const APP_NAME = import.meta.env.VITE_APP_NAME || 'Point of Sale';

export const CURRENCY = {
  code: import.meta.env.VITE_CURRENCY_CODE || 'INR',
  locale: import.meta.env.VITE_LOCALE || 'en-IN',
  symbol: import.meta.env.VITE_CURRENCY_SYMBOL || '₹',
};

export const DATE_FORMAT = {
  locale: import.meta.env.VITE_LOCALE || 'en-IN',
  date: {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  },
  time: {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  },
};

export const DEFAULT_LANGUAGE = import.meta.env.VITE_DEFAULT_LANGUAGE || 'en';

function isLoopbackHost(host) {
  return ['localhost', '127.0.0.1', '0.0.0.0'].includes(host);
}

function isLanHost(host) {
  return /^(10|172\.(1[6-9]|2\d|3[0-1])|192\.168)\./.test(host);
}

function resolveApiBaseUrl() {
  if (typeof window !== 'undefined') {
    const urlApi = new URLSearchParams(window.location.search).get('api');
    if (urlApi) {
      return urlApi.replace(/\/api\/v1\/?$/, '').replace(/\/$/, '');
    }
  }
  if (import.meta.env.DEV && (import.meta.env.VITE_DEV_PROXY_TARGET || '').trim()) {
    return '';
  }
  const configured = (import.meta.env.VITE_API_URL || '').trim();
  if (configured && !['auto', 'same-origin'].includes(configured.toLowerCase())) {
    const normalized = configured.replace(/\/$/, '');
    if (typeof window !== 'undefined') {
      try {
        const configuredUrl = new URL(normalized);
        const pageHost = window.location.hostname;
        if (isLoopbackHost(configuredUrl.hostname) && !isLoopbackHost(pageHost) && isLanHost(pageHost)) {
          configuredUrl.hostname = pageHost;
          return configuredUrl.toString().replace(/\/$/, '');
        }
      } catch {
        return normalized;
      }
    }
    return normalized;
  }
  if (typeof window === 'undefined') return '';
  if (configured.toLowerCase() === 'same-origin') return '';

  const host = window.location.hostname;
  if (!isLoopbackHost(host) && !isLanHost(host)) {
    return '';
  }

  const port = import.meta.env.VITE_API_PORT || '8000';
  return `http://${host}:${port}`;
}

export const API_CONFIG = {
  baseUrl: resolveApiBaseUrl(),
  versionPath: import.meta.env.VITE_API_VERSION_PATH || '/api/v1',
  requestTimeoutMs: Number(import.meta.env.VITE_REQUEST_TIMEOUT_MS || 15000),
};

export function apiBaseWithVersion() {
  return `${API_CONFIG.baseUrl}${API_CONFIG.versionPath}`;
}

export function mediaUrl(path) {
  if (!path) return '';
  if (/^https?:\/\//i.test(path)) return path;
  const normalized = path.startsWith('/') ? path : `/${path}`;
  return `${API_CONFIG.baseUrl}${normalized}`;
}

export function qrApiBaseWithVersion() {
  try {
    const host = new URL(API_CONFIG.baseUrl).hostname;
    if (['localhost', '127.0.0.1', '0.0.0.0'].includes(host)) {
      return null;
    }
  } catch {
    return null;
  }
  return apiBaseWithVersion();
}

export const STORE = {
  name: import.meta.env.VITE_STORE_NAME || APP_NAME,
  branch: import.meta.env.VITE_STORE_BRANCH || '',
  register: import.meta.env.VITE_REGISTER_NAME || '',
  address: import.meta.env.VITE_STORE_ADDRESS || '',
  city: import.meta.env.VITE_STORE_CITY || '',
  gstin: import.meta.env.VITE_STORE_GSTIN || '',
  receiptFooter:
    import.meta.env.VITE_RECEIPT_FOOTER ||
    'Please retain this invoice for returns, exchanges, and warranty claims.',
};

export function compactLabel(parts, separator = ' · ') {
  return parts.filter(Boolean).join(separator);
}

export const APP_CONFIG = {
  name: APP_NAME,
  version: import.meta.env.VITE_APP_VERSION || '0.0.0',
  company: import.meta.env.VITE_COMPANY_NAME || '',
  supportEmail: import.meta.env.VITE_SUPPORT_EMAIL || '',
};
