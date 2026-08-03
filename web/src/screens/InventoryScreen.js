import React, { useEffect, useMemo, useState } from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { AppButton } from "../components/AppButton";
import { FilterChips } from "../components/FilterChips";
import { PaginationControls } from "../components/PaginationControls";
import { SearchInput } from "../components/SearchInput";
import { ScreenHeader } from "../components/ScreenHeader";
import { useModal } from "../components/ModalProvider";
import {
  colors,
  radii,
  responsiveCardBasis,
  spacing,
  typography,
} from "../constants/theme";
import { formatCurrency, formatDate, formatNumber } from "../utils/formatters";
import { getProductMetrics } from "../utils/erpCalculations";

const PAGE_SIZE = 12;
const stockFilters = ["All stock", "Restock needed", "Low stock", "Out of stock", "Damaged"];
const sortOptions = [
  { key: "value", label: "Highest value" },
  { key: "name", label: "Product name" },
  { key: "quantity", label: "Lowest stock" },
];

function timeLabel(value) {
  if (!value) return "Syncing";
  return value.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function whole(value) {
  return formatNumber(
    Math.round(Number.isFinite(Number(value)) ? Number(value) : 0),
  );
}

function unitLabel(value, singular, plural = `${singular}s`) {
  return `${whole(value)} ${Number(value) === 1 ? singular : plural}`;
}

function restockSummary({ lowStock = 0, outOfStock = 0 } = {}) {
  const riskCount = Number(lowStock || 0) + Number(outOfStock || 0);
  if (!riskCount) return "No restock action needed";
  const parts = [];
  if (outOfStock) parts.push(`${unitLabel(outOfStock, "out-of-stock item")}`);
  if (lowStock) parts.push(`${unitLabel(lowStock, "low-stock item")}`);
  return parts.join(" · ");
}

function minimumRestockQuantity(record) {
  if (!record || record.state?.key === "healthy") return 0;
  return Math.max(1, Math.ceil(Number(record.reorderLevel || 0) - Number(record.remaining || 0) + 1));
}

function stockState(record) {
  if (Number(record.remaining) <= 0)
    return { key: "out", label: "Out of stock", tone: "danger" };
  if (Number(record.remaining) <= Number(record.reorderLevel))
    return { key: "low", label: "Low stock", tone: "warning" };
  return { key: "healthy", label: "In stock", tone: "success" };
}

function StatusPill({ label, tone = "success" }) {
  return (
    <Text
      style={[
        styles.statusPill,
        tone === "danger"
          ? styles.statusDanger
          : tone === "warning"
            ? styles.statusWarning
            : styles.statusSuccess,
      ]}
    >
      {label}
    </Text>
  );
}

function SyncBadge({ lastUpdatedAt }) {
  return (
    <View style={styles.syncBadge}>
      <View style={styles.syncDot} />
      <Text style={styles.syncText}>Updated {timeLabel(lastUpdatedAt)}</Text>
    </View>
  );
}

export function InventoryScreen({
  products = [],
  damagedInventory = [],
  databaseInventoryValue,
  inventoryValueRange = "All Time",
  inventoryValueRangeOptions = [],
  inventoryValueReport = null,
  inventoryValueTimeline = [],
  supplierReturns = [],
  suppliers = [],
  navigationIntent,
  isBusy,
  onCreateSupplierReturn,
  onDispatchSupplierReturn,
  onResendSupplierReturnNotification,
  onDownloadSupplierReturnPdf,
  onInventoryValueRangeChange,
  onOpenPurchaseOrders,
  onRestockProduct,
}) {
  const modal = useModal();
  const { width } = useWindowDimensions();
  const isWide = width >= 860;
  const cardBasis = responsiveCardBasis(width);
  const [activeTab, setActiveTab] = useState("overview");
  const [filter, setFilter] = useState("All stock");
  const [categoryFilter, setCategoryFilter] = useState("All categories");
  const [supplierFilter, setSupplierFilter] = useState("All suppliers");
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState("value");
  const [page, setPage] = useState(1);
  const [selectedDamageId, setSelectedDamageId] = useState(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState("");
  const [returnQuantity, setReturnQuantity] = useState("");
  const [returnRemarks, setReturnRemarks] = useState("");
  const [dispatchDraft, setDispatchDraft] = useState({});
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  const damagedProductQuantity = useMemo(() => {
    const map = new Map();
    damagedInventory.forEach((item) => {
      const productId = String(item.productId || "");
      if (!productId) return;
      const quantity = Number(item.availableQuantity ?? item.quantity ?? 0);
      if (quantity <= 0) return;
      map.set(productId, Number(map.get(productId) || 0) + quantity);
    });
    return map;
  }, [damagedInventory]);
  const damagedProductIds = useMemo(
    () => new Set(Array.from(damagedProductQuantity.keys())),
    [damagedProductQuantity],
  );
  const selectedDamage = useMemo(
    () =>
      damagedInventory.find(
        (item) => String(item.id) === String(selectedDamageId),
      ) || null,
    [damagedInventory, selectedDamageId],
  );

  const summary = useMemo(() => {
    const records = products.map((product) => ({
      ...product,
      metrics: getProductMetrics(product),
    }));
    const calculatedTotalValue = records.reduce(
      (sum, product) => sum + Number(product.metrics.inventoryValue || 0),
      0,
    );
    const databaseTotalValue = Number(databaseInventoryValue);
    const totalValue = Number.isFinite(databaseTotalValue)
      ? databaseTotalValue
      : calculatedTotalValue;
    const totalUnits = records.reduce(
      (sum, product) => sum + Number(product.metrics.remaining || 0),
      0,
    );
    const lowStock = records.filter(
      (product) =>
        Number(product.metrics.remaining) > 0 &&
        Number(product.metrics.remaining) <= Number(product.reorderLevel || 0),
    ).length;
    const outOfStock = records.filter(
      (product) => Number(product.metrics.remaining) <= 0,
    ).length;
    const damagedUnits = damagedInventory.reduce(
      (sum, item) => sum + Number(item.availableQuantity ?? item.quantity ?? 0),
      0,
    );
    return {
      totalProducts: records.length,
      totalValue,
      totalUnits,
      lowStock,
      outOfStock,
      damagedUnits,
      healthyProducts: Math.max(0, records.length - lowStock - outOfStock),
    };
  }, [damagedInventory, databaseInventoryValue, products]);
  const valueReport = inventoryValueReport;

  const records = useMemo(
    () =>
      products.map((product) => {
        const metrics = getProductMetrics(product);
        const record = {
          id: product.id,
          name: product.name || "Unnamed product",
          sku: product.sku || "—",
          category: product.category || "Uncategorised",
          supplier: product.supplier || "Supplier not assigned",
          remaining: Number(metrics.remaining || 0),
          reorderLevel: Number(product.reorderLevel || 0),
          inventoryValue: Number(metrics.inventoryValue || 0),
        };
        const reorderTarget = Math.max(record.reorderLevel, 1);
        const state = stockState(record);
        return {
          ...record,
          damagedQuantity: Number(damagedProductQuantity.get(String(record.id)) || 0),
          hasDamagedStock: damagedProductIds.has(String(record.id)),
          stockRatio: Math.max(0, Math.min(1, record.remaining / reorderTarget)),
          state,
          restockNeed: minimumRestockQuantity({ ...record, state }),
        };
      }),
    [damagedProductIds, damagedProductQuantity, products],
  );

  const filteredRecords = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return records
      .filter((record) => {
        const matchesSearch =
          !needle ||
          [record.name, record.sku, record.category, record.supplier].some(
            (value) => String(value).toLowerCase().includes(needle),
          );
        const matchesFilter =
          filter === "All stock" ||
          (filter === "Restock needed" && ["low", "out"].includes(record.state.key)) ||
          (filter === "Low stock" && record.state.key === "low") ||
          (filter === "Out of stock" && record.state.key === "out") ||
          (filter === "Damaged" && damagedProductIds.has(String(record.id)));
        const matchesCategory = categoryFilter === "All categories" || record.category === categoryFilter;
        const matchesSupplier = supplierFilter === "All suppliers" || record.supplier === supplierFilter;
        return matchesSearch && matchesFilter && matchesCategory && matchesSupplier;
      })
      .sort((left, right) =>
        sort === "name"
          ? left.name.localeCompare(right.name)
          : sort === "quantity"
            ? left.remaining - right.remaining
            : right.inventoryValue - left.inventoryValue,
      );
  }, [categoryFilter, damagedProductIds, filter, records, search, sort, supplierFilter]);

  const categoryOptions = useMemo(
    () => ["All categories", ...Array.from(new Set(records.map((record) => record.category))).sort()],
    [records],
  );
  const supplierOptions = useMemo(
    () => ["All suppliers", ...Array.from(new Set(records.map((record) => record.supplier))).sort()],
    [records],
  );

  const totalPages = Math.max(1, Math.ceil(filteredRecords.length / PAGE_SIZE));
  const visibleRecords = filteredRecords.slice(
    (page - 1) * PAGE_SIZE,
    page * PAGE_SIZE,
  );

  useEffect(() => setPage(1), [categoryFilter, filter, search, sort, supplierFilter]);
  useEffect(() => {
    setLastUpdatedAt(new Date());
  }, [damagedInventory, products, supplierReturns]);
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);
  useEffect(() => {
    if (!navigationIntent?.key) return;
    setCategoryFilter("All categories");
    setSupplierFilter("All suppliers");
    setSearch("");
    if (navigationIntent.view === "damaged") {
      setActiveTab("returns");
      setFilter("Damaged");
    } else if (navigationIntent.view === "lowStock") {
      setActiveTab("stock");
      setFilter("Restock needed");
    } else {
      setActiveTab("stock");
      setFilter("All stock");
    }
  }, [navigationIntent?.key]);

  const openStockList = (nextFilter = "All stock") => {
    setActiveTab("stock");
    setFilter(nextFilter);
    setCategoryFilter("All categories");
    setSupplierFilter("All suppliers");
    setSearch("");
  };

  function openReturnForm(item) {
    const available = Number(item.availableQuantity ?? item.quantity ?? 0);
    setSelectedDamageId(item.id);
    setSelectedSupplierId(String(item.supplierId || suppliers[0]?.id || ""));
    setReturnQuantity(String(Math.max(available, 0)));
    setReturnRemarks(item.damageType || item.returnReason || "Damaged return");
  }
  function closeReturnForm() {
    setSelectedDamageId(null);
    setSelectedSupplierId("");
    setReturnQuantity("");
    setReturnRemarks("");
  }
  async function submitSupplierReturn() {
    if (!selectedDamage || !onCreateSupplierReturn) return;
    const quantity = Number(returnQuantity || 0);
    const available = Number(
      selectedDamage.availableQuantity ?? selectedDamage.quantity ?? 0,
    );
    if (!selectedSupplierId || quantity <= 0 || quantity > available) return;
    await onCreateSupplierReturn({
      supplierId: Number(selectedSupplierId),
      outletId: selectedDamage.outletId || undefined,
      reason:
        selectedDamage.damageType || selectedDamage.returnReason || "damaged",
      remarks: returnRemarks,
      lines: [
        {
          damagedInventoryId: selectedDamage.id,
          productId: selectedDamage.productId,
          quantity,
          reason:
            selectedDamage.damageType ||
            selectedDamage.returnReason ||
            "damaged",
        },
      ],
    });
    closeReturnForm();
    await modal.success(
      "RTV created successfully.",
      "The damaged quantity has been reserved for supplier dispatch.",
    );
  }
  async function dispatchReturn(item) {
    if (!onDispatchSupplierReturn) return;
    await onDispatchSupplierReturn(item.id, dispatchDraft[item.id] || {});
    setDispatchDraft((current) => ({ ...current, [item.id]: {} }));
    await modal.success(
      "RTV marked as dispatched.",
      "Supplier dispatch notification has been queued.",
    );
  }
  async function downloadReturnPdf(item) {
    if (!onDownloadSupplierReturnPdf || typeof window === "undefined") return;
    const blob = await onDownloadSupplierReturnPdf(item.id);
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${item.rtvNumber || `RTV-${item.id}`}.pdf`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }

  const attentionRecords = records
    .filter(
      (record) =>
        record.state.key === "out" ||
        record.hasDamagedStock ||
        record.state.key === "low",
    )
    .sort((left, right) => {
      const rankFor = (record) =>
        record.state.key === "out" ? 0 : record.hasDamagedStock ? 1 : record.state.key === "low" ? 2 : 3;
      return rankFor(left) - rankFor(right) || left.remaining - right.remaining;
    })
    .slice(0, 5);
  const topValueRecords = [...records]
    .sort((left, right) => right.inventoryValue - left.inventoryValue)
    .slice(0, 5);
  const tabs = [
    { key: "overview", label: "Overview" },
    { key: "value", label: "Value report" },
    { key: "stock", label: "Stock list", count: products.length },
    {
      key: "returns",
      label: "Damaged returns",
      count: damagedInventory.length,
    },
  ];
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader
        eyebrow="Inventory"
        title="Inventory control"
        subtitle="Live stock health, reorder priorities, and supplier returns."
        iconLabel="INV"
        iconTone="warning"
      />

      <View style={styles.navigationRow}>
        <View style={styles.tabBar}>
          {tabs.map((tab) => (
            <TouchableOpacity
              key={tab.key}
              onPress={() => setActiveTab(tab.key)}
              style={[styles.tab, activeTab === tab.key && styles.tabActive]}
            >
              <Text
                style={[
                  styles.tabLabel,
                  activeTab === tab.key && styles.tabLabelActive,
                ]}
              >
                {tab.label}
              </Text>
              {tab.count !== undefined && (
                <Text
                  style={[
                    styles.tabCount,
                    activeTab === tab.key && styles.tabCountActive,
                  ]}
                >
                  {whole(tab.count)}
                </Text>
              )}
            </TouchableOpacity>
          ))}
        </View>
        <SyncBadge lastUpdatedAt={lastUpdatedAt} />
      </View>

      {activeTab === "overview" ? (
        <OverviewWorkspace
          cardBasis={cardBasis}
          summary={summary}
          attentionRecords={attentionRecords}
          topValueRecords={topValueRecords}
          onOpenLowStock={() => openStockList("Restock needed")}
          onOpenDamaged={() => setActiveTab("returns")}
          onOpenPurchaseOrders={onOpenPurchaseOrders}
          lastUpdatedAt={lastUpdatedAt}
        />
      ) : activeTab === "value" ? (
        <InventoryValueReportWorkspace
          range={inventoryValueRange}
          rangeOptions={inventoryValueRangeOptions}
          report={valueReport}
          onRangeChange={onInventoryValueRangeChange}
        />
      ) : activeTab === "stock" ? (
        <View style={styles.workspace}>
          <View style={[styles.toolbar, isWide && styles.toolbarWide]}>
            <View style={styles.searchWrap}>
              <SearchInput
                value={search}
                onChangeText={setSearch}
                placeholder="Search product, SKU, category or supplier"
              />
            </View>
            <View style={styles.sortWrap}>
              <Text style={styles.controlLabel}>Sort by</Text>
              <View style={styles.sortChips}>
                {sortOptions.map((option) => (
                  <TouchableOpacity
                    key={option.key}
                    onPress={() => setSort(option.key)}
                    style={[
                      styles.sortChip,
                      sort === option.key && styles.sortChipActive,
                    ]}
                  >
                    <Text
                      style={[
                        styles.sortChipText,
                        sort === option.key && styles.sortChipTextActive,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
          <View style={styles.filterRow}>
            <Text style={styles.controlLabel}>Stock status</Text>
            <FilterChips
              activeValue={filter}
              options={stockFilters}
              onChange={setFilter}
            />
          </View>
          <View style={styles.filterGrid}>
            <View style={styles.filterGroup}>
              <Text style={styles.controlLabel}>Category</Text>
              <FilterChips
                activeValue={categoryFilter}
                options={categoryOptions}
                onChange={setCategoryFilter}
              />
            </View>
            <View style={styles.filterGroup}>
              <Text style={styles.controlLabel}>Supplier</Text>
              <FilterChips
                activeValue={supplierFilter}
                options={supplierOptions}
                onChange={setSupplierFilter}
              />
            </View>
          </View>
          <View style={styles.tableHeader}>
            <View>
              <Text style={styles.tableTitle}>{filter}</Text>
              <Text style={styles.sectionHint}>
                Select a product below, then create a supplier purchase order to
                restock it.
              </Text>
            </View>
            <View style={styles.tableHeaderAction}>
              <Text style={styles.recordCount}>
                {whole(filteredRecords.length)} products
              </Text>
              {onOpenPurchaseOrders ? (
                <TouchableOpacity
                  onPress={onOpenPurchaseOrders}
                  style={styles.quickAction}
                >
                  <Text style={styles.quickActionText}>
                    Create purchase order
                  </Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
          {visibleRecords.length === 0 ? (
            <EmptyState
              title="No matching products"
              detail="Try clearing the search or choosing a different stock status."
            />
          ) : (
            <View style={styles.table}>
              {isWide && (
                <View style={styles.columnHeader}>
                  <Text style={[styles.columnText, styles.productColumn, styles.headerColumnDivider]}>
                    Product
                  </Text>
                  <Text style={[styles.columnText, styles.stockColumn, styles.stockColumnPadding, styles.headerColumnDivider]}>
                    Stock level
                  </Text>
                  <Text style={[styles.columnText, styles.statusHeaderColumn, styles.headerColumnDivider]}>
                    Status
                  </Text>
                  <Text style={[styles.columnText, styles.valueHeaderColumn, styles.headerColumnDivider]}>
                    Inventory value
                  </Text>
                  <Text style={[styles.columnText, styles.restockHeaderColumn]}>
                    Restock
                  </Text>
                </View>
              )}
              {visibleRecords.map((record) => (
                <InventoryRow
                  key={record.id}
                  record={record}
                  isWide={isWide}
                  onReorder={onRestockProduct}
                />
              ))}
            </View>
          )}
          <PaginationControls
            currentPage={page}
            onPageChange={setPage}
            pageSize={PAGE_SIZE}
            totalCount={filteredRecords.length}
            totalPages={totalPages}
            label="products"
          />
        </View>
      ) : (
        <ReturnsWorkspace
          damagedInventory={damagedInventory}
          supplierReturns={supplierReturns}
          suppliers={suppliers}
          selectedDamage={selectedDamage}
          selectedDamageId={selectedDamageId}
          selectedSupplierId={selectedSupplierId}
          setSelectedSupplierId={setSelectedSupplierId}
          returnQuantity={returnQuantity}
          setReturnQuantity={setReturnQuantity}
          returnRemarks={returnRemarks}
          setReturnRemarks={setReturnRemarks}
          closeReturnForm={closeReturnForm}
          openReturnForm={openReturnForm}
          submitSupplierReturn={submitSupplierReturn}
          dispatchDraft={dispatchDraft}
          setDispatchDraft={setDispatchDraft}
          dispatchReturn={dispatchReturn}
          downloadReturnPdf={downloadReturnPdf}
          isBusy={isBusy}
          onResendSupplierReturnNotification={
            onResendSupplierReturnNotification
          }
        />
      )}
    </ScrollView>
  );
}

function MetricCard({
  basis,
  caption,
  label,
  onPress,
  tone = "primary",
  value,
}) {
  const content = (
    <>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text
        adjustsFontSizeToFit
        minimumFontScale={0.78}
        numberOfLines={1}
        style={[styles.metricValue, tone === "danger" && styles.metricDanger]}
      >
        {value}
      </Text>
      <Text style={styles.metricCaption}>{caption}</Text>
    </>
  );
  return onPress ? (
    <TouchableOpacity
      activeOpacity={0.86}
      onPress={onPress}
      style={[styles.metricCard, styles[`${tone}MetricCard`], { flexBasis: basis }]}
    >
      {content}
    </TouchableOpacity>
  ) : (
    <View style={[styles.metricCard, styles[`${tone}MetricCard`], { flexBasis: basis }]}>{content}</View>
  );
}

function OverviewWorkspace({
  attentionRecords,
  cardBasis,
  lastUpdatedAt,
  onOpenDamaged,
  onOpenLowStock,
  onOpenPurchaseOrders,
  summary,
  topValueRecords,
}) {
  const riskCount = summary.lowStock + summary.outOfStock;
  const healthPercent = summary.totalProducts
    ? Math.round((summary.healthyProducts / summary.totalProducts) * 100)
    : 100;

  return (
    <View style={styles.overviewLayout}>
      <View style={styles.summaryGrid}>
        <MetricCard
          basis={cardBasis}
          label="Products tracked"
          value={whole(summary.totalProducts)}
          caption={`${healthPercent}% healthy stock`}
          tone="primary"
        />
        <MetricCard
          basis={cardBasis}
          label="Inventory value"
          value={formatCurrency(summary.totalValue)}
          caption={`${whole(summary.totalUnits)} units available`}
          tone="success"
        />
        <MetricCard
          basis={cardBasis}
          label="Restock alerts"
          value={unitLabel(riskCount, "product")}
          caption={restockSummary(summary)}
          tone="warning"
          onPress={onOpenLowStock}
        />
        <MetricCard
          basis={cardBasis}
          label="Damaged units"
          value={whole(summary.damagedUnits)}
          caption="Ready for supplier return"
          tone="danger"
          onPress={onOpenDamaged}
        />
      </View>
      <View style={styles.commandPanel}>
        <View style={styles.commandCopy}>
          <View style={styles.commandTitleRow}>
            <Text style={styles.commandEyebrow}>Stock health</Text>
            <SyncBadge lastUpdatedAt={lastUpdatedAt} />
          </View>
          <Text style={styles.commandTitle}>
            {riskCount
              ? `${whole(riskCount)} products need attention`
              : "Inventory is in a healthy range"}
          </Text>
        </View>
        <View style={styles.actionTiles}>
          <ActionTile
            label="Review risk"
            caption={restockSummary(summary)}
            onPress={onOpenLowStock}
            tone="warning"
          />
          <ActionTile
            label="Purchase order"
            caption="Restock selected items"
            onPress={onOpenPurchaseOrders}
            tone="primary"
          />
          <ActionTile
            label="Damaged returns"
            caption={`${whole(summary.damagedUnits)} units pending`}
            onPress={onOpenDamaged}
            tone="danger"
          />
        </View>
      </View>
      <View style={styles.overviewColumns}>
        <OverviewList
          title="Priority queue"
          subtitle="Out, damaged and low-stock products"
          records={attentionRecords}
          accent="warning"
          emptyTitle="Nothing needs attention"
          emptyDetail="Low and out-of-stock products will appear here."
          showState
          showProgress
        />
        <OverviewList
          title="Highest stock value"
          subtitle="Where most inventory value is held"
          records={topValueRecords}
          accent="success"
          emptyTitle="No inventory yet"
          emptyDetail="Products with inventory will appear here."
          showValue
        />
      </View>
    </View>
  );
}

function InventoryValueReportWorkspace({
  onRangeChange,
  range,
  rangeOptions,
  report,
}) {
  if (!report?.summary) {
    return <EmptyState title="Loading inventory value report" detail="Inventory values are being retrieved from the database." />;
  }
  const summary = report.summary;
  const ledger = report.dailyLedger || [];
  const netTone = Number(summary.netChange) < 0 ? "danger" : Number(summary.netChange) > 0 ? "success" : "primary";
  return (
    <View style={styles.workspace}>
      <View style={styles.valueReportHeader}>
        <View style={styles.valueReportTitleWrap}>
          <Text style={styles.sectionTitle}>Inventory value report</Text>
          <Text style={styles.sectionHint}>
            Cost valuation from the inventory ledger for {range}.
          </Text>
        </View>
        {!!rangeOptions?.length && (
          <View style={styles.valueRangePicker}>
            <FilterChips activeValue={range} options={rangeOptions} onChange={onRangeChange} />
          </View>
        )}
      </View>

      <View style={styles.valueReportGrid}>
        <ValueReportCard label="Current inventory value" value={formatCurrency(summary.currentValue)} tone="primary" caption={`${formatNumber(summary.growthPercentage)}% change · Health ${summary.inventoryHealth}/100`} />
        <ValueReportCard label="Opening inventory" value={formatCurrency(summary.openingValue)} caption="Value at the beginning of this range" />
        <ValueReportCard label="Incoming value" value={formatCurrency(summary.incomingValue)} tone="success" caption="Purchases, restock, returns and transfer in" />
        <ValueReportCard label="Outgoing value" value={formatCurrency(summary.outgoingValue)} tone="danger" caption="Sales, damage, expiry, returns and transfer out" />
      </View>

      <View style={styles.valueReconciliation}>
        <Text style={styles.valueReconciliationLabel}>INVENTORY FLOW</Text>
        <Text style={styles.valueReconciliationText}>
          Opening {formatCurrency(summary.openingValue)} → Incoming {formatCurrency(summary.incomingValue)} → Outgoing {formatCurrency(summary.outgoingValue)} → Current {formatCurrency(summary.currentValue)}
        </Text>
      </View>

      <View style={styles.valueMovementPair}>
        <View style={styles.valueMovementBlock}>
          <Text style={styles.valueMovementLabel}>Movement summary</Text>
          <Text style={styles.valueMovementAdded}>{formatCurrency(summary.netChange)}</Text>
          <Text style={styles.valueMovementHint}>{whole(summary.movementCount)} inventory transactions · Average daily change {formatCurrency(summary.averageDailyChange)}</Text>
        </View>
        <View style={styles.valueMovementBlock}>
          <Text style={styles.valueMovementLabel}>Database alerts</Text>
          <Text style={[styles.valueMovementReduced, styles[`${netTone}Text`]]}>{report.alerts?.length || 0}</Text>
          <Text style={styles.valueMovementHint}>{report.alerts?.[0]?.message || "No inventory valuation alerts for this range."}</Text>
        </View>
      </View>

      <View style={styles.valueReportTable}>
        <View style={styles.tableHeader}>
          <View>
            <Text style={styles.tableTitle}>Inventory value ledger</Text>
            <Text style={styles.sectionHint}>Daily database ledger for {range}.</Text>
          </View>
        </View>
        {!ledger.length ? (
          <EmptyState title="No value movement" detail="No stock value movement was recorded for this timeline." />
        ) : (
          ledger.slice().reverse().map((row) => {
            const change = Number(row.netChange || 0);
            return (
              <View key={row.date} style={styles.valueReportRow}>
                <View style={styles.valueReportDateCell}>
                  <Text style={styles.valueReportDate}>{formatDate(row.date)}</Text>
                  <Text style={styles.valueReportMeta}>{whole(row.transactions)} transactions</Text>
                </View>
                <View style={styles.valueReportMiddle}>
                  <View style={styles.dailyMovementChips}>
                    <Text style={styles.dailyAddedChip}>In {formatCurrency(row.incoming)}</Text>
                    <Text style={styles.dailyReducedChip}>Out {formatCurrency(row.outgoing)}</Text>
                  </View>
                  <Text style={styles.valueReportBalance}>Opening {formatCurrency(row.opening)} · Closing {formatCurrency(row.closing)}</Text>
                </View>
                <Text style={[styles.valueReportChange, change < 0 ? styles.dangerText : change > 0 ? styles.successText : styles.primaryText]}>
                  {change > 0 ? "+" : change < 0 ? "-" : ""}
                  {formatCurrency(Math.abs(change))}
                </Text>
              </View>
            );
          })
        )}
      </View>
    </View>
  );
}

function ValueReportCard({ caption, label, tone = "primary", value }) {
  return (
    <View style={[styles.valueReportCard, styles[`${tone}MetricCard`]]}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text
        adjustsFontSizeToFit
        minimumFontScale={0.78}
        numberOfLines={1}
        style={[
          styles.metricValue,
          tone === "danger" && styles.metricDanger,
          tone === "success" && styles.metricSuccess,
        ]}
      >
        {value}
      </Text>
      {!!caption && <Text style={styles.valueReportCaption}>{caption}</Text>}
    </View>
  );
}

function ActionTile({ caption, label, onPress, tone = "primary" }) {
  if (!onPress) return null;
  return (
    <TouchableOpacity
      activeOpacity={0.86}
      onPress={onPress}
      style={[styles.actionTile, styles[`${tone}ActionTile`]]}
    >
      <Text style={styles.actionTileLabel}>{label}</Text>
      <Text style={styles.actionTileCaption}>{caption}</Text>
    </TouchableOpacity>
  );
}

function OverviewList({
  accent = "primary",
  emptyDetail,
  emptyTitle,
  records,
  showProgress = false,
  showState = false,
  showValue = false,
  subtitle,
  title,
}) {
  return (
    <View style={styles.overviewPanel}>
      <View style={styles.overviewPanelHeader}>
        <View>
          <Text style={styles.overviewCardTitle}>{title}</Text>
          <Text style={styles.sectionHint}>{subtitle}</Text>
        </View>
        <Text style={[styles.overviewCountPill, styles[`${accent}OverviewPill`]]}>
          {whole(records.length)}
        </Text>
      </View>
      {records.length === 0 ? (
        <EmptyState title={emptyTitle} detail={emptyDetail} />
      ) : (
        <View style={styles.insightGrid}>
          {records.map((record, index) => (
            <OverviewInsightCard
              key={record.id}
              index={index}
              record={record}
              showProgress={showProgress}
              showState={showState}
              showValue={showValue}
            />
          ))}
        </View>
      )}
    </View>
  );
}

function OverviewInsightCard({ index, record, showProgress, showState, showValue }) {
  return (
    <View style={styles.insightCard}>
      <View style={styles.insightRank}>
        <Text style={styles.insightRankText}>{index + 1}</Text>
      </View>
      <View style={styles.insightMain}>
        <View style={styles.insightTitleRow}>
          <Text numberOfLines={1} style={styles.productName}>
            {record.name}
          </Text>
          {showState ? <StatusPill label={record.state.label} tone={record.state.tone} /> : null}
          {showValue ? <Text style={styles.insightValue}>{formatCurrency(record.inventoryValue)}</Text> : null}
        </View>
        <Text numberOfLines={1} style={styles.productMeta}>
          {record.sku} · {record.category} · {record.supplier}
        </Text>
        <View style={styles.insightMetrics}>
          <Text style={styles.insightMetric}>
            {whole(record.remaining)} <Text style={styles.insightMetricMuted}>available</Text>
          </Text>
          <Text style={styles.insightMetric}>
            {whole(record.reorderLevel)} <Text style={styles.insightMetricMuted}>reorder</Text>
          </Text>
          {record.restockNeed ? (
            <Text style={styles.restockNeedInline}>
              Add {unitLabel(record.restockNeed, "unit")}
            </Text>
          ) : null}
          {record.hasDamagedStock ? <Text style={styles.damagePill}>{whole(record.damagedQuantity)} damaged</Text> : null}
        </View>
        {showProgress ? <StockBar record={record} compact /> : null}
      </View>
    </View>
  );
}

function StockBar({ compact = false, record }) {
  const toneStyle =
    record.state.tone === "danger"
      ? styles.stockBarDanger
      : record.state.tone === "warning"
        ? styles.stockBarWarning
        : styles.stockBarSuccess;
  return (
    <View style={[styles.stockBarTrack, compact && styles.stockBarTrackCompact]}>
      <View style={[styles.stockBarFill, toneStyle, { width: `${Math.max(4, record.stockRatio * 100)}%` }]} />
    </View>
  );
}

function InventoryRow({ isWide, onReorder, record }) {
  const needsRestock = record.state.key === "low" || record.state.key === "out";
  const restockNeed = minimumRestockQuantity(record);
  return (
    <View style={[styles.inventoryRow, !isWide && styles.inventoryRowCompact]}>
      <View style={[styles.productColumn, styles.rowColumnDivider]}>
        <View style={styles.productTitleRow}>
          <Text numberOfLines={1} style={styles.productName}>{record.name}</Text>
          {!isWide ? <StatusPill label={record.state.label} tone={record.state.tone} /> : null}
        </View>
        <Text style={styles.productMeta}>
          {record.sku} · {record.category} · {record.supplier}
        </Text>
        {record.hasDamagedStock ? (
          <Text style={styles.damagePill}>{whole(record.damagedQuantity)} damaged</Text>
        ) : null}
      </View>
      <View style={[styles.stockColumn, styles.stockColumnPadding, styles.rowColumnDivider]}>
        <View style={styles.stockNumbers}>
          <View>
            <Text style={styles.stockFigure}>{whole(record.remaining)}</Text>
            <Text style={styles.stockFigureLabel}>Available</Text>
          </View>
          <View style={styles.stockDivider} />
          <View>
            <Text style={styles.stockFigure}>{whole(record.reorderLevel)}</Text>
            <Text style={styles.stockFigureLabel}>Reorder level</Text>
          </View>
        </View>
        <StockBar record={record} />
        {record.remaining <= record.reorderLevel ? (
          <Text style={styles.stockBarLabel}>
            {record.remaining === record.reorderLevel
              ? `At reorder level · add ${unitLabel(restockNeed, "unit")} to recover`
              : `${unitLabel(record.reorderLevel - record.remaining, "unit")} below reorder level · add ${unitLabel(restockNeed, "unit")}`}
          </Text>
        ) : null}
      </View>
      <View style={[styles.statusColumn, styles.rowColumnDivider]}>
        <StatusPill label={record.state.label} tone={record.state.tone} />
      </View>
      <View style={[styles.valueColumn, styles.rowColumnDivider]}>
        <Text style={styles.valueText}>
          {formatCurrency(record.inventoryValue)}
        </Text>
      </View>
      <View style={styles.restockColumn}>
        {needsRestock && onReorder ? (
          <View style={styles.restockActionGroup}>
            <Text style={styles.restockNeedText}>
              Add {unitLabel(restockNeed, "unit")}
            </Text>
            <TouchableOpacity
              activeOpacity={0.82}
              onPress={() => onReorder(record)}
              style={styles.restockButton}
            >
              <Text style={styles.restockButtonText}>Restock</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <Text style={styles.noActionText}>No action</Text>
        )}
      </View>
    </View>
  );
}

function ReturnsWorkspace({
  damagedInventory,
  supplierReturns,
  suppliers,
  selectedDamage,
  selectedDamageId,
  selectedSupplierId,
  setSelectedSupplierId,
  returnQuantity,
  setReturnQuantity,
  returnRemarks,
  setReturnRemarks,
  closeReturnForm,
  openReturnForm,
  submitSupplierReturn,
  dispatchDraft,
  setDispatchDraft,
  dispatchReturn,
  downloadReturnPdf,
  isBusy,
  onResendSupplierReturnNotification,
}) {
  const availableDamaged = damagedInventory.filter(
    (item) => Number(item.availableQuantity ?? item.quantity ?? 0) > 0,
  );
  return (
    <View style={styles.returnsLayout}>
      <View style={styles.workspace}>
        <View style={styles.tableHeader}>
          <View>
            <Text style={styles.tableTitle}>Damaged stock queue</Text>
            <Text style={styles.sectionHint}>
              Create a return voucher only for stock that is ready to leave.
            </Text>
          </View>
          <Text style={styles.recordCount}>
            {whole(availableDamaged.length)} open items
          </Text>
        </View>
        {availableDamaged.length === 0 ? (
          <EmptyState
            title="No damaged stock is waiting"
            detail="Damaged items ready for supplier action will appear here."
          />
        ) : (
          availableDamaged.map((item) => (
            <View key={item.id} style={styles.damageCard}>
              <View style={styles.damageMain}>
                <Text style={styles.productName}>
                  {item.productName || "Unnamed product"}
                </Text>
                <Text style={styles.productMeta}>
                  Invoice {item.invoiceNumber || "—"} ·{" "}
                  {item.supplierName || "Supplier not assigned"}
                </Text>
                <Text style={styles.damageReason}>
                  {item.damageType || item.returnReason || "Damaged return"}
                </Text>
              </View>
              <View style={styles.damageAction}>
                <Text style={styles.stockValue}>
                  {whole(item.availableQuantity ?? item.quantity)}
                </Text>
                <Text style={styles.stockMeta}>units available</Text>
                <AppButton
                  disabled={isBusy}
                  label={
                    selectedDamageId === item.id
                      ? "RTV form open"
                      : "Create RTV"
                  }
                  onPress={() => openReturnForm(item)}
                />
              </View>
              {selectedDamageId === item.id && (
                <ReturnForm
                  item={selectedDamage}
                  suppliers={suppliers}
                  selectedSupplierId={selectedSupplierId}
                  setSelectedSupplierId={setSelectedSupplierId}
                  returnQuantity={returnQuantity}
                  setReturnQuantity={setReturnQuantity}
                  returnRemarks={returnRemarks}
                  setReturnRemarks={setReturnRemarks}
                  closeReturnForm={closeReturnForm}
                  submitSupplierReturn={submitSupplierReturn}
                  isBusy={isBusy}
                />
              )}
            </View>
          ))
        )}
      </View>
      <View style={styles.workspace}>
        <View style={styles.tableHeader}>
          <View>
            <Text style={styles.tableTitle}>Supplier return vouchers</Text>
            <Text style={styles.sectionHint}>
              Track the hand-off from voucher creation to dispatch.
            </Text>
          </View>
          <Text style={styles.recordCount}>
            {whole(supplierReturns.length)} vouchers
          </Text>
        </View>
        {supplierReturns.length === 0 ? (
          <EmptyState
            title="No return vouchers yet"
            detail="Create an RTV from the damaged stock queue when a supplier return is needed."
          />
        ) : (
          supplierReturns.map((item) => (
            <View key={item.id} style={styles.rtvCard}>
              <View style={styles.rtvMain}>
                <View style={styles.rtvTop}>
                  <Text style={styles.productName}>
                    {item.rtvNumber || `RTV-${item.id}`}
                  </Text>
                  <StatusPill
                    label={
                      item.shipmentStatus === "shipped"
                        ? "Dispatched"
                        : item.status || "Created"
                    }
                    tone={
                      item.shipmentStatus === "shipped" ? "success" : "warning"
                    }
                  />
                </View>
                <Text style={styles.productMeta}>
                  {item.supplierName || `Supplier #${item.supplierId}`} ·{" "}
                  {item.approvalStatus || "Pending approval"}
                </Text>
                {(item.items || []).map((line) => (
                  <Text key={line.id} style={styles.rtvLine}>
                    {line.productName || `Product #${line.productId}`} ·{" "}
                    {whole(line.quantityRequested)} units
                  </Text>
                ))}
              </View>
              <View style={styles.rtvActions}>
                {item.shipmentStatus !== "shipped" ? (
                  <>
                    <TextInput
                      editable={!isBusy}
                      value={dispatchDraft[item.id]?.carrierName || ""}
                      onChangeText={(value) =>
                        setDispatchDraft((current) => ({
                          ...current,
                          [item.id]: {
                            ...(current[item.id] || {}),
                            carrierName: value,
                          },
                        }))
                      }
                      placeholder="Carrier"
                      style={styles.input}
                    />
                    <TextInput
                      editable={!isBusy}
                      value={dispatchDraft[item.id]?.trackingNumber || ""}
                      onChangeText={(value) =>
                        setDispatchDraft((current) => ({
                          ...current,
                          [item.id]: {
                            ...(current[item.id] || {}),
                            trackingNumber: value,
                          },
                        }))
                      }
                      placeholder="Tracking / LR"
                      style={styles.input}
                    />
                    <AppButton
                      disabled={isBusy}
                      label="Mark dispatched"
                      onPress={() => dispatchReturn(item)}
                    />
                  </>
                ) : onResendSupplierReturnNotification ? (
                  <TouchableOpacity
                    disabled={isBusy}
                    onPress={() =>
                      onResendSupplierReturnNotification(
                        item.id,
                        "dispatched",
                        "email",
                      )
                    }
                    style={styles.textAction}
                  >
                    <Text style={styles.textActionLabel}>
                      Resend dispatch email
                    </Text>
                  </TouchableOpacity>
                ) : null}
                <TouchableOpacity
                  disabled={isBusy}
                  onPress={() => downloadReturnPdf(item)}
                  style={styles.textAction}
                >
                  <Text style={styles.textActionLabel}>Download RTV PDF</Text>
                </TouchableOpacity>
              </View>
            </View>
          ))
        )}
      </View>
    </View>
  );
}

