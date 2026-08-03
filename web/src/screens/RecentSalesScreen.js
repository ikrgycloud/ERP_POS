import React, { useEffect, useMemo, useState } from "react";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { AdvancedFilterPanel } from "../components/AdvancedFilterPanel";
import { FilterBar } from "../components/FilterBar";
import { FilterChips } from "../components/FilterChips";
import { FilterSection } from "../components/FilterSection";
import { FormField } from "../components/FormField";
import { PaginationControls } from "../components/PaginationControls";
import { SearchInput } from "../components/SearchInput";
import { ScreenHeader } from "../components/ScreenHeader";
import { colors, radii, responsiveCardBasis, spacing, typography } from "../constants/theme";
import { formatCurrency, formatDate, formatNumber } from "../utils/formatters";

const PAGE_SIZE = 8;

function safeNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function safeDate(value) {
  const parsed = value ? new Date(value) : null;
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

function valueOf(record, camelKey, snakeKey = camelKey) {
  return record?.[camelKey] ?? record?.[snakeKey];
}

function formatPercent(value) {
  const numberValue = safeNumber(value);
  if (numberValue <= 0) return "0%";
  return `${Number(numberValue.toFixed(2))}%`;
}

function lineSubtotal(item) {
  return safeNumber(valueOf(item, "lineSubtotal", "line_subtotal")) || safeNumber(item.quantity) * safeNumber(item.rate);
}

function lineDiscount(item) {
  return safeNumber(valueOf(item, "discountAmount", "discount_amount"));
}

function lineTaxable(item) {
  return safeNumber(valueOf(item, "lineTotal", "line_total")) || Math.max(0, lineSubtotal(item) - lineDiscount(item));
}

function lineTax(item) {
  return (lineTaxable(item) * safeNumber(valueOf(item, "gstRate", "gst_rate"))) / 100;
}

function lineGrandTotal(item) {
  return lineTaxable(item) + lineTax(item);
}

function orderSubtotal(order) {
  return safeNumber(valueOf(order, "subtotalValue", "subtotal_value")) || (order.items || []).reduce((total, item) => total + lineSubtotal(item), 0);
}

function orderDiscount(order) {
  return safeNumber(valueOf(order, "discountValue", "discount_value")) || (order.items || []).reduce((total, item) => total + lineDiscount(item), 0);
}

function orderTaxable(order) {
  return safeNumber(valueOf(order, "taxableValue", "taxable_value")) || (order.items || []).reduce((total, item) => total + lineTaxable(item), 0);
}

function orderTax(order) {
  return safeNumber(valueOf(order, "taxValue", "tax_value")) || (order.items || []).reduce((total, item) => total + lineTax(item), 0);
}

function orderTotal(order) {
  return safeNumber(valueOf(order, "grandTotal", "grand_total")) || orderTaxable(order) + orderTax(order);
}

function itemDiscountOffer(item) {
  const discountPct = safeNumber(valueOf(item, "discountPct", "discount_pct"));
  if (discountPct > 0) return formatPercent(discountPct);
  const subtotal = lineSubtotal(item);
  const discount = lineDiscount(item);
  if (subtotal > 0 && discount > 0) return formatPercent((discount / subtotal) * 100);
  return "0%";
}

function orderDiscountSummary(order) {
  const offers = Array.from(
    new Set((order.items || []).map(itemDiscountOffer).filter((offer) => offer !== "0%"))
  );
  if (!offers.length) return "0%";
  return offers.length <= 2 ? offers.join(", ") : `${offers.slice(0, 2).join(", ")} +${offers.length - 2}`;
}

function orderQuantity(order) {
  return (order.items || []).reduce((total, item) => total + safeNumber(item.quantity), 0);
}

function orderProductCount(order) {
  return new Set((order.items || []).map((item) => item.productId ?? item.product_id).filter(Boolean)).size;
}

function paymentTone(status) {
  const normalized = String(status || "").toLowerCase();
  if (normalized === "paid") return "success";
  if (normalized === "partially paid") return "warning";
  return "danger";
}

export function RecentSalesScreen({ currentOutlet, orders = [], sessionRole }) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 980;
  const summaryCardBasis = responsiveCardBasis(width, 4);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All Status");
  const [partyFilter, setPartyFilter] = useState("All Parties");
  const [paymentFilter, setPaymentFilter] = useState("All Payments");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);

  const saleOrders = useMemo(
    () =>
      orders.filter((order) => {
        if (order.type !== "sale" || String(order.status || "").toLowerCase() === "deleted") {
          return false;
        }
        return !(sessionRole === "outlet" && currentOutlet?.id && Number(order.outletId) !== Number(currentOutlet.id));
      }),
    [currentOutlet?.id, orders, sessionRole]
  );

  const statusOptions = useMemo(
    () => ["All Status", ...Array.from(new Set(saleOrders.map((order) => order.status).filter(Boolean))).sort()],
    [saleOrders]
  );
  const paymentOptions = useMemo(
    () => ["All Payments", ...Array.from(new Set(saleOrders.map((order) => order.paymentStatus).filter(Boolean))).sort()],
    [saleOrders]
  );

  const sales = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return saleOrders
      .filter((order) => {
        const matchesStatus = statusFilter === "All Status" || order.status === statusFilter;
        const matchesParty = partyFilter === "All Parties" || order.partyType === partyFilter;
        const matchesPayment = paymentFilter === "All Payments" || order.paymentStatus === paymentFilter;
        const matchesStart = !startDate || order.date >= startDate;
        const matchesEnd = !endDate || order.date <= endDate;
        const blob = [order.orderNumber, order.partyName, order.partyType, order.status, order.paymentStatus]
          .concat((order.items || []).flatMap((item) => [item.productName, item.sku, item.productId, item.product_id]))
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return matchesStatus && matchesParty && matchesPayment && matchesStart && matchesEnd && blob.includes(normalizedSearch);
      })
      .sort((left, right) => {
        const dateDiff = (safeDate(right.date)?.getTime() || 0) - (safeDate(left.date)?.getTime() || 0);
        return dateDiff || safeNumber(right.id) - safeNumber(left.id);
      });
  }, [endDate, partyFilter, paymentFilter, saleOrders, search, startDate, statusFilter]);

  useEffect(() => {
    setCurrentPage(1);
  }, [endDate, partyFilter, paymentFilter, search, startDate, statusFilter]);

  const summary = useMemo(() => {
    const gross = sales.reduce((total, order) => total + orderSubtotal(order), 0);
    const discount = sales.reduce((total, order) => total + orderDiscount(order), 0);
    const taxable = sales.reduce((total, order) => total + orderTaxable(order), 0);
    const tax = sales.reduce((total, order) => total + orderTax(order), 0);
    const total = sales.reduce((sum, order) => sum + orderTotal(order), 0);
    const units = sales.reduce((sum, order) => sum + orderQuantity(order), 0);
    const paidOrders = sales.filter((order) => String(order.paymentStatus || "").toLowerCase() === "paid").length;
    const discountedLines = sales.reduce(
      (sum, order) => sum + (order.items || []).filter((item) => lineDiscount(item) > 0).length,
      0
    );
    return {
      averageOrder: sales.length ? total / sales.length : 0,
      discount,
      discountedLines,
      gross,
      paidOrders,
      tax,
      taxable,
      total,
      units,
    };
  }, [sales]);

  const totalPages = Math.max(1, Math.ceil(sales.length / PAGE_SIZE));
  const visibleSales = sales.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  const clearFilters = () => {
    setEndDate("");
    setPartyFilter("All Parties");
    setPaymentFilter("All Payments");
    setSearch("");
    setStartDate("");
    setStatusFilter("All Status");
  };

  const activeFilterCount = [
    search.trim(),
    startDate,
    endDate,
    statusFilter !== "All Status",
    partyFilter !== "All Parties",
    paymentFilter !== "All Payments",
  ].filter(Boolean).length;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <ScreenHeader
        eyebrow="Sales"
        iconLabel="RS"
        iconTone="success"
        title="Recent Sales"
        subtitle="Track sale orders, discounts, tax, payment state, and sold items in one clean register."
      />

      <View style={styles.summaryGrid}>
        <SummaryCard basis={summaryCardBasis} label="Grand total" tone="success" value={formatCurrency(summary.total)} />
        <SummaryCard basis={summaryCardBasis} label="Gross sales" value={formatCurrency(summary.gross)} />
        <SummaryCard basis={summaryCardBasis} label="Discount given" tone="warning" value={formatCurrency(summary.discount)} />
        <SummaryCard basis={summaryCardBasis} label="Net taxable" value={formatCurrency(summary.taxable)} />
        <SummaryCard basis={summaryCardBasis} label="Tax collected" value={formatCurrency(summary.tax)} />
        <SummaryCard basis={summaryCardBasis} label="Sale orders" value={formatNumber(sales.length)} />
        <SummaryCard basis={summaryCardBasis} label="Items sold" value={formatNumber(summary.units)} />
        <SummaryCard basis={summaryCardBasis} label="Paid orders" tone="success" value={`${formatNumber(summary.paidOrders)} / ${formatNumber(sales.length)}`} />
      </View>

      <View style={styles.filterPanel}>
        <SearchInput placeholder="Search sales by order, customer, product, SKU, or payment" value={search} onChangeText={setSearch} />
        <AdvancedFilterPanel
          activeCount={activeFilterCount}
          clearLabel="Reset"
          isOpen={showAdvancedFilters}
          onClear={clearFilters}
          onToggle={() => setShowAdvancedFilters((value) => !value)}
          title="Sales Filters"
        >
          <FilterSection title="Date range">
            <View style={styles.twoColumn}>
              <FormField label="From date" value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" type="date" />
              <FormField label="To date" value={endDate} onChangeText={setEndDate} placeholder="YYYY-MM-DD" type="date" />
            </View>
          </FilterSection>
          <FilterSection title="Status">
            <FilterChips activeValue={statusFilter} onChange={setStatusFilter} options={statusOptions} />
          </FilterSection>
          <FilterSection title="Payment">
            <FilterChips activeValue={paymentFilter} onChange={setPaymentFilter} options={paymentOptions} />
          </FilterSection>
          <FilterSection title="Party">
            <FilterChips activeValue={partyFilter} onChange={setPartyFilter} options={["All Parties", "B2B", "B2C"]} />
          </FilterSection>
        </AdvancedFilterPanel>
        <FilterBar count={sales.length} label="sales" onClear={clearFilters} />
      </View>

      <View style={styles.registerHeader}>
        <View>
          <Text style={styles.registerTitle}>Sales register</Text>
          <Text style={styles.registerMeta}>
            {formatNumber(summary.discountedLines)} discounted line{summary.discountedLines === 1 ? "" : "s"} - Average {formatCurrency(summary.averageOrder)}
          </Text>
        </View>
        <Text style={styles.registerCount}>{formatNumber(sales.length)} sale{sales.length === 1 ? "" : "s"}</Text>
      </View>

      <View style={styles.list}>
        {isDesktop && visibleSales.length ? (
          <SalesTable sales={visibleSales} />
        ) : (
          visibleSales.map((order) => (
            <SaleCard key={order.id} order={order} />
          ))
        )}
        {!sales.length && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No sales found</Text>
            <Text style={styles.emptyText}>Try changing the date range, payment state, status, or search text.</Text>
          </View>
        )}
      </View>

      <View style={styles.pagination}>
        <PaginationControls
          currentPage={currentPage}
          label="sales"
          onPageChange={setCurrentPage}
          pageSize={PAGE_SIZE}
          totalCount={sales.length}
          totalPages={totalPages}
        />
      </View>
    </ScrollView>
  );
}

