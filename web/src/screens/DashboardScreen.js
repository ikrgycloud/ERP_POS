import React, { useMemo, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { FilterChips } from "../components/FilterChips";
import { ScreenHeader } from "../components/ScreenHeader";
import { colors, radii, spacing } from "../constants/theme";
import { formatCurrency, formatNumber } from "../utils/formatters";
import { getInvoiceTotal, getProductMetrics } from "../utils/erpCalculations";

function safeNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function matchesOutletScope(item, sessionRole, currentOutlet) {
  if (sessionRole !== "outlet") {
    return true;
  }
  return currentOutlet?.id ? Number(item?.outletId) === Number(currentOutlet.id) : true;
}

function valueOf(record, camelKey, snakeKey = camelKey) {
  return record?.[camelKey] ?? record?.[snakeKey];
}

function orderGrandTotal(order) {
  const storedTotal = safeNumber(valueOf(order, "grandTotal", "grand_total"));
  if (storedTotal > 0) {
    return storedTotal;
  }
  return (order.items || []).reduce((total, item) => {
    const subtotal = safeNumber(valueOf(item, "lineSubtotal", "line_subtotal")) || safeNumber(item.quantity) * safeNumber(item.rate);
    const discount = safeNumber(valueOf(item, "discountAmount", "discount_amount"));
    const taxable = safeNumber(valueOf(item, "lineTotal", "line_total")) || Math.max(0, subtotal - discount);
    return total + taxable + (taxable * safeNumber(valueOf(item, "gstRate", "gst_rate"))) / 100;
  }, 0);
}

function formatWholeNumber(value) {
  return formatNumber(Math.round(safeNumber(value)));
}

function getItemDate(item) {
  const value = item?.date || item?.createdAt || item?.updatedAt;
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date : null;
}

function getRangeStart(range) {
  if (range === "All Time") {
    return null;
  }
  const now = new Date();
  if (range === "Today") {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate());
  }
  if (range === "Last 7 Days") {
    return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  }
  if (range === "Last 1 Month") {
    const start = new Date(now);
    start.setMonth(start.getMonth() - 1);
    return start;
  }
  if (range === "Last 3 Months") {
    const start = new Date(now);
    start.setMonth(start.getMonth() - 3);
    return start;
  }
  if (range === "Last 6 Months") {
    const start = new Date(now);
    start.setMonth(start.getMonth() - 6);
    return start;
  }
  if (range === "Last 1 Year") {
    const start = new Date(now);
    start.setFullYear(start.getFullYear() - 1);
    return start;
  }
  return null;
}

function isInsideRange(item, range) {
  const rangeStart = getRangeStart(range);
  if (!rangeStart) {
    return true;
  }
  const itemDate = getItemDate(item);
  return !!itemDate && itemDate >= rangeStart;
}

function normalizeText(value) {
  return String(value || "").trim().toLowerCase();
}

function isActiveRecordStatus(status) {
  return !["deleted", "cancelled"].includes(normalizeText(status));
}

function isCompletedOrderStatus(status) {
  return ["delivered", "received", "closed"].includes(normalizeText(status));
}

function getInvoiceBalance(invoice) {
  const total = getInvoiceTotal(invoice);
  const remainingAmount = safeNumber(invoice.remainingAmount);
  if (normalizeText(invoice.paymentStatus || invoice.status) === "paid") {
    return 0;
  }
  if (remainingAmount > 0) {
    return remainingAmount;
  }
  return Math.max(0, total - safeNumber(invoice.paidAmount));
}

function isInvoicePaid(invoice) {
  return normalizeText(invoice.paymentStatus || invoice.status) === "paid" || getInvoiceBalance(invoice) <= 0;
}

