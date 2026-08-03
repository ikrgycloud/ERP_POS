function safeNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function latestQuantityRecord(product) {
  const history = product?.quantityHistory || product?.quantity_history || [];
  if (!Array.isArray(history) || history.length === 0) {
    return null;
  }
  return [...history].sort((left, right) => {
    const rightDate = new Date(right.createdAt || right.created_at || 0).getTime() || 0;
    const leftDate = new Date(left.createdAt || left.created_at || 0).getTime() || 0;
    return rightDate - leftDate || safeNumber(right.id) - safeNumber(left.id);
  })[0];
}

export function getProductMetrics(product) {
  const serverRemaining = safeNumber(product.remaining);
  const serverRevenue = safeNumber(product.revenue);
  const serverProfit = safeNumber(product.profit);
  const serverInventoryValue = safeNumber(product.inventoryValue);
  const hasServerMetrics =
    product.remaining !== undefined ||
    product.revenue !== undefined ||
    product.profit !== undefined ||
    product.inventoryValue !== undefined;

  if (hasServerMetrics) {
    const margin = serverRevenue === 0 ? 0 : (serverProfit / serverRevenue) * 100;
    return {
      cost: Math.max(0, serverRevenue - serverProfit),
      inventoryValue: serverInventoryValue,
      margin,
      profit: serverProfit,
      remaining: serverRemaining,
      revenue: serverRevenue,
    };
  }

  const qtyBought = safeNumber(product.qtyBought);
  const qtySold = safeNumber(product.qtySold);
  const buyPrice = safeNumber(product.buyPrice);
  const sellPrice = safeNumber(product.sellPrice);
  const remaining = Math.max(0, qtyBought - qtySold);
  const revenue = qtySold * sellPrice;
  const cost = qtySold * buyPrice;
  const profit = revenue - cost;
  const margin = revenue === 0 ? 0 : (profit / revenue) * 100;
  const inventoryValue = remaining * buyPrice;

  return {
    cost,
    inventoryValue,
    margin,
    profit,
    remaining,
    revenue,
  };
}

export function getOrderTotals(order) {
  const items = Array.isArray(order.items) ? order.items : [];
  const taxableValue = items.reduce(
    (total, item) => total + safeNumber(item.quantity) * safeNumber(item.rate),
    0
  );
  const taxValue = items.reduce(
    (total, item) => total + (safeNumber(item.quantity) * safeNumber(item.rate) * safeNumber(item.gstRate)) / 100,
    0
  );

  return {
    grandTotal: taxableValue + taxValue,
    taxableValue,
    taxValue,
  };
}

export function getInvoiceTotal(invoice) {
  return safeNumber(invoice.taxableValue) + safeNumber(invoice.cgst) + safeNumber(invoice.sgst) + safeNumber(invoice.igst);
}

export function buildDashboardSummary({ products, orders, invoices }) {
  const productMetrics = products.map(getProductMetrics);
  const totalRevenue = productMetrics.reduce((total, item) => total + item.revenue, 0);
  const totalProfit = productMetrics.reduce((total, item) => total + item.profit, 0);
  const inventoryValue = productMetrics.reduce(
    (total, item) => total + item.inventoryValue,
    0
  );
  const lowStockCount = products.filter(
    (product) => getProductMetrics(product).remaining <= safeNumber(product.reorderLevel)
  ).length;
  const purchaseOrders = orders.filter((order) => order.type === "purchase").length;
  const salesOrders = orders.filter((order) => order.type === "sale").length;
  const receivables = invoices
    .filter((invoice) => invoice.invoiceType === "Sale" && invoice.status !== "Paid")
    .reduce((total, invoice) => total + getInvoiceTotal(invoice), 0);
  const payables = invoices
    .filter((invoice) => invoice.invoiceType === "Purchase" && invoice.status !== "Paid")
    .reduce((total, invoice) => total + getInvoiceTotal(invoice), 0);

  return {
    inventoryValue,
    lowStockCount,
    payables,
    purchaseOrders,
    receivables,
    salesOrders,
    totalProfit,
    totalRevenue,
  };
}
