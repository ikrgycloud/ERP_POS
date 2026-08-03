const EMPTY_OBJECT = Object.freeze({});

export function stableQueryPart(value) {
  if (value === undefined || value === null || value === "") {
    return EMPTY_OBJECT;
  }
  if (Array.isArray(value)) {
    return value.map(stableQueryPart);
  }
  if (typeof value !== "object") {
    return value;
  }
  return Object.keys(value)
    .sort()
    .reduce((acc, key) => {
      const item = value[key];
      if (item !== undefined && item !== "") {
        acc[key] = stableQueryPart(item);
      }
      return acc;
    }, {});
}

export function erpScope({
  businessId,
  businessProfileId,
  outletId,
  role,
  terminalId,
  permissions,
} = {}) {
  return stableQueryPart({
    businessId: businessId ?? businessProfileId,
    outletId,
    role,
    terminalId,
    permissions,
  });
}

export function erpPage({
  page,
  pageSize,
  skip,
  limit,
  cursor,
  sort,
  direction,
} = {}) {
  return stableQueryPart({ page, pageSize, skip, limit, cursor, sort, direction });
}

export function erpFilters(filters = EMPTY_OBJECT) {
  return stableQueryPart(filters);
}

function makeDomainKeys(domain) {
  const root = ["erp", domain];
  return {
    root,
    all: () => root,
    scoped: (scope = EMPTY_OBJECT) => [...root, "scope", stableQueryPart(scope)],
    list: (scope = EMPTY_OBJECT, filters = EMPTY_OBJECT, pagination = EMPTY_OBJECT) => [
      ...root,
      "list",
      stableQueryPart(scope),
      erpFilters(filters),
      erpPage(pagination),
    ],
    infinite: (scope = EMPTY_OBJECT, filters = EMPTY_OBJECT, pagination = EMPTY_OBJECT) => [
      ...root,
      "infinite",
      stableQueryPart(scope),
      erpFilters(filters),
      erpPage(pagination),
    ],
    detail: (scope = EMPTY_OBJECT, id) => [...root, "detail", stableQueryPart(scope), id],
    auxiliary: (name, scope = EMPTY_OBJECT, params = EMPTY_OBJECT, pagination = EMPTY_OBJECT) => [
      ...root,
      name,
      stableQueryPart(scope),
      erpFilters(params),
      erpPage(pagination),
    ],
  };
}

export const erpQueryKeys = {
  business: makeDomainKeys("business"),
  outlets: makeDomainKeys("outlets"),
  products: makeDomainKeys("products"),
  customers: makeDomainKeys("customers"),
  suppliers: makeDomainKeys("suppliers"),
  categories: makeDomainKeys("categories"),
  inventory: makeDomainKeys("inventory"),
  orders: makeDomainKeys("orders"),
  invoices: makeDomainKeys("invoices"),
  returns: makeDomainKeys("returns"),
  dashboard: makeDomainKeys("dashboard"),
  reports: makeDomainKeys("reports"),
  waybills: makeDomainKeys("waybills"),
  discounts: makeDomainKeys("discounts"),
  payments: makeDomainKeys("payments"),
  employees: makeDomainKeys("employees"),
  settings: makeDomainKeys("settings"),
  files: makeDomainKeys("files"),
};