export function DashboardScreen({
  businessProfile,
  currentOutlet,
  dashboardSummary,
  dashboardRange,
  dashboardRangeOptions = [],
  dashboardScopeLabel,
  damagedInventory = [],
  invoices,
  inventoryValueTimeline = [],
  onOpenInventory,
  onOpenScreen,
  onDashboardRangeChange,
  orders,
  products,
  sessionRole,
}) {
  const productLookup = useMemo(
    () => Object.fromEntries(products.map((product) => [String(product.id), product])),
    [products]
  );
  const orderLookup = useMemo(
    () => Object.fromEntries(orders.map((order) => [String(order.id), order])),
    [orders]
  );
  const scopedInvoices = useMemo(
    () => invoices.filter((invoice) => matchesOutletScope(invoice, sessionRole, currentOutlet)),
    [currentOutlet?.id, invoices, sessionRole]
  );
  const scopedOrders = useMemo(
    () => orders.filter((order) => matchesOutletScope(order, sessionRole, currentOutlet)),
    [currentOutlet?.id, orders, sessionRole]
  );
  const periodInvoices = useMemo(
    () => scopedInvoices.filter((invoice) => isInsideRange(invoice, dashboardRange)),
    [dashboardRange, scopedInvoices]
  );
  const periodOrders = useMemo(
    () => scopedOrders.filter((order) => isInsideRange(order, dashboardRange)),
    [dashboardRange, scopedOrders]
  );
  const periodSaleInvoices = useMemo(
    () => periodInvoices.filter((invoice) => normalizeText(invoice.invoiceType) === "sale" && !invoice.isReverse && isActiveRecordStatus(invoice.status)),
    [periodInvoices]
  );
  const periodPurchaseInvoices = useMemo(
    () => periodInvoices.filter((invoice) => normalizeText(invoice.invoiceType) === "purchase" && !invoice.isReverse && isActiveRecordStatus(invoice.status)),
    [periodInvoices]
  );
  const periodPendingSaleInvoices = useMemo(
    () => periodSaleInvoices.filter((invoice) => {
      const order = orderLookup[String(invoice.orderId)];
      return !isInvoicePaid(invoice) && (!order || isActiveRecordStatus(order.status));
    }),
    [orderLookup, periodSaleInvoices]
  );
  const periodReceivables = useMemo(
    () => periodPendingSaleInvoices.reduce((total, invoice) => total + getInvoiceBalance(invoice), 0),
    [periodPendingSaleInvoices]
  );
  const periodPayables = useMemo(
    () => periodPurchaseInvoices
      .filter((invoice) => {
        const order = orderLookup[String(invoice.orderId)];
        return !isInvoicePaid(invoice) && (!order || isActiveRecordStatus(order.status));
      })
      .reduce((total, invoice) => total + getInvoiceBalance(invoice), 0),
    [orderLookup, periodPurchaseInvoices]
  );
  const periodPurchaseSpend = useMemo(
    () =>
      periodPurchaseInvoices.reduce((total, invoice) => {
        const invoiceTotal = getInvoiceTotal(invoice);
        const paidAmount = isInvoicePaid(invoice) ? invoiceTotal : safeNumber(invoice.paidAmount);
        return total + Math.min(invoiceTotal, paidAmount);
      }, 0),
    [periodPurchaseInvoices]
  );
  const dashboardMetrics = useMemo(() => {
    const activeOrders = periodOrders.filter((order) => isActiveRecordStatus(order.status));
    const saleOrders = activeOrders.filter((order) => normalizeText(order.type) === "sale");
    const purchaseOrders = activeOrders.filter((order) => normalizeText(order.type) === "purchase");
    const totalProfit = saleOrders.reduce(
      (orderTotal, order) =>
        orderTotal +
        (order.items || []).reduce((itemTotal, item) => {
          const product = productLookup[String(item.productId)];
          return itemTotal + safeNumber(item.quantity) * (safeNumber(item.rate) - safeNumber(product?.buyPrice));
        }, 0),
      0
    );
    const productMetrics = products.map(getProductMetrics);
    const inventoryValue = productMetrics.reduce((total, item) => total + safeNumber(item.inventoryValue), 0);
    const lowStockCount = products.filter((product) => {
      const metrics = getProductMetrics(product);
      return metrics.remaining <= safeNumber(product.reorderLevel);
    }).length;
    const totalRevenue = saleOrders.reduce((total, order) => total + orderGrandTotal(order), 0);

    return {
      inventoryValue,
      lowStockCount,
      payables: periodPayables,
      purchaseSpend: periodPurchaseSpend,
      purchaseOrders: purchaseOrders.length,
      receivables: periodReceivables,
      salesOrders: saleOrders.length,
      totalProfit,
      totalRevenue,
    };
  }, [periodOrders, periodPayables, periodPurchaseSpend, periodReceivables, productLookup, products]);
  const lowStockProducts = products.filter((product) => {
    const metrics = getProductMetrics(product);
    const matchesStock = metrics.remaining <= safeNumber(product.reorderLevel);
    return matchesStock;
  });
  const damagedMetrics = useMemo(() => {
    const visibleRows = damagedInventory.filter((item) => {
      if (sessionRole === "outlet" && currentOutlet?.id) {
        return Number(item.outletId) === Number(currentOutlet.id);
      }
      return true;
    });
    const availableQuantity = visibleRows.reduce(
      (total, item) => total + safeNumber(item.availableQuantity ?? item.quantity),
      0
    );
    const totalQuantity = visibleRows.reduce((total, item) => total + safeNumber(item.quantity), 0);
    const returnedQuantity = visibleRows.reduce(
      (total, item) => total + safeNumber(item.returnedToSupplierQuantity),
      0
    );
    return {
      availableQuantity,
      rows: visibleRows,
      returnedQuantity,
      totalQuantity,
    };
  }, [currentOutlet?.id, damagedInventory, sessionRole]);
  const damagedQueue = damagedMetrics.rows
    .sort((left, right) => {
      const rightDate = getItemDate(right)?.getTime() || 0;
      const leftDate = getItemDate(left)?.getTime() || 0;
      return rightDate - leftDate || safeNumber(right.id) - safeNumber(left.id);
    })
    .slice(0, 5);
  const recentInvoices = [...periodInvoices]
    .filter((invoice) => isActiveRecordStatus(invoice.status))
    .sort((left, right) => {
      const rightDate = getItemDate(right)?.getTime() || 0;
      const leftDate = getItemDate(left)?.getTime() || 0;
      return rightDate - leftDate || safeNumber(right.id) - safeNumber(left.id);
    })
    .slice(0, 3);
  const pendingOrders = periodOrders.filter((order) => {
    const matchesPending = isActiveRecordStatus(order.status) && !isCompletedOrderStatus(order.status);
    return matchesPending;
  });
  const pendingOrderCount = periodOrders.filter(
    (order) => isActiveRecordStatus(order.status) && !isCompletedOrderStatus(order.status)
  ).length;
  const financialSnapshot = useMemo(() => {
    const paidTotal = periodSaleInvoices.reduce((total, invoice) => total + safeNumber(invoice.paidAmount), 0);
    const periodRevenue = dashboardMetrics.totalRevenue;
    const collectionRate = periodRevenue ? Math.min(100, (paidTotal / periodRevenue) * 100) : 0;
    const totalRevenueForProfit = periodRevenue;
    const profitRate = totalRevenueForProfit ? Math.max(0, (dashboardMetrics.totalProfit / totalRevenueForProfit) * 100) : 0;

    return {
      collectionRate,
      paidTotal,
      pendingCollectionCount: periodPendingSaleInvoices.length,
      profitRate,
    };
  }, [dashboardMetrics.totalProfit, dashboardMetrics.totalRevenue, periodPendingSaleInvoices.length, periodSaleInvoices]);
  const operationsHealth = useMemo(() => {
    const lowStockTotal = dashboardMetrics.lowStockCount;
    const productCount = products.length || 0;
    const lowStockRate = productCount ? Math.min(100, (lowStockTotal / productCount) * 100) : 0;
    const damagedReturnRate = damagedMetrics.totalQuantity
      ? Math.min(100, (damagedMetrics.returnedQuantity / damagedMetrics.totalQuantity) * 100)
      : 0;
    const activeOrderCount = periodOrders.filter((order) => isActiveRecordStatus(order.status)).length;
    const pendingOrderRate = activeOrderCount ? Math.min(100, (pendingOrderCount / activeOrderCount) * 100) : 0;
    const totalPaymentExposure = dashboardMetrics.receivables + dashboardMetrics.payables;
    const payableExposureRate = totalPaymentExposure ? Math.min(100, (dashboardMetrics.payables / totalPaymentExposure) * 100) : 0;

    return {
      damagedReturnRate,
      lowStockRate,
      payableExposureRate,
      pendingOrderRate,
    };
  }, [dashboardMetrics.lowStockCount, dashboardMetrics.payables, dashboardMetrics.receivables, damagedMetrics.returnedQuantity, damagedMetrics.totalQuantity, pendingOrderCount, periodOrders, products.length]);

  const filteredActivity = useMemo(() => periodOrders.filter((order) => isActiveRecordStatus(order.status)), [periodOrders]);
  const openInventory = (navigation) => {
    if (onOpenInventory) {
      onOpenInventory(navigation);
    }
  };
  const openScreen = (screen) => {
    if (onOpenScreen) {
      onOpenScreen(screen);
    }
  };

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <ScreenHeader
        eyebrow={businessProfile?.tradeName}
        iconLabel="D"
        iconTone="success"
        title="Main Dashboard"
        subtitle="Overview for sales, purchases, GST invoices, inventory, and profit."
      />

      <View style={styles.executivePanel}>
        <View style={styles.executiveHeader}>
          <View style={styles.executiveTitleWrap}>
            <Text style={styles.contextLabel}>Workspace</Text>
            <Text style={styles.contextValue}>{sessionRole === "outlet" ? currentOutlet?.tradeName || currentOutlet?.name || "Outlet" : "Admin overview"}</Text>
            <Text style={styles.executiveCaption}>{dashboardScopeLabel || "Live business overview"}</Text>
          </View>
          <View style={styles.rangeChips}>
            <FilterChips
              activeValue={dashboardRange}
              onChange={onDashboardRangeChange}
              options={dashboardRangeOptions}
            />
          </View>
        </View>
        <View style={styles.executiveMetrics}>
          <ExecutiveMetric label="Sales revenue" value={formatCurrency(dashboardMetrics.totalRevenue)} caption={dashboardRange} tone="success" actionLabel="View sales activity" onPress={() => openScreen("recentSales")} />
          <ExecutiveMetric label="Gross profit" value={formatCurrency(dashboardMetrics.totalProfit)} caption={`${formatNumber(financialSnapshot.profitRate)}% ${dashboardRange} profit rate`} tone="primary" actionLabel="View profit reports" onPress={() => openScreen("reports")} />
          <ExecutiveMetric label="Pending collections" value={formatCurrency(dashboardMetrics.receivables)} caption={`${formatNumber(financialSnapshot.pendingCollectionCount)} pending · ${formatNumber(financialSnapshot.collectionRate)}% collected`} tone="warning" actionLabel="View pending invoices" onPress={() => openScreen("invoices")} />
          <InventoryValueMetric
            onPress={() => openInventory({ view: "all" })}
            productCount={products.length}
            range={dashboardRange}
            timeline={inventoryValueTimeline}
            value={dashboardSummary?.inventoryValue ?? dashboardMetrics.inventoryValue}
          />
        </View>
      </View>

      <View style={styles.healthGrid}>
        <HealthCard label="Low stock" value={formatNumber(dashboardMetrics.lowStockCount)} caption={`${formatNumber(products.length)} products tracked`} actionLabel="View low stock products" tone="danger" progress={operationsHealth.lowStockRate} onPress={() => openInventory({ view: "lowStock" })} />
        <HealthCard label="Damaged products" value={formatWholeNumber(damagedMetrics.totalQuantity)} caption={`${formatWholeNumber(damagedMetrics.availableQuantity)} available · ${formatWholeNumber(damagedMetrics.returnedQuantity)} sent`} actionLabel="View damaged products" tone="danger" progress={operationsHealth.damagedReturnRate} onPress={() => openInventory({ view: "damaged" })} />
        <HealthCard label="Stock purchase spend" value={formatCurrency(dashboardMetrics.purchaseSpend)} caption={`${formatCurrency(dashboardMetrics.payables)} still payable`} actionLabel="View purchase invoices" tone="warning" progress={operationsHealth.payableExposureRate} onPress={() => openScreen("invoices")} />
        <HealthCard label="Pending orders" value={formatNumber(pendingOrderCount)} caption={`${formatNumber(dashboardMetrics.purchaseOrders)} purchases · ${formatNumber(dashboardMetrics.salesOrders)} sales`} actionLabel="View pending orders" tone="primary" progress={operationsHealth.pendingOrderRate} onPress={() => openScreen("orders")} />
      </View>

      <View style={styles.dashboardGrid}>
        <View style={styles.dashboardColumn}>
          <DashboardPanel
            title="Collection performance"
            caption={`${formatCurrency(financialSnapshot.paidTotal)} collected · ${formatNumber(financialSnapshot.collectionRate)}% collection rate`}
            onPress={() => openScreen("invoices")}
          >
            <ProgressLine label="Collections" value={financialSnapshot.collectionRate} tone="success" />
            <ProgressLine label="Profit rate" value={financialSnapshot.profitRate} tone="primary" />
          </DashboardPanel>

          <DashboardPanel title="Pending operations" caption={`${formatNumber(pendingOrders.length)} orders awaiting completion`} onPress={() => openScreen("orders")}>
            {!pendingOrders.length && <EmptyState>No pending operations right now.</EmptyState>}
            {pendingOrders.slice(0, 6).map((order) => (
              <QueueRow
                key={`pending-${order.id}`}
                title={order.orderNumber || `Order ${order.id}`}
                meta={`${order.type.toUpperCase()} · ${order.partyType} · ${order.partyName}`}
                status={order.status}
                onPress={() => openScreen("orders")}
              />
            ))}
          </DashboardPanel>

          <DashboardPanel title="Recent invoices" caption="Latest billing documents" onPress={() => openScreen("invoices")}>
            {!recentInvoices.length && <EmptyState>No recent invoices yet.</EmptyState>}
            {recentInvoices.map((invoice) => (
              <QueueRow
                key={invoice.id}
                title={invoice.invoiceNumber || `Invoice ${invoice.id}`}
                meta={`${invoice.invoiceType || "Invoice"} · ${invoice.partyType || "Party"} · ${invoice.status || "Status"}`}
                value={formatCurrency(getInvoiceTotal(invoice))}
                valueTone="success"
                onPress={() => openScreen("invoices")}
              />
            ))}
          </DashboardPanel>
        </View>

        <View style={styles.dashboardColumn}>
          <DashboardPanel title="Stock attention" caption={`${formatNumber(lowStockProducts.length)} products below reorder level`} onPress={() => openInventory({ view: "lowStock" })}>
            {!lowStockProducts.length && <EmptyState>No low-stock products right now.</EmptyState>}
            {lowStockProducts.slice(0, 6).map((product) => {
              const metrics = getProductMetrics(product);

              return (
                <QueueRow
                  key={product.id}
                  title={product.name}
                  meta={`Reorder ${product.reorderLevel} · Supplier ${product.supplier}`}
                  value={`${formatNumber(metrics.remaining)} left`}
                  valueTone="danger"
                  onPress={() => openInventory({ view: "lowStock", productId: product.id })}
                />
              );
            })}
          </DashboardPanel>

          <DashboardPanel title="Damaged products queue" caption={`${formatWholeNumber(damagedMetrics.availableQuantity)} units available for action`} onPress={() => openInventory({ view: "damaged" })}>
            {!damagedQueue.length && <EmptyState>No damaged products waiting for action.</EmptyState>}
            {damagedQueue.map((item) => (
              <QueueRow
                key={`damage-${item.id}`}
                title={item.productName || `Product ${item.productId}`}
                meta={`${item.supplierName || "Supplier not assigned"} · ${item.damageType || item.returnReason || "Damaged"} · Invoice ${item.invoiceNumber || "-"}`}
                value={`${formatWholeNumber(item.availableQuantity ?? item.quantity)} available`}
                valueTone="danger"
                onPress={() => openInventory({ view: "damaged", damageId: item.id, productId: item.productId })}
              />
            ))}
          </DashboardPanel>

          <DashboardPanel title="Active activity" caption={`${formatNumber(filteredActivity.length)} active records`} onPress={() => openScreen("orders")}>
            {!filteredActivity.length && <EmptyState>No active activity yet.</EmptyState>}
            {filteredActivity.slice(0, 6).map((order) => (
              <QueueRow
                key={order.id}
                title={order.orderNumber || `Order ${order.id}`}
                meta={`${order.type.toUpperCase()} · ${order.partyType} · ${order.partyName}`}
                status={order.status}
                onPress={() => openScreen("orders")}
              />
            ))}
          </DashboardPanel>
        </View>
      </View>
    </ScrollView>
  );
}

