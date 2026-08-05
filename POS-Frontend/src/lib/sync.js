export const SYNC_DOMAINS = {
  PRODUCTS: 'products',
  INVENTORY: 'inventory',
  INVOICES: 'invoices',
  RETURNS: 'returns',
  PAYMENTS: 'payments',
  CUSTOMERS: 'customers',
  SUPPLIERS: 'suppliers',
  STAFF: 'staff',
  DASHBOARD: 'dashboard',
  REPORTS: 'reports',
  SETTINGS: 'settings',
};

const ROUTES = [
  ['/products', ['products', 'inventory', 'dashboard', 'reports']],
  ['/inventory', ['inventory', 'products', 'dashboard', 'reports']],
  ['/pos/cart', ['inventory', 'invoices', 'payments', 'customers', 'dashboard', 'reports']],
  ['/invoices', ['invoices', 'payments', 'dashboard', 'reports']],
  ['/returns', ['returns', 'invoices', 'inventory', 'payments', 'customers', 'dashboard', 'reports']],
  ['/customers', ['customers', 'dashboard', 'reports']],
  ['/suppliers', ['suppliers', 'products', 'reports']],
  ['/staff', ['staff', 'dashboard', 'reports']],
  ['/business-profile', ['settings', 'dashboard', 'reports']],
];

export function invalidationFor(path, method = 'GET') {
  const cleanPath = String(path || '').split('?')[0];
  const domains = new Set();
  ROUTES.forEach(([prefix, affected]) => {
    if (cleanPath.startsWith(prefix)) affected.forEach((domain) => domains.add(domain));
  });
  if (!domains.size) {
    domains.add('dashboard');
    domains.add('reports');
  }
  return {
    domains: [...domains].sort(),
    path,
    method: String(method).toUpperCase(),
  };
}

export function emitDataChange(path, method = 'GET') {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent('pos:data-changed', {
      detail: invalidationFor(path, method),
    }),
  );
}

export function useDataInvalidation(reload, domains = []) {
  return (event) => {
    if (!domains.length) {
      reload?.().catch(() => {});
      return;
    }
    const changed = event?.detail?.domains || [];
    if (changed.some((domain) => domains.includes(domain))) {
      reload?.().catch(() => {});
    }
  };
}