function SalesTable({ sales }) {
  return (
      <View style={styles.tableShell}>
      <View style={[styles.tableRow, styles.tableHead]}>
        <Text style={[styles.tableHeadText, styles.colOrder]}>Order</Text>
        <Text style={[styles.tableHeadText, styles.colParty]}>Customer</Text>
        <Text style={[styles.tableHeadText, styles.colProducts]}>Products</Text>
        <Text style={[styles.tableHeadText, styles.colMetric, styles.tableTextRight]}>Original</Text>
        <Text style={[styles.tableHeadText, styles.colMetric, styles.tableTextRight]}>Discount</Text>
        <Text style={[styles.tableHeadText, styles.colMetric, styles.tableTextRight]}>Tax</Text>
        <Text style={[styles.tableHeadText, styles.colMetric, styles.tableTextRight]}>Total</Text>
        <Text style={[styles.tableHeadText, styles.colStatus, styles.tableTextCenter]}>Payment</Text>
      </View>
      {sales.map((order, index) => (
        <View key={order.id} style={[styles.tableRow, index % 2 === 1 && styles.tableRowAlt]}>
          <View style={[styles.tableCell, styles.colOrder]}>
            <Text style={styles.tablePrimary}>{order.orderNumber || `Order ${order.id}`}</Text>
            <Text style={styles.tableSecondary}>{order.date ? formatDate(order.date) : "-"}</Text>
          </View>
          <View style={[styles.tableCell, styles.colParty]}>
            <Text style={styles.tablePrimary} numberOfLines={1}>{order.partyName || "Walk-in Customer"}</Text>
            <Text style={styles.tableSecondary}>{order.partyType || "B2C"} - {order.status || "Draft"}</Text>
          </View>
          <View style={[styles.tableCell, styles.colProducts]}>
            <ProductSummary items={order.items || []} />
          </View>
          <Text style={[styles.tableCellText, styles.colMetric]}>{formatCurrency(orderSubtotal(order))}</Text>
          <Text style={[styles.tableCellText, styles.colMetric]}>{orderDiscountSummary(order)}</Text>
          <Text style={[styles.tableCellText, styles.colMetric]}>{formatCurrency(orderTax(order))}</Text>
          <Text style={[styles.tableCellText, styles.colMetric, styles.tableTotal]}>{formatCurrency(orderTotal(order))}</Text>
          <View style={[styles.tableCell, styles.colStatus, styles.tableCellCenter]}>
            <StatusPill label={order.paymentStatus || "Unpaid"} tone={paymentTone(order.paymentStatus)} />
          </View>
        </View>
      ))}
    </View>
  );
}

