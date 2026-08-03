export const SYNC_DOMAINS = {
  PRODUCTS: "products",
  INVENTORY: "inventory",
  INVOICES: "invoices",
  RETURNS: "returns",
  PAYMENTS: "payments",
  CUSTOMERS: "customers",
  SUPPLIERS: "suppliers",
  STAFF: "staff",
  DASHBOARD: "dashboard",
  REPORTS: "reports",
  SETTINGS: "settings",
};

const ROUTES = [
  ["/products", ["products", "inventory", "dashboard", "reports"]],
  ["/orders", ["inventory", "invoices", "dashboard", "reports"]],
  ["/invoices", ["invoices", "inventory", "payments", "dashboard", "reports"]],
  ["/customers", ["customers", "dashboard", "reports"]],
  ["/suppliers", ["suppliers", "products", "reports"]],
  ["/supplier-returns", ["returns", "inventory", "suppliers", "dashboard", "reports"]],
  ["/business-profile", ["settings", "customers", "dashboard", "reports"]],
  ["/waybills", ["invoices", "reports"]],
  ["/files", ["products", "inventory", "reports"]],
];

export function invalidationFor(path, method = "GET") {
  const cleanPath = String(path || "").split("?")[0];
  const domains = new Set();
  ROUTES.forEach(([prefix, affected]) => {
    if (cleanPath.startsWith(prefix)) affected.forEach((domain) => domains.add(domain));
  });
  if (!domains.size) {
    domains.add("dashboard");
    domains.add("reports");
  }
  return { domains: [...domains].sort(), path, method: String(method).toUpperCase() };
}

export function emitDataChange(path, method = "GET") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("erp:data-changed", { detail: invalidationFor(path, method) }));
}