function timelineInventoryValue(point) {
  return safeNumber(point?.inventoryValue ?? point?.inventory_value);
}

function timelineChangeValue(point) {
  return safeNumber(point?.changeValue ?? point?.change_value);
}

function timelineInboundValue(point) {
  return safeNumber(point?.inboundValue ?? point?.inbound_value);
}

function timelineOutboundValue(point) {
  return Math.abs(safeNumber(point?.outboundValue ?? point?.outbound_value));
}

function timelineMovementCount(point) {
  return safeNumber(point?.movementCount ?? point?.movement_count);
}

function InventoryValueMetric({ onPress, productCount, range, timeline = [], value }) {
  const Wrapper = onPress ? TouchableOpacity : View;
  const [isHovered, setIsHovered] = useState(false);
  const hoverHandlers = onPress && Platform.OS === "web"
    ? { onMouseEnter: () => setIsHovered(true), onMouseLeave: () => setIsHovered(false) }
    : {};
  const rows = [...timeline].filter(Boolean);
  const latest = rows[rows.length - 1];
  const openingValue = rows.length ? Math.max(0, timelineInventoryValue(rows[0]) - timelineChangeValue(rows[0])) : safeNumber(value);
  const closingValue = latest ? timelineInventoryValue(latest) : safeNumber(value);
  const rangeChange = rows.reduce((total, row) => total + timelineChangeValue(row), 0);
  const inboundValue = rows.reduce((total, row) => total + timelineInboundValue(row), 0);
  const outboundValue = rows.reduce((total, row) => total + timelineOutboundValue(row), 0);
  const movementCount = rows.reduce((total, row) => total + timelineMovementCount(row), 0);
  // The headline is always the value of stock currently available. The range
  // controls only the movement explanation beneath it, so Dashboard and
  // Inventory always agree on current inventory value.
  const displayValue = closingValue;
  const displayLabel = "Current inventory value";
  const displayCaption = `Current stock cost · ${formatNumber(productCount)} products`;
  const trendText =
    rangeChange > 0
      ? `Increased ${formatCurrency(rangeChange)} in ${range}`
      : rangeChange < 0
        ? `Reduced ${formatCurrency(Math.abs(rangeChange))} in ${range}`
        : `No change in ${range}`;
  const detailText = `Opening ${formatCurrency(openingValue)}, closing ${formatCurrency(closingValue)}, added ${formatCurrency(inboundValue)}, reduced ${formatCurrency(outboundValue)}, ${formatNumber(movementCount)} stock movements.`;

  return (
    <Wrapper
      activeOpacity={0.88}
      accessibilityHint={detailText}
      onPress={onPress}
      style={[styles.executiveMetric, styles.inventoryMetric, onPress && styles.pressableSurface, isHovered && styles.hoverSurface]}
      {...hoverHandlers}
    >
      <View style={styles.executiveMetricTop}>
        <Text style={styles.executiveMetricLabel}>{displayLabel}</Text>
        <View style={[styles.executiveMetricDot, styles.primaryFill]} />
      </View>
      <Text adjustsFontSizeToFit minimumFontScale={0.72} numberOfLines={1} style={styles.executiveMetricValue}>
        {formatCurrency(displayValue)}
      </Text>
      <Text style={styles.executiveMetricCaption}>{displayCaption}</Text>
      <View style={styles.inventoryMetricTrend}>
        <Text style={[styles.inventoryMetricTrendText, rangeChange < 0 && styles.dangerText, rangeChange > 0 && styles.successText]}>
          {trendText}
        </Text>
      </View>
      {onPress ? <Text style={styles.drillCue}>View inventory products</Text> : null}
    </Wrapper>
  );
}