function SummaryCard({ basis, label, tone, value }) {
  return (
    <View style={[styles.summaryCard, { flexBasis: basis }]}>
      <Text adjustsFontSizeToFit minimumFontScale={0.76} numberOfLines={1} style={[styles.summaryValue, tone === "success" && styles.successText, tone === "warning" && styles.warningText]}>
        {value}
      </Text>
      <Text style={styles.summaryLabel}>{label}</Text>
    </View>
  );
}

function SaleCard({ order }) {
  const paymentStyle = paymentTone(order.paymentStatus);
  return (
    <View style={styles.card}>
      <View style={styles.cardTop}>
        <View style={styles.orderIdentity}>
          <Text style={styles.orderNumber}>{order.orderNumber || `Order ${order.id}`}</Text>
          <Text style={styles.meta}>{order.partyName || "Walk-in Customer"} - {order.partyType || "B2C"}</Text>
        </View>
        <View style={styles.amountWrap}>
          <Text style={styles.amount}>{formatCurrency(orderTotal(order))}</Text>
          <Text style={styles.meta}>{order.date ? formatDate(order.date) : "-"}</Text>
        </View>
      </View>

      <View style={styles.badgeRow}>
        <Text style={styles.badge}>{order.status || "Draft"}</Text>
        <StatusPill label={order.paymentStatus || "Unpaid"} tone={paymentStyle} />
        <Text style={styles.badge}>{formatNumber(orderProductCount(order))} products</Text>
        <Text style={styles.badge}>{formatNumber(orderQuantity(order))} units</Text>
      </View>

      <View style={styles.totalGrid}>
        <Total label="Original" value={formatCurrency(orderSubtotal(order))} />
        <Total label="Discount" value={orderDiscountSummary(order)} />
        <Total label="Taxable" value={formatCurrency(orderTaxable(order))} />
        <Total label="Tax" value={formatCurrency(orderTax(order))} />
      </View>

      <View style={styles.itemsTable}>
        <View style={[styles.itemLine, styles.itemHeader]}>
          <Text style={[styles.itemCell, styles.itemProduct]}>Product</Text>
          <Text style={[styles.itemCell, styles.itemNumber]}>Qty</Text>
          <Text style={[styles.itemCell, styles.itemNumber]}>Rate</Text>
          <Text style={[styles.itemCell, styles.itemNumber]}>Disc</Text>
          <Text style={[styles.itemCell, styles.itemNumber]}>GST</Text>
          <Text style={[styles.itemCell, styles.itemNumber, styles.itemLastCell]}>Amount</Text>
        </View>
        {(order.items || []).map((item) => (
          <View key={`${order.id}-${item.id || item.productId || item.product_id}`} style={styles.itemLine}>
            <View style={[styles.itemCell, styles.itemProduct]}>
              <Text style={styles.itemName} numberOfLines={1}>{item.productName || `Product ${item.productId || item.product_id}`}</Text>
              <Text style={styles.itemSku} numberOfLines={1}>{item.sku || "SKU not available"}</Text>
            </View>
            <Text style={[styles.itemCell, styles.itemNumber]}>{formatNumber(safeNumber(item.quantity))}</Text>
            <Text style={[styles.itemCell, styles.itemNumber]}>{formatCurrency(item.rate)}</Text>
            <Text style={[styles.itemCell, styles.itemNumber]}>{itemDiscountOffer(item)}</Text>
            <Text style={[styles.itemCell, styles.itemNumber]}>{formatPercent(valueOf(item, "gstRate", "gst_rate"))}</Text>
            <Text style={[styles.itemCell, styles.itemNumber, styles.itemAmount, styles.itemLastCell]}>{formatCurrency(lineGrandTotal(item))}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function ProductSummary({ items }) {
  const visibleItems = items.slice(0, 2);
  const hiddenCount = Math.max(0, items.length - visibleItems.length);
  return (
    <View style={styles.productSummary}>
      {visibleItems.map((item) => (
        <View key={item.id || item.productId || item.product_id} style={styles.productSummaryLine}>
          <Text style={styles.productSummaryName} numberOfLines={1}>{item.productName || `Product ${item.productId || item.product_id}`}</Text>
          <Text style={styles.productSummaryMeta}>{formatNumber(safeNumber(item.quantity))} {item.unitLabel || "units"} - {itemDiscountOffer(item)}</Text>
        </View>
      ))}
      {hiddenCount > 0 && <Text style={styles.moreProducts}>+{hiddenCount} more</Text>}
    </View>
  );
}

function StatusPill({ label, tone }) {
  return <Text style={[styles.badge, styles[`${tone}Badge`]]}>{label}</Text>;
}

function Total({ label, value }) {
  return (
    <View style={styles.totalItem}>
      <Text style={styles.totalLabel}>{label}</Text>
      <Text style={styles.totalValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: spacing.md, paddingBottom: spacing.xl },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  summaryCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexGrow: 1,
    minHeight: 94,
    minWidth: 0,
    padding: spacing.md,
  },
  summaryValue: { color: colors.ink, fontFamily: typography.headingFont, fontSize: 21, fontWeight: "700" },
  summaryLabel: { color: colors.muted, fontFamily: typography.baseFont, fontSize: 12, fontWeight: "700", marginTop: spacing.xs, textTransform: "uppercase" },
  successText: { color: colors.success },
  warningText: { color: colors.warning },
  filterPanel: { gap: spacing.md, paddingHorizontal: spacing.md },
  twoColumn: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  registerHeader: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
  },
  registerTitle: { color: colors.ink, fontFamily: typography.headingFont, fontSize: 18, fontWeight: "700" },
  registerMeta: { color: colors.muted, fontFamily: typography.baseFont, fontSize: 12, fontWeight: "700", marginTop: 3 },
  registerCount: {
    backgroundColor: colors.primarySoft,
    borderRadius: 99,
    color: colors.primaryDark,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: "700",
    overflow: "hidden",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  list: { gap: spacing.md, paddingHorizontal: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  cardTop: { alignItems: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: spacing.md, justifyContent: "space-between" },
  orderIdentity: { flex: 1, minWidth: 220 },
  orderNumber: { color: colors.ink, fontFamily: typography.headingFont, fontSize: 17, fontWeight: "700" },
  meta: { color: colors.muted, fontFamily: typography.baseFont, fontSize: 12, fontWeight: "700", marginTop: 2 },
  amountWrap: { alignItems: "flex-end" },
  amount: { color: colors.success, fontFamily: typography.headingFont, fontSize: 19, fontWeight: "700" },
  badgeRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  badge: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 99,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: typography.baseFont,
    fontSize: 11,
    fontWeight: "700",
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  successBadge: { backgroundColor: colors.successSoft, borderColor: colors.successSoft, color: colors.success },
  warningBadge: { backgroundColor: colors.warningSoft, borderColor: colors.warningSoft, color: colors.warning },
  dangerBadge: { backgroundColor: colors.dangerSoft, borderColor: colors.dangerSoft, color: colors.danger },
  tableShell: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, overflow: "hidden" },
  tableRow: {
    alignItems: "stretch",
    backgroundColor: colors.surface,
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    minHeight: 68,
  },
  tableHead: { backgroundColor: colors.background, borderTopWidth: 0, minHeight: 44 },
  tableRowAlt: { backgroundColor: "#FAFCFB" },
  tableHeadText: {
    borderRightColor: colors.border,
    borderRightWidth: 1,
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 11,
    fontWeight: "700",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.md,
    textTransform: "uppercase",
  },
  tableTextRight: { textAlign: "right" },
  tableTextCenter: { textAlign: "center" },
  tableCell: {
    borderRightColor: colors.border,
    borderRightWidth: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  tableCellCenter: { alignItems: "center" },
  tableCellText: {
    borderRightColor: colors.border,
    borderRightWidth: 1,
    color: colors.ink,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: "700",
    paddingHorizontal: spacing.sm,
    paddingVertical: 24,
    textAlign: "right",
  },
  tablePrimary: { color: colors.ink, fontFamily: typography.baseFont, fontSize: 13, fontWeight: "700" },
  tableSecondary: { color: colors.muted, fontFamily: typography.baseFont, fontSize: 11, fontWeight: "600", marginTop: 3 },
  tableTotal: { color: colors.success },
  colOrder: { flexBasis: 138, flexGrow: 0, flexShrink: 0 },
  colParty: { flexBasis: 170, flexGrow: 0, flexShrink: 0 },
  colProducts: { flex: 1, minWidth: 230 },
  colMetric: { flexBasis: 104, flexGrow: 0, flexShrink: 0 },
  colStatus: { borderRightWidth: 0, flexBasis: 126, flexGrow: 0, flexShrink: 0 },
  productSummary: { gap: 4 },
  productSummaryLine: { gap: 1 },
  productSummaryName: { color: colors.ink, fontFamily: typography.baseFont, fontSize: 12, fontWeight: "700" },
  productSummaryMeta: { color: colors.muted, fontFamily: typography.baseFont, fontSize: 11, fontWeight: "600" },
  moreProducts: { color: colors.primary, fontFamily: typography.baseFont, fontSize: 11, fontWeight: "700", marginTop: 2 },
  totalGrid: {
    backgroundColor: colors.background,
    borderRadius: radii.md,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    padding: spacing.md,
  },
  totalItem: { flexBasis: 130, flexGrow: 1 },
  totalLabel: { color: colors.muted, fontFamily: typography.baseFont, fontSize: 11, fontWeight: "700", textTransform: "uppercase" },
  totalValue: { color: colors.ink, fontFamily: typography.headingFont, fontSize: 14, fontWeight: "700", marginTop: 3 },
  itemsTable: { borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, overflow: "hidden" },
  itemLine: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    minHeight: 52,
  },
  itemHeader: { backgroundColor: colors.primarySoft, borderTopWidth: 0, minHeight: 38 },
  itemCell: {
    borderRightColor: colors.border,
    borderRightWidth: 1,
    color: colors.ink,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: "700",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  itemProduct: { flex: 1.7, minWidth: 150 },
  itemNumber: { flex: 0.75, minWidth: 64, textAlign: "right" },
  itemLastCell: { borderRightWidth: 0 },
  itemName: { color: colors.ink, fontFamily: typography.baseFont, fontSize: 13, fontWeight: "700" },
  itemSku: { color: colors.muted, fontFamily: typography.baseFont, fontSize: 11, fontWeight: "600", marginTop: 2 },
  itemAmount: { color: colors.success },
  emptyCard: { alignItems: "center", backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, padding: spacing.xl },
  emptyTitle: { color: colors.ink, fontFamily: typography.headingFont, fontSize: 17, fontWeight: "700" },
  emptyText: { color: colors.muted, fontFamily: typography.baseFont, fontSize: 13, fontWeight: "700", marginTop: spacing.xs, textAlign: "center" },
  pagination: { paddingHorizontal: spacing.md },
});