function ReturnForm({
  item,
  suppliers,
  selectedSupplierId,
  setSelectedSupplierId,
  returnQuantity,
  setReturnQuantity,
  returnRemarks,
  setReturnRemarks,
  closeReturnForm,
  submitSupplierReturn,
  isBusy,
}) {
  if (!item) return null;
  const available = Number(item.availableQuantity ?? item.quantity ?? 0);
  const invalid = !Number(returnQuantity) || Number(returnQuantity) > available;
  return (
    <View style={styles.returnForm}>
      <View style={styles.formHeading}>
        <View>
          <Text style={styles.formTitle}>Create supplier return</Text>
          <Text style={styles.sectionHint}>
            {whole(available)} units are eligible for this voucher.
          </Text>
        </View>
        <TouchableOpacity onPress={closeReturnForm}>
          <Text style={styles.closeText}>Close</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.controlLabel}>Supplier</Text>
      <View style={styles.supplierChips}>
        {suppliers.map((supplier) => (
          <TouchableOpacity
            key={supplier.id}
            onPress={() => setSelectedSupplierId(String(supplier.id))}
            style={[
              styles.supplierChip,
              String(supplier.id) === String(selectedSupplierId) &&
                styles.supplierChipActive,
            ]}
          >
            <Text
              style={[
                styles.supplierText,
                String(supplier.id) === String(selectedSupplierId) &&
                  styles.supplierTextActive,
              ]}
            >
              {supplier.name}
            </Text>
          </TouchableOpacity>
        ))}
      </View>
      <View style={styles.formFields}>
        <View style={styles.quantityField}>
          <Text style={styles.controlLabel}>Quantity to return</Text>
          <TextInput
            editable={!isBusy}
            keyboardType="decimal-pad"
            value={returnQuantity}
            onChangeText={setReturnQuantity}
            style={styles.input}
          />
        </View>
        <View style={styles.noteField}>
          <Text style={styles.controlLabel}>Supplier note</Text>
          <TextInput
            editable={!isBusy}
            value={returnRemarks}
            onChangeText={setReturnRemarks}
            placeholder="Reason or dispatch note"
            style={styles.input}
          />
        </View>
      </View>
      {invalid && (
        <Text style={styles.errorText}>
          Enter a quantity between 1 and {whole(available)}.
        </Text>
      )}
      <View style={styles.formFooter}>
        <Text style={styles.sectionHint}>
          Creating an RTV reserves this damaged quantity for supplier dispatch.
        </Text>
        <View style={styles.formButtons}>
          <AppButton
            disabled={isBusy}
            label="Cancel"
            variant="ghost"
            onPress={closeReturnForm}
          />
          <AppButton
            disabled={isBusy || !selectedSupplierId || invalid}
            label="Create RTV"
            onPress={submitSupplierReturn}
          />
        </View>
      </View>
    </View>
  );
}