function ExecutiveMetric({ actionLabel = "View more", caption, label, onPress, tone = "primary", value }) {
  const Wrapper = onPress ? TouchableOpacity : View;
  const [isHovered, setIsHovered] = useState(false);
  const hoverHandlers = onPress && Platform.OS === "web"
    ? { onMouseEnter: () => setIsHovered(true), onMouseLeave: () => setIsHovered(false) }
    : {};
  return (
    <Wrapper
      activeOpacity={0.88}
      onPress={onPress}
      style={[styles.executiveMetric, onPress && styles.pressableSurface, isHovered && styles.hoverSurface]}
      {...hoverHandlers}
    >
      <View style={styles.executiveMetricTop}>
        <Text style={styles.executiveMetricLabel}>{label}</Text>
        <View style={[styles.executiveMetricDot, styles[`${tone}Fill`]]} />
      </View>
      <Text adjustsFontSizeToFit minimumFontScale={0.78} numberOfLines={1} style={styles.executiveMetricValue}>{value}</Text>
      <Text style={styles.executiveMetricCaption}>{caption}</Text>
      {onPress ? <Text style={styles.drillCue}>{actionLabel}</Text> : null}
    </Wrapper>
  );
}

function HealthCard({ actionLabel = "View products", caption, label, onPress, progress, tone = "primary", value }) {
  const Wrapper = onPress ? TouchableOpacity : View;
  const [isHovered, setIsHovered] = useState(false);
  const hoverHandlers = onPress && Platform.OS === "web"
    ? { onMouseEnter: () => setIsHovered(true), onMouseLeave: () => setIsHovered(false) }
    : {};
  return (
    <Wrapper
      activeOpacity={0.88}
      onPress={onPress}
      style={[styles.healthCard, onPress && styles.pressableSurface, isHovered && styles.hoverSurface]}
      {...hoverHandlers}
    >
      <View style={styles.healthTop}>
        <Text style={styles.healthLabel}>{label}</Text>
        <Text style={[styles.healthValue, styles[`${tone}Text`]]}>{value}</Text>
      </View>
      <Text style={styles.healthCaption}>{caption}</Text>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, styles[`${tone}Fill`], { width: `${Math.max(0, Math.min(100, progress || 0))}%` }]} />
      </View>
      {onPress ? <Text style={styles.healthDrillCue}>{actionLabel}</Text> : null}
    </Wrapper>
  );
}

