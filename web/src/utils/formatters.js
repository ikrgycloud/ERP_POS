function withCurrencySymbol(value) {
  return `₹ ${value}`;
}

export function formatCurrency(value) {
  const safeValue = Number.isFinite(Number(value)) ? Number(value) : 0;
  const formatted = new Intl.NumberFormat("en-IN", {
    currency: "INR",
    maximumFractionDigits: 0,
    style: "currency",
  }).format(safeValue);
  return withCurrencySymbol(formatted.replace(/^₹\s*/u, ""));
}

export function formatNumber(value) {
  const safeValue = Number.isFinite(Number(value)) ? Number(value) : 0;
  return new Intl.NumberFormat("en-IN").format(safeValue);
}

export function formatPercent(value) {
  return `${Number(value || 0).toFixed(1)}%`;
}

export function formatDate(value) {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}