function EmptyState({ detail, title }) {
  return (
    <View style={styles.emptyState}>
      <Text style={styles.emptyTitle}>{title}</Text>
      <Text style={styles.emptyDetail}>{detail}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { gap: spacing.lg, paddingBottom: spacing.xl },
  summaryGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  metricCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexGrow: 1,
    minHeight: 118,
    padding: spacing.lg,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.05,
    shadowRadius: 14,
  },
  primaryMetricCard: { borderLeftColor: colors.primary, borderLeftWidth: 4 },
  successMetricCard: { borderLeftColor: colors.success, borderLeftWidth: 4 },
  warningMetricCard: { borderLeftColor: colors.warning, borderLeftWidth: 4 },
  dangerMetricCard: { borderLeftColor: colors.danger, borderLeftWidth: 4 },
  metricLabel: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: typography.sizes.label,
    fontWeight: typography.weights.semibold,
  },
  metricValue: {
    color: colors.ink,
    fontFamily: typography.headingFont,
    fontSize: 24,
    fontWeight: typography.weights.bold,
    marginTop: spacing.xs,
  },
  metricDanger: { color: colors.danger },
  metricSuccess: { color: colors.success },
  metricCaption: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: typography.sizes.caption,
    marginTop: "auto",
    paddingTop: spacing.sm,
  },
  navigationRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  tabBar: {
    alignSelf: "flex-start",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    gap: 4,
    padding: 4,
  },
  tab: {
    alignItems: "center",
    borderRadius: 12,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 40,
    paddingHorizontal: spacing.md,
  },
  tabActive: { backgroundColor: colors.primary },
  tabLabel: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
  },
  tabLabelActive: { color: colors.white },
  tabCount: {
    backgroundColor: colors.background,
    borderRadius: 99,
    color: colors.primaryDark,
    fontFamily: typography.baseFont,
    fontSize: 11,
    fontWeight: typography.weights.bold,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  tabCountActive: {
    backgroundColor: "rgba(255,255,255,0.2)",
    color: colors.white,
  },
  syncBadge: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.successSoft,
    borderColor: "#CDEBD8",
    borderRadius: 99,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    minHeight: 36,
    paddingHorizontal: spacing.md,
  },
  syncDot: {
    backgroundColor: colors.success,
    borderRadius: 99,
    height: 8,
    width: 8,
  },
  syncText: {
    color: colors.success,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: typography.weights.bold,
  },
  workspace: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
  },
  valueReportHeader: {
    alignItems: "flex-start",
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "space-between",
    padding: spacing.md,
  },
  valueReportTitleWrap: {
    flexBasis: 280,
    flexGrow: 1,
  },
  valueRangePicker: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    maxWidth: "100%",
    padding: spacing.xs,
  },
  valueReportGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  valueExplanation: {
    alignItems: "center",
    backgroundColor: colors.primarySoft,
    borderColor: "#BFDBFE",
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "space-between",
    padding: spacing.md,
  },
  valueExplanationCopy: { flexBasis: 320, flexGrow: 1 },
  valueExplanationTitle: {
    color: colors.primaryDark,
    fontFamily: typography.headingFont,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.bold,
  },
  valueExplanationText: {
    color: colors.ink,
    fontFamily: typography.baseFont,
    fontSize: typography.sizes.caption,
    lineHeight: 18,
    marginTop: 4,
  },
  valueDirectionPill: {
    borderRadius: 99,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  primaryDirectionPill: { backgroundColor: "#DBEAFE" },
  successDirectionPill: { backgroundColor: colors.successSoft },
  dangerDirectionPill: { backgroundColor: colors.dangerSoft },
  valueDirectionText: { fontFamily: typography.baseFont, fontSize: 12, fontWeight: typography.weights.bold },
  primaryDirectionText: { color: colors.primaryDark },
  successDirectionText: { color: colors.success },
  dangerDirectionText: { color: colors.danger },
  valueReportCard: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexBasis: 210,
    flexGrow: 1,
    minHeight: 118,
    padding: spacing.lg,
  },
  valueReportCaption: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 11,
    lineHeight: 15,
    marginTop: "auto",
    paddingTop: spacing.xs,
  },
  valueReconciliation: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  valueReconciliationLabel: {
    color: colors.primary,
    fontFamily: typography.baseFont,
    fontSize: 10,
    fontWeight: typography.weights.bold,
    letterSpacing: 0.7,
  },
  valueReconciliationText: {
    color: colors.ink,
    flexShrink: 1,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: typography.weights.semibold,
  },
  valueMovementPair: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  valueMovementBlock: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexBasis: 280,
    flexGrow: 1,
    padding: spacing.lg,
  },
  valueMovementLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  valueMovementAdded: {
    color: colors.success,
    fontSize: 22,
    fontWeight: "800",
    marginTop: spacing.xs,
  },
  valueMovementReduced: {
    color: colors.danger,
    fontSize: 22,
    fontWeight: "800",
    marginTop: spacing.xs,
  },
  valueMovementHint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.sm,
  },
  valueReportTable: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: "hidden",
  },
  valueReportRow: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    padding: spacing.md,
  },
  valueReportDateCell: {
    flexBasis: 140,
  },
  valueReportDate: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "800",
  },
  valueReportMeta: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 3,
  },
  valueReportMiddle: {
    flexBasis: 280,
    flexGrow: 1,
  },
  dailyMovementChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  dailyAddedChip: {
    backgroundColor: colors.successSoft,
    borderRadius: 99,
    color: colors.success,
    fontFamily: typography.baseFont,
    fontSize: 11,
    fontWeight: typography.weights.bold,
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  dailyReducedChip: {
    backgroundColor: colors.dangerSoft,
    borderRadius: 99,
    color: colors.danger,
    fontFamily: typography.baseFont,
    fontSize: 11,
    fontWeight: typography.weights.bold,
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  valueReportBalance: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  valueReportChange: {
    flexBasis: 130,
    fontSize: 14,
    fontWeight: "800",
    textAlign: "right",
  },
  primaryText: { color: colors.primary },
  successText: { color: colors.success },
  dangerText: { color: colors.danger },
  toolbar: { gap: spacing.md },
  toolbarWide: {
    alignItems: "flex-end",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  searchWrap: { flex: 1, minWidth: 250 },
  sortWrap: { gap: spacing.xs },
  sortChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  sortChip: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 99,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
  },
  sortChipActive: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  sortChipText: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 11,
    fontWeight: typography.weights.semibold,
  },
  sortChipTextActive: { color: colors.primaryDark },
  controlLabel: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 11,
    fontWeight: typography.weights.bold,
    textTransform: "uppercase",
  },
  filterRow: { gap: spacing.xs },
  filterGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  filterGroup: {
    flexBasis: 260,
    flexGrow: 1,
    gap: spacing.xs,
  },
  tableHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  tableHeaderAction: { alignItems: "flex-end", gap: spacing.xs },
  quickAction: {
    backgroundColor: colors.primarySoft,
    borderRadius: 99,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
  },
  quickActionText: {
    color: colors.primary,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: typography.weights.bold,
  },
  tableTitle: {
    color: colors.ink,
    fontFamily: typography.headingFont,
    fontSize: typography.sizes.sectionTitle,
    fontWeight: typography.weights.bold,
  },
  recordCount: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: typography.sizes.label,
    fontWeight: typography.weights.semibold,
    paddingTop: 3,
  },
  table: {
    borderColor: colors.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    backgroundColor: colors.surface,
    overflow: "hidden",
  },
  columnHeader: {
    backgroundColor: colors.background,
    flexDirection: "row",
    gap: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
  },
  columnText: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 11,
    fontWeight: typography.weights.bold,
    textTransform: "uppercase",
  },
  headerColumnDivider: {
    borderRightColor: colors.border,
    borderRightWidth: 1,
    paddingRight: spacing.lg,
  },
  rowColumnDivider: {
    borderRightColor: "#EEE7DC",
    borderRightWidth: 1,
    paddingRight: spacing.lg,
  },
  productColumn: { flex: 2.25, minWidth: 0 },
  stockColumn: { flex: 1.35, marginRight: spacing.xl, minWidth: 210 },
  stockColumnPadding: {
    paddingLeft: spacing.lg,
    paddingRight: spacing.xl,
  },
  valueHeaderColumn: { flex: 1, paddingLeft: spacing.sm, textAlign: "left" },
  statusHeaderColumn: { flex: 1.05, marginLeft: spacing.md },
  restockHeaderColumn: { flex: 0.8, textAlign: "center" },
  valueColumn: {
    alignItems: "flex-start",
    flex: 1,
    gap: spacing.sm,
    minWidth: 150,
    paddingLeft: spacing.sm,
    paddingVertical: spacing.xs,
  },
  statusColumn: {
    alignItems: "center",
    flex: 1.05,
    gap: spacing.sm,
    justifyContent: "center",
    marginLeft: spacing.md,
    minWidth: 160,
    paddingVertical: spacing.xs,
  },
  restockColumn: {
    alignItems: "center",
    flex: 0.8,
    justifyContent: "center",
    minWidth: 110,
  },
  inventoryRow: {
    alignItems: "center",
    borderTopColor: "#EEE7DC",
    borderTopWidth: 1,
    flexDirection: "row",
    gap: spacing.lg,
    minHeight: 112,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.lg,
  },
  inventoryRowCompact: {
    alignItems: "flex-start",
    gap: spacing.md,
    minHeight: 0,
    flexWrap: "wrap",
  },
  productTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  productName: {
    color: colors.ink,
    fontFamily: typography.baseFont,
    fontSize: 15,
    fontWeight: typography.weights.bold,
  },
  productMeta: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.xs,
  },
  damageInlineNote: {
    color: colors.danger,
    fontFamily: typography.baseFont,
    fontSize: 11,
    fontWeight: typography.weights.bold,
    marginTop: spacing.xs,
  },
  damagePill: {
    alignSelf: "flex-start",
    backgroundColor: colors.dangerSoft,
    borderRadius: 99,
    color: colors.danger,
    fontFamily: typography.baseFont,
    fontSize: 10,
    fontWeight: typography.weights.bold,
    marginTop: spacing.sm,
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    textTransform: "uppercase",
  },
  stockValue: {
    color: colors.ink,
    fontFamily: typography.baseFont,
    fontSize: 14,
    fontWeight: typography.weights.bold,
  },
  stockNumbers: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  stockFigure: {
    color: colors.ink,
    fontFamily: typography.headingFont,
    fontSize: 18,
    fontWeight: typography.weights.bold,
  },
  stockFigureLabel: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 10,
    fontWeight: typography.weights.bold,
    marginTop: 1,
    textTransform: "uppercase",
  },
  stockDivider: {
    backgroundColor: colors.border,
    height: 28,
    width: 1,
  },
  stockMuted: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: typography.weights.regular,
  },
  stockMeta: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 11,
    marginTop: 3,
  },
  stockBarTitle: {
    color: colors.ink,
    fontFamily: typography.baseFont,
    fontSize: 11,
    fontWeight: typography.weights.bold,
    marginTop: spacing.md,
  },
  stockBarLabel: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 11,
    marginTop: 3,
  },
  stockBarTrack: {
    backgroundColor: colors.background,
    borderRadius: 99,
    height: 7,
    marginTop: spacing.sm,
    overflow: "hidden",
    width: "100%",
  },
  stockBarTrackCompact: {
    maxWidth: 220,
  },
  stockBarFill: {
    borderRadius: 99,
    height: "100%",
  },
  stockBarSuccess: { backgroundColor: colors.success },
  stockBarWarning: { backgroundColor: colors.warning },
  stockBarDanger: { backgroundColor: colors.danger },
  valueText: {
    color: colors.ink,
    fontFamily: typography.baseFont,
    fontSize: 14,
    fontWeight: typography.weights.bold,
    textAlign: "left",
  },
  statusSideNote: {
    color: colors.danger,
    fontFamily: typography.baseFont,
    fontSize: 10,
    fontWeight: typography.weights.semibold,
    lineHeight: 14,
  },
  restockNeedInline: {
    backgroundColor: colors.warningSoft,
    borderRadius: 99,
    color: colors.warning,
    fontFamily: typography.baseFont,
    fontSize: 11,
    fontWeight: typography.weights.bold,
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingVertical: 3,
  },
  rowAction: { marginTop: spacing.xs, paddingVertical: 4 },
  rowActionText: {
    color: colors.primary,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: typography.weights.bold,
  },
  restockButton: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderColor: colors.primary,
    borderRadius: 99,
    borderWidth: 1,
    minHeight: 34,
    minWidth: 88,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  restockButtonDisabled: {
    backgroundColor: colors.background,
    borderColor: colors.border,
  },
  restockActionGroup: {
    alignItems: "center",
    gap: spacing.xs,
    width: "100%",
  },
  restockNeedText: {
    color: colors.warning,
    fontFamily: typography.baseFont,
    fontSize: 11,
    fontWeight: typography.weights.bold,
    textAlign: "center",
  },
  restockButtonText: {
    color: colors.white,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: typography.weights.bold,
  },
  restockButtonTextDisabled: {
    color: colors.muted,
  },
  noActionText: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: typography.weights.semibold,
  },
  statusPill: {
    alignSelf: "center",
    borderRadius: 99,
    fontFamily: typography.baseFont,
    fontSize: 10,
    fontWeight: typography.weights.bold,
    minWidth: 92,
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    textAlign: "center",
    textTransform: "uppercase",
  },
  statusSuccess: { backgroundColor: colors.successSoft, color: colors.success },
  statusWarning: { backgroundColor: colors.warningSoft, color: colors.warning },
  statusDanger: { backgroundColor: colors.dangerSoft, color: colors.danger },
  returnsLayout: { gap: spacing.lg },
  sectionHint: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 12,
    lineHeight: 18,
    marginTop: 3,
  },
  damageCard: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    gap: spacing.md,
    paddingTop: spacing.md,
  },
  damageMain: { flex: 1 },
  damageReason: {
    color: colors.danger,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: typography.weights.semibold,
    marginTop: spacing.xs,
  },
  damageAction: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  returnForm: {
    backgroundColor: "#FAFCFB",
    borderColor: colors.primarySoft,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.md,
    marginTop: spacing.sm,
    padding: spacing.md,
  },
  formHeading: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  formTitle: {
    color: colors.ink,
    fontFamily: typography.headingFont,
    fontSize: 16,
    fontWeight: typography.weights.bold,
  },
  closeText: {
    color: colors.primary,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: typography.weights.bold,
  },
  supplierChips: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs },
  supplierChip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 99,
    borderWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 7,
  },
  supplierChipActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  supplierText: {
    color: colors.ink,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: typography.weights.semibold,
  },
  supplierTextActive: { color: colors.white },
  formFields: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  quantityField: { minWidth: 140 },
  noteField: { flex: 1, minWidth: 220 },
  input: {
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: typography.baseFont,
    fontSize: typography.sizes.input,
    minHeight: 42,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  errorText: {
    color: colors.danger,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: typography.weights.semibold,
  },
  formFooter: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "space-between",
    paddingTop: spacing.md,
  },
  formButtons: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  rtvCard: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "space-between",
    paddingTop: spacing.md,
  },
  rtvMain: { flex: 1, minWidth: 220 },
  rtvTop: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  rtvLine: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 12,
    marginTop: spacing.xs,
  },
  rtvActions: { gap: spacing.sm, minWidth: 220 },
  textAction: {
    alignItems: "center",
    backgroundColor: colors.primarySoft,
    borderColor: colors.border,
    borderRadius: 99,
    borderWidth: 1,
    minHeight: 38,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
  },
  textActionLabel: {
    color: colors.primary,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: typography.weights.bold,
  },
  overviewLayout: { gap: spacing.lg },
  commandPanel: {
    alignItems: "stretch",
    backgroundColor: colors.primaryDark,
    borderRadius: radii.md,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.lg,
    justifyContent: "space-between",
    padding: spacing.lg,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.12,
    shadowRadius: 18,
  },
  commandCopy: {
    flex: 1,
    gap: spacing.sm,
    minWidth: 250,
  },
  commandTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  commandEyebrow: {
    color: "#BEE3D4",
    fontFamily: typography.baseFont,
    fontSize: 11,
    fontWeight: typography.weights.bold,
    textTransform: "uppercase",
  },
  commandTitle: {
    color: colors.white,
    fontFamily: typography.headingFont,
    fontSize: 22,
    fontWeight: typography.weights.bold,
  },
  actionTiles: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  actionTile: {
    borderColor: "rgba(255,255,255,0.2)",
    borderRadius: radii.sm,
    borderWidth: 1,
    flexGrow: 1,
    minHeight: 74,
    minWidth: 150,
    padding: spacing.md,
  },
  primaryActionTile: { backgroundColor: "rgba(232,242,237,0.16)" },
  warningActionTile: { backgroundColor: "rgba(255,246,230,0.16)" },
  dangerActionTile: { backgroundColor: "rgba(251,233,230,0.16)" },
  actionTileLabel: {
    color: colors.white,
    fontFamily: typography.baseFont,
    fontSize: 14,
    fontWeight: typography.weights.bold,
  },
  actionTileCaption: {
    color: "#E1F0E9",
    fontFamily: typography.baseFont,
    fontSize: 12,
    marginTop: spacing.xs,
  },
  actionPanel: {
    alignItems: "center",
    backgroundColor: colors.primaryDark,
    borderRadius: radii.lg,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.lg,
    justifyContent: "space-between",
    padding: spacing.lg,
  },
  actionPanelCopy: { flex: 1, minWidth: 230 },
  actionPanelEyebrow: {
    color: "#BEE3D4",
    fontFamily: typography.baseFont,
    fontSize: 11,
    fontWeight: typography.weights.bold,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  actionPanelTitle: {
    color: colors.white,
    fontFamily: typography.headingFont,
    fontSize: 20,
    fontWeight: typography.weights.bold,
    marginTop: 4,
  },
  actionPanelText: {
    color: "#E1F0E9",
    fontFamily: typography.baseFont,
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.xs,
  },
  actionButtons: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  darkAction: {
    alignItems: "center",
    borderColor: "#8FB9AA",
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  darkActionText: {
    color: colors.white,
    fontFamily: typography.baseFont,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
  },
  overviewColumns: { flexDirection: "row", flexWrap: "wrap", gap: spacing.lg },
  overviewPanel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    gap: spacing.md,
    minWidth: 280,
    padding: spacing.lg,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.04,
    shadowRadius: 14,
  },
  overviewPanelHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  overviewCardTitle: {
    color: colors.ink,
    fontFamily: typography.headingFont,
    fontSize: typography.sizes.sectionTitle,
    fontWeight: typography.weights.bold,
  },
  overviewCountPill: {
    borderRadius: 99,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: typography.weights.bold,
    minWidth: 34,
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingVertical: 5,
    textAlign: "center",
  },
  primaryOverviewPill: { backgroundColor: colors.primarySoft, color: colors.primary },
  successOverviewPill: { backgroundColor: colors.successSoft, color: colors.success },
  warningOverviewPill: { backgroundColor: colors.warningSoft, color: colors.warning },
  dangerOverviewPill: { backgroundColor: colors.dangerSoft, color: colors.danger },
  insightGrid: {
    gap: spacing.sm,
  },
  insightCard: {
    alignItems: "center",
    backgroundColor: "#FAFCFB",
    borderColor: "#ECE4DA",
    borderRadius: radii.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
  },
  insightRank: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 99,
    borderWidth: 1,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  insightRankText: {
    color: colors.primaryDark,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: typography.weights.bold,
  },
  insightMain: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 0,
  },
  insightTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  insightMetrics: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  insightMetric: {
    color: colors.ink,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: typography.weights.bold,
  },
  insightMetricMuted: {
    color: colors.muted,
    fontWeight: typography.weights.regular,
  },
  insightValue: {
    color: colors.primaryDark,
    fontFamily: typography.baseFont,
    fontSize: 13,
    fontWeight: typography.weights.bold,
    marginLeft: "auto",
  },
  emptyState: {
    alignItems: "flex-start",
    backgroundColor: colors.background,
    borderRadius: radii.md,
    gap: spacing.xs,
    padding: spacing.lg,
  },
  emptyTitle: {
    color: colors.ink,
    fontFamily: typography.baseFont,
    fontSize: 15,
    fontWeight: typography.weights.bold,
  },
  emptyDetail: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 13,
    lineHeight: 19,
  },
});