function DashboardPanel({ caption, children, onPress, title }) {
  return (
    <View style={styles.panel}>
      <View style={styles.panelHeader}>
        <Text style={styles.panelTitle}>{title}</Text>
        <View style={styles.panelCaptionRow}>
          {!!caption && <Text style={styles.panelCaption}>{caption}</Text>}
          {!!onPress && (
            <TouchableOpacity activeOpacity={0.85} onPress={onPress} style={[styles.panelAction, styles.pressableSurface]}>
              <Text style={styles.panelActionText}>Open</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      <View style={styles.panelBody}>{children}</View>
    </View>
  );
}

function ProgressLine({ label, tone = "primary", value }) {
  const safeValue = Math.max(0, Math.min(100, value || 0));
  return (
    <View style={styles.progressLine}>
      <View style={styles.progressLineTop}>
        <Text style={styles.progressLabel}>{label}</Text>
        <Text style={styles.progressValue}>{formatNumber(safeValue)}%</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, styles[`${tone}Fill`], { width: `${safeValue}%` }]} />
      </View>
    </View>
  );
}

function QueueRow({ meta, onPress, status, title, value, valueTone = "primary" }) {
  const Wrapper = onPress ? TouchableOpacity : View;
  const [isHovered, setIsHovered] = useState(false);
  const hoverHandlers = onPress && Platform.OS === "web"
    ? { onMouseEnter: () => setIsHovered(true), onMouseLeave: () => setIsHovered(false) }
    : {};
  return (
    <Wrapper
      activeOpacity={0.86}
      onPress={onPress}
      style={[styles.queueRow, onPress && styles.queueRowClickable, onPress && styles.pressableSurface, isHovered && styles.hoverRow]}
      {...hoverHandlers}
    >
      <View style={styles.queueText}>
        <Text style={styles.rowTitle} numberOfLines={1}>{title}</Text>
        {!!meta && <Text style={styles.rowSub} numberOfLines={1}>{meta}</Text>}
      </View>
      {!!status && <Text style={styles.badge} numberOfLines={1}>{status}</Text>}
      {!!value && <Text style={[styles.rowValue, styles[`${valueTone}Text`]]} numberOfLines={1}>{value}</Text>}
    </Wrapper>
  );
}

function EmptyState({ children }) {
  return <Text style={styles.emptyText}>{children}</Text>;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    paddingBottom: spacing.xl,
  },
  executivePanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.md,
    boxShadow: "0 6px 18px rgba(34, 48, 58, 0.06)",
  },
  executiveHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  executiveTitleWrap: {
    flexBasis: 260,
    flexGrow: 1,
  },
  executiveCaption: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 4,
  },
  rangeChips: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    maxWidth: "100%",
    padding: spacing.xs,
  },
  executiveMetrics: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  executiveMetric: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexBasis: 210,
    flexGrow: 1,
    flexDirection: "column",
    minHeight: 116,
    minWidth: 0,
    padding: spacing.md,
  },
  pressableSurface: {
    cursor: "pointer",
  },
  hoverSurface: {
    backgroundColor: "#FBFDFB",
    boxShadow: "0 8px 20px rgba(34, 48, 58, 0.07)",
    transform: [{ translateY: -1 }],
  },
  executiveMetricTop: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  executiveMetricLabel: {
    color: colors.muted,
    flex: 1,
    fontSize: 11,
    fontWeight: "700",
  },
  executiveMetricDot: {
    borderRadius: 999,
    height: 8,
    width: 8,
  },
  drillCue: {
    alignSelf: "flex-end",
    color: "#1D4ED8",
    fontSize: 10,
    fontWeight: "700",
    marginTop: "auto",
    overflow: "hidden",
    paddingTop: spacing.sm,
  },
  executiveMetricValue: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: "800",
    marginTop: spacing.sm,
  },
  executiveMetricCaption: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "600",
    marginTop: spacing.xs,
  },
  inventoryMetric: {
    flexBasis: 210,
    minHeight: 116,
  },
  inventoryMetricTrend: {
    gap: 2,
    marginTop: spacing.xs,
  },
  inventoryMetricTrendText: {
    color: colors.ink,
    fontSize: 11,
    fontWeight: "700",
  },
  contextLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  contextValue: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "800",
    marginTop: 2,
  },
  healthGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  healthCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexBasis: 220,
    flexGrow: 1,
    flexDirection: "column",
    minHeight: 98,
    padding: spacing.md,
    boxShadow: "0 3px 10px rgba(34, 48, 58, 0.03)",
  },
  healthTop: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  healthLabel: {
    color: colors.muted,
    flex: 1,
    fontSize: 11,
    fontWeight: "700",
  },
  healthValue: {
    flexShrink: 1,
    fontSize: 18,
    fontWeight: "800",
    textAlign: "right",
  },
  healthCaption: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
    marginTop: spacing.xs,
    minHeight: 30,
  },
  healthDrillCue: {
    alignSelf: "flex-end",
    color: "#1D4ED8",
    fontSize: 10,
    fontWeight: "700",
    marginTop: "auto",
    overflow: "hidden",
    paddingTop: spacing.sm,
  },
  progressTrack: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 8,
    marginTop: spacing.sm,
    overflow: "hidden",
  },
  progressFill: {
    borderRadius: 999,
    height: "100%",
  },
  primaryFill: { backgroundColor: colors.primary },
  successFill: { backgroundColor: colors.success },
  warningFill: { backgroundColor: colors.warning },
  dangerFill: { backgroundColor: colors.danger },
  primaryText: { color: colors.primaryDark },
  successText: { color: colors.success },
  warningText: { color: colors.warning },
  dangerText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "700",
  },
  dashboardGrid: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    padding: spacing.md,
  },
  dashboardColumn: {
    flexBasis: 420,
    flexGrow: 1,
    gap: spacing.md,
    minWidth: 0,
  },
  panel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: "hidden",
    boxShadow: "0 3px 10px rgba(34, 48, 58, 0.03)",
  },
  panelHeader: {
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  panelTitle: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "800",
  },
  panelCaption: {
    color: colors.muted,
    flex: 1,
    fontSize: 11,
    lineHeight: 16,
    marginTop: 3,
  },
  panelCaptionRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  panelAction: {
    paddingVertical: 4,
  },
  panelActionText: {
    color: "#1D4ED8",
    fontSize: 10,
    fontWeight: "700",
  },
  panelBody: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  progressLine: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  progressLineTop: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  progressLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
  },
  progressValue: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "800",
  },
  queueRow: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 54,
    paddingVertical: spacing.sm,
  },
  queueRowClickable: {
    paddingHorizontal: spacing.xs,
  },
  hoverRow: {
    backgroundColor: "#FBFDFB",
  },
  queueText: {
    flex: 1,
    minWidth: 0,
  },
  rowValue: {
    flexShrink: 0,
    fontSize: 12,
    fontWeight: "800",
    maxWidth: 130,
    textAlign: "right",
  },
  rowTitle: {
    color: colors.ink,
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
  },
  rowSub: {
    color: colors.muted,
    fontSize: 12,
    marginTop: spacing.xs,
  },
  emptyText: {
    color: colors.muted,
    fontSize: 12,
    fontStyle: "italic",
    paddingHorizontal: spacing.xs,
  },
  dangerText: {
    color: colors.danger,
    fontSize: 13,
    fontWeight: "700",
  },
  badge: {
    backgroundColor: colors.warningSoft,
    borderRadius: 99,
    color: colors.warning,
    fontSize: 11,
    fontWeight: "700",
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
});
