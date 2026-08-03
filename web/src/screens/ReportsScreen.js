import React, { useEffect, useMemo, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { AdvancedFilterPanel } from "../components/AdvancedFilterPanel";
import { FilterBar } from "../components/FilterBar";
import { FilterChips } from "../components/FilterChips";
import { FilterSection } from "../components/FilterSection";
import { FormField } from "../components/FormField";
import { PaginationControls } from "../components/PaginationControls";
import { SearchInput } from "../components/SearchInput";
import { ScreenHeader } from "../components/ScreenHeader";
import { useModal } from "../components/ModalProvider";
import { colors, radii, responsiveCardBasis, spacing } from "../constants/theme";
import { getProductMetrics } from "../utils/erpCalculations";
import { formatCurrency, formatDate, formatNumber, formatPercent } from "../utils/formatters";
import { buildInvoiceHtml } from "./InvoicesScreen";
import { buildWaybillHtml } from "./WaybillsScreen";

const PAGE_SIZE = 10;
const reportingPeriodOptions = ["All Time", "Today", "Last 7 Days", "Last 1 Month", "Last 3 Months", "Last 6 Months", "Last 1 Year"];

function toLocalDateInput(value) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function rangeForReportingPeriod(period) {
  if (period === "All Time") return { endDate: "", startDate: "" };
  const end = new Date();
  end.setHours(0, 0, 0, 0);
  const start = new Date(end);
  if (period === "Last 7 Days") start.setDate(start.getDate() - 6);
  if (period === "Last 1 Month") start.setMonth(start.getMonth() - 1);
  if (period === "Last 3 Months") start.setMonth(start.getMonth() - 3);
  if (period === "Last 6 Months") start.setMonth(start.getMonth() - 6);
  if (period === "Last 1 Year") start.setFullYear(start.getFullYear() - 1);
  return { endDate: toLocalDateInput(end), startDate: toLocalDateInput(start) };
}

export function ReportsScreen({
  businessProfile,
  invoices = [],
  isBusy,
  onDeleteInvoice,
  onDeleteOrder,
  onDeleteWaybill,
  onDownloadSupplierReturnPdf,
  orders = [],
  products = [],
  supplierReturns = [],
  waybills = [],
}) {
  const modal = useModal();
  const { width } = useWindowDimensions();
  const reportCardBasis = responsiveCardBasis(width);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("All");
  const [supplierFilter, setSupplierFilter] = useState("All Suppliers");
  const [minGstRate, setMinGstRate] = useState("");
  const [maxGstRate, setMaxGstRate] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [reportingPeriod, setReportingPeriod] = useState("All Time");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [busyReport, setBusyReport] = useState("");

  const selectReportingPeriod = (period) => {
    const range = rangeForReportingPeriod(period);
    setReportingPeriod(period);
    setStartDate(range.startDate);
    setEndDate(range.endDate);
  };

  const reportingPeriodLabel =
    reportingPeriod === "All Time"
      ? "All available records"
      : reportingPeriod === "Custom"
        ? `${startDate || "Beginning"} to ${endDate || "Today"}`
        : `${reportingPeriod} · ${startDate} to ${endDate}`;

  const orderLookup = useMemo(() => Object.fromEntries(orders.map((order) => [String(order.id), order])), [orders]);

  const reports = useMemo(() => {
    const invoiceReports = invoices.map((invoice) => ({
      id: `invoice-${invoice.id}`,
      rawId: invoice.id,
      type: "Invoice",
      number: invoice.invoiceNumber || `Invoice ${invoice.id}`,
      partyName: invoice.partyName,
      supplierName: orderLookup[String(invoice.orderId)]?.supplierName || "",
      status: invoice.status,
      date: invoice.date,
      gstRates: (orderLookup[String(invoice.orderId)]?.items || []).map((item) => Number(item.gstRate || 0)),
      source: invoice,
    }));
    const orderReports = orders.map((order) => ({
      id: `order-${order.id}`,
      rawId: order.id,
      type: "Order",
      number: order.orderNumber || `Order ${order.id}`,
      partyName: order.partyName,
      supplierName: order.supplierName || (order.type === "purchase" ? order.partyName : ""),
      status: order.status,
      date: order.date,
      gstRates: (order.items || []).map((item) => Number(item.gstRate || 0)),
      source: order,
    }));
    const waybillReports = waybills.map((waybill) => ({
      id: `waybill-${waybill.id}`,
      rawId: waybill.id,
      type: "Waybill",
      number: waybill.waybillNumber || `Waybill ${waybill.id}`,
      partyName: waybill.partyName || waybill.orderPartyName,
      supplierName: "",
      status: waybill.status,
      date: String(waybill.generatedAt || "").slice(0, 10),
      gstRates: [],
      source: waybill,
    }));
    const supplierReturnReports = supplierReturns.map((supplierReturn) => {
      const items = supplierReturn.items || [];
      const itemSummary = items
        .map((item) => `${item.productName || `Product #${item.productId}`} (${item.sku || "no SKU"}) x ${item.quantityShipped ?? item.quantityRequested ?? 0}`)
        .join(", ");
      return {
        id: `supplier-return-${supplierReturn.id}`,
        rawId: supplierReturn.id,
        type: "Supplier Return",
        number: supplierReturn.rtvNumber || `RTV ${supplierReturn.id}`,
        partyName: supplierReturn.supplierName,
        supplierName: supplierReturn.supplierName || "",
        status: supplierReturn.status,
        approvalStatus: supplierReturn.approvalStatus,
        shipmentStatus: supplierReturn.shipmentStatus,
        date: String(supplierReturn.createdAt || "").slice(0, 10),
        gstRates: [],
        itemSummary,
        totalQuantity: items.reduce(
          (total, item) => total + Number(item.quantityShipped ?? item.quantityRequested ?? 0),
          0
        ),
        source: supplierReturn,
      };
    });
    return [...invoiceReports, ...orderReports, ...waybillReports, ...supplierReturnReports]
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
  }, [invoices, orderLookup, orders, supplierReturns, waybills]);

  const supplierOptions = useMemo(
    () => ["All Suppliers", ...Array.from(new Set(reports.map((report) => report.supplierName).filter(Boolean))).sort()],
    [reports]
  );

  const overview = useMemo(() => {
    const inSelectedPeriod = (date) => {
      const normalized = String(date || "").slice(0, 10);
      return (!startDate || normalized >= startDate) && (!endDate || normalized <= endDate);
    };
    const periodInvoices = invoices.filter((invoice) => inSelectedPeriod(invoice.date));
    const periodOrders = orders.filter((order) => inSelectedPeriod(order.date));
    const periodReturns = supplierReturns.filter((item) => inSelectedPeriod(item.createdAt));
    const periodWaybills = waybills.filter((waybill) => inSelectedPeriod(waybill.generatedAt));
    const salesInvoices = periodInvoices.filter((invoice) => {
      const linkedOrder = orderLookup[String(invoice.orderId)];
      const isSale = String(invoice.invoiceType || linkedOrder?.type || "sale").toLowerCase() === "sale";
      return isSale && !invoice.isReverse && !["cancelled", "deleted"].includes(String(invoice.status || "").toLowerCase());
    });
    const outstanding = salesInvoices.reduce((total, invoice) => {
      const amount = getInvoiceGrandTotal(invoice);
      const remaining = invoice.remainingAmount ?? Math.max(0, amount - Number(invoice.paidAmount || 0));
      return total + Number(remaining || 0);
    }, 0);
    const openOrderStatuses = new Set(["received", "delivered", "cancelled", "deleted", "closed"]);
    const terminalReturnStatuses = new Set(["closed", "cancelled", "rejected"]);
    const activeWaybills = periodWaybills.filter((waybill) => String(waybill.status || "active").toLowerCase() === "active");
    const periodReports = reports.filter((report) => inSelectedPeriod(report.date));
    const categoryStats = [
      {
        type: "Invoice",
        label: "Invoices",
        symbol: "INV",
        tone: "primary",
        description: "Sales and purchase billing documents",
        pendingLabel: "payment pending",
        pending: periodInvoices.filter((invoice) => String(invoice.paymentStatus || "Unpaid").toLowerCase() !== "paid").length,
      },
      {
        type: "Order",
        label: "Orders",
        symbol: "ORD",
        tone: "warning",
        description: "Purchase and sales order activity",
        pendingLabel: "open orders",
        pending: periodOrders.filter((order) => !openOrderStatuses.has(String(order.status || "").toLowerCase())).length,
      },
      {
        type: "Supplier Return",
        label: "Supplier returns",
        symbol: "RTV",
        tone: "danger",
        description: "Damaged goods returned to vendors",
        pendingLabel: "awaiting closure",
        pending: periodReturns.filter((item) => !terminalReturnStatuses.has(String(item.status || "").toLowerCase())).length,
      },
      {
        type: "Waybill",
        label: "Waybills",
        symbol: "WB",
        tone: "success",
        description: "Goods movement and transport records",
        pendingLabel: "currently active",
        pending: activeWaybills.length,
      },
    ].map((category) => {
      const rows = periodReports.filter((report) => report.type === category.type);
      return {
        ...category,
        count: rows.length,
        latestDate: rows.reduce((latest, report) => String(report.date || "") > latest ? String(report.date || "") : latest, ""),
      };
    });
    return {
      activeWaybills: activeWaybills.length,
      categoryStats,
      documentCount: periodReports.length,
      openOrders: periodOrders.filter((order) => !openOrderStatuses.has(String(order.status || "").toLowerCase())).length,
      outstanding,
      pendingReturns: periodReturns.filter((item) => !terminalReturnStatuses.has(String(item.status || "").toLowerCase())).length,
      salesTotal: salesInvoices.reduce((total, invoice) => total + getInvoiceGrandTotal(invoice), 0),
    };
  }, [endDate, invoices, orderLookup, orders, reports, startDate, supplierReturns, waybills]);

  const reportPacks = useMemo(() => {
    const inSelectedPeriod = (date) => {
      const normalized = String(date || "").slice(0, 10);
      return (!startDate || normalized >= startDate) && (!endDate || normalized <= endDate);
    };
    const activeInvoice = (invoice) => !["cancelled", "deleted"].includes(String(invoice.status || "").toLowerCase());
    const activeOrder = (order) => !["cancelled", "deleted"].includes(String(order.status || "").toLowerCase());
    const periodInvoices = invoices.filter((invoice) => inSelectedPeriod(invoice.date) && activeInvoice(invoice));
    const periodOrders = orders.filter((order) => inSelectedPeriod(order.date) && activeOrder(order));
    const periodReturns = supplierReturns.filter((supplierReturn) => inSelectedPeriod(supplierReturn.createdAt));
    const periodWaybills = waybills.filter((waybill) => inSelectedPeriod(waybill.generatedAt));
    const productLookup = Object.fromEntries(products.map((product) => [String(product.id), product]));
    const productMetrics = products.map((product) => ({ product, metrics: getProductMetrics(product) }));
    const saleInvoices = periodInvoices.filter((invoice) => {
      const linkedOrder = orderLookup[String(invoice.orderId)];
      return String(invoice.invoiceType || linkedOrder?.type || "sale").toLowerCase() === "sale" && !invoice.isReverse;
    });
    const purchaseInvoices = periodInvoices.filter((invoice) => {
      const linkedOrder = orderLookup[String(invoice.orderId)];
      return String(invoice.invoiceType || linkedOrder?.type || "").toLowerCase() === "purchase" && !invoice.isReverse;
    });
    const reverseInvoices = periodInvoices.filter((invoice) => invoice.isReverse);
    const sumInvoices = (rows, key) => rows.reduce((total, invoice) => total + Number(invoice[key] || 0), 0);
    const salesTotal = saleInvoices.reduce((total, invoice) => total + getInvoiceGrandTotal(invoice), 0);
    const purchaseTotal = purchaseInvoices.reduce((total, invoice) => total + getInvoiceGrandTotal(invoice), 0);
    const paidTotal = saleInvoices.reduce((total, invoice) => total + Number(invoice.paidAmount || 0), 0);
    const balanceTotal = saleInvoices.reduce((total, invoice) => {
      const remaining = invoice.remainingAmount ?? Math.max(0, getInvoiceGrandTotal(invoice) - Number(invoice.paidAmount || 0));
      return total + Number(remaining || 0);
    }, 0);
    const grossTax = sumInvoices(periodInvoices, "cgst") + sumInvoices(periodInvoices, "sgst") + sumInvoices(periodInvoices, "igst");
    const gstBuckets = Array.from(
      periodOrders.reduce((map, order) => {
        (order.items || []).forEach((item) => {
          const rate = Number(item.gstRate || 0);
          const taxable = Number(item.quantity || 0) * Number(item.rate || 0);
          const current = map.get(rate) || { label: `${rate}% GST`, total: 0, value: 0 };
          current.total += (taxable * rate) / 100;
          current.value += taxable;
          map.set(rate, current);
        });
        return map;
      }, new Map()).values()
    ).sort((a, b) => b.total - a.total);
    const today = new Date();
    const receivableAging = [
      { label: "Current", max: 0, value: 0 },
      { label: "1-30 days", min: 1, max: 30, value: 0 },
      { label: "31-60 days", min: 31, max: 60, value: 0 },
      { label: "60+ days", min: 61, value: 0 },
    ];
    saleInvoices.forEach((invoice) => {
      const remaining = Number(invoice.remainingAmount ?? Math.max(0, getInvoiceGrandTotal(invoice) - Number(invoice.paidAmount || 0)));
      if (remaining <= 0) return;
      const dueDate = invoice.dueDate ? new Date(invoice.dueDate) : null;
      const ageDays = dueDate && !Number.isNaN(dueDate.getTime()) ? Math.floor((today - dueDate) / 86400000) : 0;
      const bucket = receivableAging.find((item) =>
        (item.min === undefined || ageDays >= item.min) && (item.max === undefined || ageDays <= item.max)
      );
      if (bucket) bucket.value += remaining;
    });
    const orderTotals = periodOrders.reduce(
      (totals, order) => {
        const value = Number(order.grandTotal || 0);
        if (String(order.type || "").toLowerCase() === "purchase") {
          totals.purchase += value;
        } else {
          totals.sale += value;
        }
        if (!["received", "delivered", "closed"].includes(String(order.status || "").toLowerCase())) {
          totals.open += 1;
        }
        return totals;
      },
      { open: 0, purchase: 0, sale: 0 }
    );
    const returnTotals = periodReturns.reduce(
      (totals, supplierReturn) => {
        const quantities = getReturnQuantityTotals(supplierReturn);
        totals.requested += quantities.requested;
        totals.shipped += quantities.shipped;
        totals.accepted += quantities.accepted;
        totals.rejected += quantities.rejected;
        if (!["closed", "cancelled", "rejected"].includes(String(supplierReturn.status || "").toLowerCase())) {
          totals.open += 1;
        }
        return totals;
      },
      { accepted: 0, open: 0, rejected: 0, requested: 0, shipped: 0 }
    );
    const topParties = topTotals(
      saleInvoices,
      (invoice) => invoice.partyName || "Unknown party",
      (invoice) => getInvoiceGrandTotal(invoice)
    );
    const topSuppliers = topTotals(
      periodOrders.filter((order) => String(order.type || "").toLowerCase() === "purchase"),
      (order) => order.supplierName || order.partyName || "Unknown supplier",
      (order) => Number(order.grandTotal || 0)
    );
    const productMovement = periodOrders
      .filter((order) => String(order.type || "").toLowerCase() === "sale")
      .reduce((map, order) => {
        (order.items || []).forEach((item) => {
          const productId = item.productId ?? item.product_id;
          const product = productLookup[String(productId)] || {};
          const key = String(productId || item.productName || item.product_name || item.sku || "unknown");
          const current = map.get(key) || {
            label: product.name || item.productName || item.product_name || `Product #${productId || "-"}`,
            quantity: 0,
            value: 0,
          };
          current.quantity += Number(item.quantity || 0);
          current.value += Number(item.quantity || 0) * Number(item.rate || 0);
          map.set(key, current);
        });
        return map;
      }, new Map());
    const movementRows = Array.from(productMovement.values()).sort((a, b) => b.quantity - a.quantity || b.value - a.value);
    const lowStockProducts = productMetrics
      .filter(({ product, metrics }) => metrics.remaining <= Number(product.reorderLevel || 0))
      .sort((a, b) => a.metrics.remaining - b.metrics.remaining);
    const outOfStockProducts = productMetrics.filter(({ metrics }) => metrics.remaining <= 0);
    const stockedProducts = productMetrics.filter(({ metrics }) => metrics.remaining > 0);
    const slowMovingProducts = stockedProducts
      .map(({ product, metrics }) => {
        const movement = productMovement.get(String(product.id));
        return {
          label: product.name || product.sku || `Product #${product.id}`,
          movementQuantity: movement?.quantity || 0,
          value: metrics.inventoryValue,
          weight: metrics.inventoryValue,
        };
      })
      .sort((a, b) => a.movementQuantity - b.movementQuantity || b.value - a.value);
    const inventoryByCategory = topTotals(
      productMetrics,
      ({ product }) => product.category || "Uncategorized",
      ({ metrics }) => metrics.inventoryValue
    );
    const inventoryBySupplier = topTotals(
      productMetrics,
      ({ product }) => product.supplier || "Supplier not assigned",
      ({ metrics }) => metrics.inventoryValue
    );
    const inventoryValue = productMetrics.reduce((total, item) => total + item.metrics.inventoryValue, 0);

    return {
      aging: receivableAging,
      documents: {
        activeWaybills: periodWaybills.filter((waybill) => String(waybill.status || "active").toLowerCase() === "active").length,
        reverseInvoices: reverseInvoices.length,
      },
      gst: {
        buckets: gstBuckets.slice(0, 4),
        cgst: sumInvoices(periodInvoices, "cgst"),
        count: periodInvoices.length,
        igst: sumInvoices(periodInvoices, "igst"),
        sgst: sumInvoices(periodInvoices, "sgst"),
        tax: grossTax,
        taxable: sumInvoices(periodInvoices, "taxableValue"),
      },
      orders: orderTotals,
      payments: {
        balance: balanceTotal,
        collectedRate: salesTotal ? (paidTotal / salesTotal) * 100 : 0,
        paid: paidTotal,
      },
      returns: {
        ...returnTotals,
        acceptanceRate: returnTotals.shipped ? (returnTotals.accepted / returnTotals.shipped) * 100 : 0,
        rejectionRate: returnTotals.shipped ? (returnTotals.rejected / returnTotals.shipped) * 100 : 0,
      },
      sales: {
        grossMargin: salesTotal ? ((salesTotal - purchaseTotal) / salesTotal) * 100 : 0,
        purchaseTotal,
        salesTotal,
      },
      products: {
        fastMoving: movementRows.map((row) => ({
          label: row.label,
          value: row.quantity,
          weight: row.quantity,
        })),
        inventoryByCategory,
        inventoryBySupplier,
        inventoryValue,
        lowStock: lowStockProducts.length,
        outOfStock: outOfStockProducts.length,
        slowMoving: slowMovingProducts.map((row) => ({
          label: row.label,
          value: row.movementQuantity ? `${formatNumber(row.movementQuantity)} sold` : "No sales",
          weight: row.weight,
        })),
        totalProducts: products.length,
      },
      topParties,
      topSuppliers,
    };
  }, [endDate, invoices, orderLookup, orders, products, startDate, supplierReturns, waybills]);

  const filteredReports = useMemo(() => {
    const lowerSearch = search.trim().toLowerCase();
    return reports.filter((report) => {
      const matchesType = typeFilter === "All" || report.type === typeFilter;
      const reportGstRates = report.gstRates || [];
      const minGst = minGstRate === "" ? null : Number(minGstRate);
      const maxGst = maxGstRate === "" ? null : Number(maxGstRate);
      const matchesSupplier = supplierFilter === "All Suppliers" || report.supplierName === supplierFilter;
      const matchesGstRange =
        (minGst === null && maxGst === null) ||
        reportGstRates.some((rate) => (minGst === null || rate >= minGst) && (maxGst === null || rate <= maxGst));
      const matchesStart = !startDate || String(report.date || "") >= startDate;
      const matchesEnd = !endDate || String(report.date || "") <= endDate;
      const matchesSearch =
        !lowerSearch ||
        [
          report.number,
          report.partyName,
          report.supplierName,
          report.status,
          report.approvalStatus,
          report.shipmentStatus,
          report.itemSummary,
          report.type,
        ].filter(Boolean).join(" ").toLowerCase().includes(lowerSearch);
      return matchesType && matchesSupplier && matchesGstRange && matchesStart && matchesEnd && matchesSearch;
    });
  }, [endDate, maxGstRate, minGstRate, reports, search, startDate, supplierFilter, typeFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredReports.length / PAGE_SIZE));
  const visibleReports = filteredReports.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);

  useEffect(() => {
    setCurrentPage(1);
  }, [endDate, maxGstRate, minGstRate, search, startDate, supplierFilter, typeFilter]);

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);
  const activeFilterCount = [
    search.trim(),
    startDate,
    endDate,
    typeFilter !== "All",
    supplierFilter !== "All Suppliers",
    minGstRate,
    maxGstRate,
  ].filter(Boolean).length;

  const clearFilters = () => {
    setSearch("");
    setTypeFilter("All");
    setSupplierFilter("All Suppliers");
    setMinGstRate("");
    setMaxGstRate("");
    selectReportingPeriod("All Time");
    setCurrentPage(1);
  };

  const reportHtml = (report) => {
    if (report.type === "Invoice") {
      return buildInvoiceHtml({
        businessProfile,
        invoice: report.source,
        order: orderLookup[String(report.source.orderId)],
      });
    }
    if (report.type === "Order") {
      return buildOrderReportHtml({ order: report.source });
    }
    if (report.type === "Supplier Return") {
      return buildSupplierReturnReportHtml({ supplierReturn: report.source });
    }
    return buildWaybillHtml({
      businessProfile,
      nowTick: Date.now(),
      waybill: report.source,
    });
  };

  const viewReportPdf = async (report) => {
    setBusyReport(`view-${report.id}`);
    try {
      if (report.type === "Supplier Return" && Platform.OS === "web" && onDownloadSupplierReturnPdf) {
        const blob = await onDownloadSupplierReturnPdf(report.rawId);
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${report.number}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
        return;
      }
      const html = reportHtml(report);
      if (Platform.OS === "web") {
        const printWindow = window.open("", "_blank");
        if (!printWindow) {
          await modal.warning("Popup blocked", "Allow popups to view this report as PDF.");
          return;
        }
        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();
        setTimeout(() => {
          printWindow.focus();
          printWindow.print();
        }, 300);
        return;
      }
      const file = await Print.printToFileAsync({ base64: false, html });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri, {
          dialogTitle: report.number,
          mimeType: "application/pdf",
          UTI: "com.adobe.pdf",
        });
        return;
      }
      await modal.success("PDF created", file.uri);
    } catch (error) {
      await modal.error("Report view failed", error?.message || "Please try again.");
    } finally {
      setBusyReport("");
    }
  };

  const deleteReport = async (report) => {
    const runDelete = async () => {
      setBusyReport(`delete-${report.id}`);
      try {
        let deleted = true;
        if (report.type === "Invoice") {
          await onDeleteInvoice?.(report.rawId);
        } else if (report.type === "Order") {
          await onDeleteOrder?.(report.rawId);
        } else if (report.type === "Waybill") {
          await onDeleteWaybill?.(report.rawId);
        } else {
          deleted = false;
        }
        if (deleted) {
          await modal.success(`${report.type} deleted successfully`, report.number);
        }
      } catch (error) {
        await modal.error("Delete failed", error?.message || "Please try again.");
      } finally {
        setBusyReport("");
      }
    };

    const confirmed = await modal.confirm({
      cancelLabel: `Keep ${report.type.toLowerCase()}`,
      confirmLabel: "Delete",
      message: report.number,
      title: `Delete ${report.type}?`,
      tone: "danger",
    });
    if (confirmed) {
      await runDelete();
    }
  };

  const tableSections = ["Invoice", "Order", "Supplier Return", "Waybill"]
    .filter((type) => typeFilter === "All" || typeFilter === type)
    .map((type) => {
      const matchingReports = filteredReports.filter((report) => report.type === type);
      return {
        type,
        total: matchingReports.length,
        rows: typeFilter === "All" ? matchingReports.slice(0, 5) : visibleReports,
      };
    });

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <ScreenHeader
        eyebrow="Documents"
        iconLabel="R"
        iconTone="primary"
        title="Reports"
        subtitle="View invoice, order, waybill, and supplier return reports with PDF documents."
      />

      <View style={styles.periodSelector}>
        <View>
          <Text style={styles.periodSelectorLabel}>Reporting period</Text>
          <Text style={styles.periodSelectorHint}>Every report section and result below uses this date range.</Text>
        </View>
        <FilterChips
          activeValue={reportingPeriod}
          disabled={isBusy || !!busyReport}
          onChange={selectReportingPeriod}
          options={reportingPeriodOptions}
        />
      </View>

      <View style={styles.overviewSection}>
        <View style={styles.sectionHeadingRow}>
          <View>
            <Text style={styles.overviewEyebrow}>Business overview</Text>
            <Text style={styles.overviewTitle}>Reporting snapshot</Text>
          </View>
          <Text style={styles.periodLabel}>{reportingPeriodLabel}</Text>
        </View>
        <View style={styles.kpiGrid}>
          <ReportKpiCard basis={reportCardBasis} caption="Invoices, orders, returns, and waybills in the selected period" label="Reports generated" tone="primary" value={formatNumber(overview.documentCount)} />
          <ReportKpiCard basis={reportCardBasis} caption="Customer invoice balance due" label="Outstanding payments" tone="danger" value={formatCurrency(overview.outstanding)} />
          <ReportKpiCard basis={reportCardBasis} caption="Orders still in progress" label="Open orders" tone="warning" value={formatNumber(overview.openOrders)} />
          <ReportKpiCard basis={reportCardBasis} caption="RTVs not yet closed" label="Pending supplier returns" tone="danger" value={formatNumber(overview.pendingReturns)} />
          <ReportKpiCard basis={reportCardBasis} caption="Transport documents in use" label="Active waybills" tone="success" value={formatNumber(overview.activeWaybills)} />
        </View>
      </View>

      <View style={styles.reportPackSection}>
        <View style={styles.sectionHeadingRow}>
          <View>
            <Text style={styles.overviewEyebrow}>Business reports</Text>
            <Text style={styles.overviewTitle}>Decision-ready summaries</Text>
          </View>
        </View>
        <View style={styles.reportPackGrid}>
          <ReportInsightCard
            basis={reportCardBasis}
            eyebrow="Sales"
            title={formatCurrency(reportPacks.sales.salesTotal)}
            caption="Invoice sales in selected period"
            rows={[
              ["Purchase value", formatCurrency(reportPacks.sales.purchaseTotal)],
              ["Estimated margin", formatPercent(reportPacks.sales.grossMargin)],
              ["Sale orders", formatCurrency(reportPacks.orders.sale)],
            ]}
            tone="primary"
          />
          <ReportInsightCard
            basis={reportCardBasis}
            eyebrow="GST"
            title={formatCurrency(reportPacks.gst.tax)}
            caption="CGST, SGST, and IGST total"
            rows={[
              ["Taxable value", formatCurrency(reportPacks.gst.taxable)],
              ["CGST + SGST", formatCurrency(reportPacks.gst.cgst + reportPacks.gst.sgst)],
              ["IGST", formatCurrency(reportPacks.gst.igst)],
            ]}
            tone="success"
          />
          <ReportInsightCard
            basis={reportCardBasis}
            eyebrow="Collections"
            title={formatCurrency(reportPacks.payments.paid)}
            caption="Payments collected from sale invoices"
            rows={[
              ["Receivable balance", formatCurrency(reportPacks.payments.balance)],
              ["Collection rate", formatPercent(reportPacks.payments.collectedRate)],
              ["Reverse invoices", formatNumber(reportPacks.documents.reverseInvoices)],
            ]}
            tone="warning"
          />
          <ReportInsightCard
            basis={reportCardBasis}
            eyebrow="Supplier returns"
            title={formatNumber(reportPacks.returns.shipped)}
            caption="Units shipped back to suppliers"
            rows={[
              ["Open RTVs", formatNumber(reportPacks.returns.open)],
              ["Accepted", formatPercent(reportPacks.returns.acceptanceRate)],
              ["Rejected", formatPercent(reportPacks.returns.rejectionRate)],
            ]}
            tone="danger"
          />
        </View>
        <View style={styles.analysisGrid}>
          <ReportBreakdown title="Receivables aging" rows={reportPacks.aging.map((row) => ({ label: row.label, value: formatCurrency(row.value), weight: row.value }))} />
          <ReportBreakdown title="GST by item rate" emptyLabel="No taxable order items" rows={reportPacks.gst.buckets.map((row) => ({ label: row.label, value: formatCurrency(row.total), weight: row.total }))} />
          <ReportBreakdown carousel title="Top customers" emptyLabel="No sales invoices" rows={reportPacks.topParties.map((row) => ({ label: row.label, value: formatCurrency(row.value), weight: row.value }))} />
          <ReportBreakdown carousel title="Top suppliers" emptyLabel="No purchase orders" rows={reportPacks.topSuppliers.map((row) => ({ label: row.label, value: formatCurrency(row.value), weight: row.value }))} />
        </View>
      </View>

      <View style={styles.reportPackSection}>
        <View style={styles.sectionHeadingRow}>
          <View>
            <Text style={styles.overviewEyebrow}>Product reports</Text>
            <Text style={styles.overviewTitle}>Stock and movement</Text>
          </View>
        </View>
        <View style={styles.reportPackGrid}>
          <ReportInsightCard
            basis={reportCardBasis}
            eyebrow="Inventory"
            title={formatCurrency(reportPacks.products.inventoryValue)}
            caption="Current stock value at buy price"
            rows={[
              ["Products", formatNumber(reportPacks.products.totalProducts)],
              ["Healthy stock", formatNumber(Math.max(0, reportPacks.products.totalProducts - reportPacks.products.lowStock - reportPacks.products.outOfStock))],
              ["Out of stock", formatNumber(reportPacks.products.outOfStock)],
            ]}
            tone="success"
          />
          <ReportInsightCard
            basis={reportCardBasis}
            eyebrow="Stock alerts"
            title={formatNumber(reportPacks.products.lowStock)}
            caption="Products at or below reorder level"
            rows={[
              ["Healthy stock", formatNumber(Math.max(0, reportPacks.products.totalProducts - reportPacks.products.lowStock))],
              ["Unavailable", formatNumber(reportPacks.products.outOfStock)],
            ]}
            tone="danger"
          />
        </View>
        <View style={styles.analysisGrid}>
          <ReportBreakdown carousel title="Fast-moving products" emptyLabel="No sales movement" rows={reportPacks.products.fastMoving.map((row) => ({ label: row.label, value: `${formatNumber(row.value)} sold`, weight: row.weight }))} />
          <ReportBreakdown carousel title="Slow-moving stock" emptyLabel="No stocked products" rows={reportPacks.products.slowMoving} />
          <ReportBreakdown carousel title="Stock value by category" emptyLabel="No product categories" rows={reportPacks.products.inventoryByCategory.map((row) => ({ label: row.label, value: formatCurrency(row.value), weight: row.value }))} />
          <ReportBreakdown carousel title="Stock value by supplier" emptyLabel="No product suppliers" rows={reportPacks.products.inventoryBySupplier.map((row) => ({ label: row.label, value: formatCurrency(row.value), weight: row.value }))} />
        </View>
      </View>

      <View style={styles.librarySection}>
        <View style={styles.sectionHeadingRow}>
          <View>
            <Text style={styles.overviewEyebrow}>Report library</Text>
            <Text style={styles.overviewTitle}>Choose a report category</Text>
          </View>
          {typeFilter !== "All" && (
            <TouchableOpacity activeOpacity={0.82} onPress={() => setTypeFilter("All")} style={styles.showAllButton}>
              <Text style={styles.showAllText}>Show all reports</Text>
            </TouchableOpacity>
          )}
        </View>
        <View style={styles.categoryGrid}>
          {overview.categoryStats.map((category) => {
            const selected = typeFilter === category.type;
            return (
              <TouchableOpacity
                accessibilityRole="button"
                activeOpacity={0.84}
                disabled={isBusy || !!busyReport}
                key={category.type}
                onPress={() => setTypeFilter(selected ? "All" : category.type)}
                style={[styles.categoryCard, { flexBasis: reportCardBasis }, selected && styles.categoryCardSelected]}
              >
                <View style={styles.categoryCardTop}>
                  <View style={[styles.categorySymbol, styles[`${category.tone}CategorySymbol`]]}>
                    <Text style={[styles.categorySymbolText, styles[`${category.tone}CategoryText`]]}>{category.symbol}</Text>
                  </View>
                  <Text style={[styles.categoryCount, selected && styles.categoryCountSelected]}>{formatNumber(category.count)}</Text>
                </View>
                <Text style={[styles.categoryTitle, selected && styles.categoryTitleSelected]}>{category.label}</Text>
                <Text style={[styles.categoryDescription, selected && styles.categoryDescriptionSelected]}>{category.description}</Text>
                <View style={[styles.categoryFooter, selected && styles.categoryFooterSelected]}>
                  <Text style={[styles.categoryPending, selected && styles.categoryPendingSelected]}>
                    {formatNumber(category.pending)} {category.pendingLabel}
                  </Text>
                  <Text style={[styles.categoryLatest, selected && styles.categoryLatestSelected]}>
                    {category.latestDate ? `Latest ${formatDate(category.latestDate)}` : "No activity"}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      <View style={styles.filterPanel}>
        <SearchInput disabled={isBusy || !!busyReport} placeholder="Search report, supplier, product, SKU, or status" value={search} onChangeText={setSearch} />
        <AdvancedFilterPanel
          activeCount={activeFilterCount}
          clearLabel="Reset"
          isOpen={showAdvancedFilters}
          onClear={clearFilters}
          onToggle={() => setShowAdvancedFilters((value) => !value)}
          title="Advanced Filters"
        >
          <FilterSection title="Supplier" hint="Filter purchase/order reports by supplier name.">
            <FilterChips disabled={isBusy || !!busyReport} activeValue={supplierFilter} onChange={setSupplierFilter} options={supplierOptions} />
          </FilterSection>
          <FilterSection title="GST Rate Range" hint="Show orders or invoices with item GST rate between these values.">
            <View style={styles.twoColumn}>
              <View style={styles.flexItem}>
                <FormField label="Min GST %" value={minGstRate} onChangeText={setMinGstRate} placeholder="0" />
              </View>
              <View style={styles.flexItem}>
                <FormField label="Max GST %" value={maxGstRate} onChangeText={setMaxGstRate} placeholder="18" />
              </View>
            </View>
          </FilterSection>
          <FilterSection title="Date Range" hint="Filter by invoice date or waybill generated date.">
            <View style={styles.twoColumn}>
              <View style={styles.flexItem}>
                <FormField label="From date" value={startDate} onChangeText={(value) => { setReportingPeriod("Custom"); setStartDate(value); }} placeholder="YYYY-MM-DD" />
              </View>
              <View style={styles.flexItem}>
                <FormField label="To date" value={endDate} onChangeText={(value) => { setReportingPeriod("Custom"); setEndDate(value); }} placeholder="YYYY-MM-DD" />
              </View>
            </View>
          </FilterSection>
        </AdvancedFilterPanel>
        <FilterBar count={filteredReports.length} label="reports" onClear={clearFilters} />
      </View>

      <View style={styles.tablesArea}>
        {tableSections.map((section) => (
          <ReportDataTable
            busyReport={busyReport}
            disabled={isBusy || !!busyReport}
            key={section.type}
            onDelete={deleteReport}
            onOpen={viewReportPdf}
            onSelectCategory={() => setTypeFilter(section.type)}
            preview={typeFilter === "All"}
            reports={section.rows}
            total={section.total}
            type={section.type}
          />
        ))}
      </View>

      {typeFilter !== "All" && (
        <View style={styles.pagination}>
          <PaginationControls
            currentPage={Math.min(currentPage, totalPages)}
            label="reports"
            onPageChange={(page) => setCurrentPage(Math.max(1, Math.min(page, totalPages)))}
            pageSize={PAGE_SIZE}
            totalCount={filteredReports.length}
            totalPages={totalPages}
          />
        </View>
      )}
    </ScrollView>
  );
}

function ReportKpiCard({ basis, caption, label, tone, value }) {
  return (
    <View style={[styles.kpiCard, styles[`${tone}KpiCard`], { flexBasis: basis }]}>
      <View style={[styles.kpiAccent, styles[`${tone}KpiIndicator`]]} />
      <View style={styles.kpiCardHeader}>
        <Text style={styles.kpiLabel}>{label}</Text>
        <View style={[styles.kpiIndicatorWrap, styles[`${tone}KpiSoft`]]}>
          <View style={[styles.kpiIndicator, styles[`${tone}KpiIndicator`]]} />
        </View>
      </View>
      <Text adjustsFontSizeToFit minimumFontScale={0.78} numberOfLines={1} style={[styles.kpiValue, styles[`${tone}KpiValue`]]}>{value}</Text>
      <Text style={styles.kpiCaption}>{caption}</Text>
    </View>
  );
}

function ReportInsightCard({ basis, caption, eyebrow, rows, title, tone }) {
  return (
    <View style={[styles.insightCard, styles[`${tone}InsightCard`], { flexBasis: basis }]}>
      <View style={styles.insightHeader}>
        <View style={[styles.insightTag, styles[`${tone}KpiSoft`]]}>
          <Text style={[styles.insightEyebrow, styles[`${tone}InsightText`]]}>{eyebrow}</Text>
        </View>
        <View style={[styles.insightDot, styles[`${tone}KpiIndicator`]]} />
      </View>
      <Text adjustsFontSizeToFit minimumFontScale={0.78} numberOfLines={1} style={styles.insightTitle}>{title}</Text>
      <Text style={styles.insightCaption}>{caption}</Text>
      <View style={styles.insightRows}>
        {rows.map(([label, value]) => (
          <View key={label} style={styles.insightRow}>
            <Text style={styles.insightRowLabel}>{label}</Text>
            <Text adjustsFontSizeToFit minimumFontScale={0.8} numberOfLines={1} style={styles.insightRowValue}>{value}</Text>
          </View>
        ))}
      </View>
    </View>
  );
}

function ReportBreakdown({ carousel = false, emptyLabel = "No records", rows, title }) {
  const [page, setPage] = useState(0);
  const [isHovered, setIsHovered] = useState(false);
  const pageSize = carousel ? 4 : rows.length || 1;
  const totalPages = Math.max(1, Math.ceil(rows.length / pageSize));
  const maxValue = Math.max(1, ...rows.map((row) => Number(row.weight || 0)));
  const hasRows = rows.some((row) => Number(row.weight || 0) > 0);
  const activePage = Math.min(page, totalPages - 1);
  const visibleRows = carousel ? rows.slice(activePage * pageSize, activePage * pageSize + pageSize) : rows;
  const showControls = carousel && totalPages > 1;
  const showHoverControls = Platform.OS === "web" ? isHovered : true;

  useEffect(() => {
    setPage((value) => Math.min(value, totalPages - 1));
  }, [totalPages]);

  const content = hasRows ? visibleRows.map((row, index) => {
    const widthPercent = Math.max(4, Math.min(100, (Number(row.weight || 0) / maxValue) * 100));
    const rank = carousel ? activePage * pageSize + index + 1 : index + 1;
    return (
      <View key={row.label} style={styles.breakdownRow}>
        <View style={styles.breakdownRowTop}>
          {carousel && <Text style={styles.breakdownRank}>{rank}</Text>}
          <Text style={styles.breakdownLabel} numberOfLines={1}>{row.label}</Text>
          <Text style={styles.breakdownValue} numberOfLines={1}>{row.value}</Text>
        </View>
        <View style={styles.breakdownTrack}>
          <View style={[styles.breakdownFill, { width: `${widthPercent}%` }]} />
        </View>
      </View>
    );
  }) : (
    <Text style={styles.breakdownEmpty}>{emptyLabel}</Text>
  );
  return (
    <View
      style={[styles.breakdownCard, carousel && styles.carouselBreakdownCard]}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <View style={styles.breakdownHeader}>
        <Text style={styles.breakdownTitle}>{title}</Text>
        {showControls && (
          <Text style={styles.breakdownMeta}>{activePage + 1} / {totalPages}</Text>
        )}
      </View>
      <View style={styles.breakdownRows}>{content}</View>
      {showControls && (
        <View style={[styles.carouselControls, showHoverControls && styles.carouselControlsVisible, { pointerEvents: showHoverControls ? "auto" : "none" }]}>
          <TouchableOpacity
            activeOpacity={0.82}
            disabled={activePage === 0}
            onPress={() => setPage((value) => Math.max(0, value - 1))}
            style={[styles.carouselButton, activePage === 0 && styles.carouselButtonDisabled]}
          >
            <Text style={[styles.carouselButtonText, activePage === 0 && styles.carouselButtonTextDisabled]}>{"<"}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.82}
            disabled={activePage >= totalPages - 1}
            onPress={() => setPage((value) => Math.min(totalPages - 1, value + 1))}
            style={[styles.carouselButton, activePage >= totalPages - 1 && styles.carouselButtonDisabled]}
          >
            <Text style={[styles.carouselButtonText, activePage >= totalPages - 1 && styles.carouselButtonTextDisabled]}>{">"}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
}

function getInvoiceGrandTotal(invoice = {}) {
  return Number(
    invoice.grandTotal ?? invoice.totalAmount ??
    Number(invoice.taxableValue || 0) + Number(invoice.cgst || 0) + Number(invoice.sgst || 0) +
    Number(invoice.igst || 0) + Number(invoice.cess || 0) + Number(invoice.shipping || 0) + Number(invoice.roundOff || 0)
  );
}

function topTotals(rows, labelFor, valueFor, limit = null) {
  const totals = rows.reduce((map, row) => {
    const label = labelFor(row);
    map.set(label, (map.get(label) || 0) + Number(valueFor(row) || 0));
    return map;
  }, new Map());
  const sorted = Array.from(totals.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
  return limit ? sorted.slice(0, limit) : sorted;
}

function getReturnQuantityTotals(supplierReturn = {}) {
  return (supplierReturn.items || []).reduce(
    (totals, item) => ({
      requested: totals.requested + Number(item.quantityRequested || 0),
      shipped: totals.shipped + Number(item.quantityShipped || 0),
      accepted: totals.accepted + Number(item.quantitySupplierAccepted || 0),
      rejected: totals.rejected + Number(item.quantitySupplierRejected || 0),
    }),
    { requested: 0, shipped: 0, accepted: 0, rejected: 0 }
  );
}

function reportTableDefinition(type) {
  if (type === "Invoice") {
    return {
      title: "Invoice register",
      description: "Billing, collection, and outstanding balance details",
      minWidth: 1120,
      columns: [
        { label: "Invoice", width: 150, render: (report) => <TablePrimary primary={report.number} secondary={report.source.invoiceType || "Invoice"} /> },
        { label: "Customer / party", width: 180, render: (report) => report.partyName || "-" },
        { label: "Invoice date", width: 115, align: "center", render: (report) => formatDate(report.date) },
        { label: "Due date", width: 115, align: "center", render: (report) => formatDate(report.source.dueDate) },
        { label: "Total", width: 125, align: "center", render: (report) => formatCurrency(getInvoiceGrandTotal(report.source)) },
        { label: "Paid", width: 120, align: "center", render: (report) => formatCurrency(Number(report.source.paidAmount || 0)) },
        { label: "Balance", width: 125, align: "center", render: (report) => formatCurrency(Number(report.source.remainingAmount ?? Math.max(0, getInvoiceGrandTotal(report.source) - Number(report.source.paidAmount || 0)))) },
        { label: "Payment", width: 135, align: "center", render: (report) => <TableStatus value={report.source.paymentStatus || report.status} /> },
      ],
    };
  }
  if (type === "Order") {
    return {
      title: "Order register",
      description: "Purchase and sales order workflow details",
      minWidth: 1100,
      columns: [
        { label: "Order", width: 150, render: (report) => <TablePrimary primary={report.number} secondary={readableStatus(report.source.type || "Order")} /> },
        { label: "Party / supplier", width: 190, render: (report) => report.partyName || report.supplierName || "-" },
        { label: "Order date", width: 115, align: "center", render: (report) => formatDate(report.date) },
        { label: "Products", width: 90, align: "center", render: (report) => formatNumber((report.source.items || []).length) },
        { label: "Total", width: 130, align: "center", render: (report) => formatCurrency(Number(report.source.grandTotal || 0)) },
        { label: "Order status", width: 140, align: "center", render: (report) => <TableStatus value={report.status} /> },
        { label: "Payment", width: 140, align: "center", render: (report) => <TableStatus value={report.source.paymentStatus || "Unpaid"} /> },
      ],
    };
  }
  if (type === "Supplier Return") {
    return {
      title: "Supplier return register",
      description: "RTV product movement and supplier acceptance details",
      minWidth: 1280,
      columns: [
        { label: "RTV", width: 145, render: (report) => <TablePrimary primary={report.number} secondary={formatDate(report.date)} /> },
        { label: "Supplier", width: 170, render: (report) => report.supplierName || "-" },
        { label: "Returned products", width: 245, render: (report) => {
          const items = report.source.items || [];
          const first = items[0];
          return <TablePrimary primary={first?.productName || "No products"} secondary={first ? `${first.sku || "No SKU"}${items.length > 1 ? ` · +${items.length - 1} more` : ""}` : "-"} />;
        } },
        { label: "Requested", width: 100, align: "center", render: (report) => formatNumber(getReturnQuantityTotals(report.source).requested) },
        { label: "Shipped", width: 100, align: "center", render: (report) => formatNumber(getReturnQuantityTotals(report.source).shipped) },
        { label: "Accepted", width: 100, align: "center", render: (report) => formatNumber(getReturnQuantityTotals(report.source).accepted) },
        { label: "Rejected", width: 100, align: "center", render: (report) => formatNumber(getReturnQuantityTotals(report.source).rejected) },
        { label: "Approval", width: 135, align: "center", render: (report) => <TableStatus value={report.approvalStatus} /> },
        { label: "Shipment", width: 135, align: "center", render: (report) => <TableStatus value={report.shipmentStatus} /> },
      ],
    };
  }
  return {
    title: "Waybill register",
    description: "Transport, vehicle, route, and document validity details",
    minWidth: 1250,
    columns: [
      { label: "Waybill", width: 145, render: (report) => <TablePrimary primary={report.number} secondary={report.source.transportMode || "Transport"} /> },
      { label: "Invoice / order", width: 160, render: (report) => <TablePrimary primary={report.source.invoiceNumber || report.source.invoiceId || "-"} secondary={report.source.orderNumber || report.source.orderId ? `Order ${report.source.orderNumber || report.source.orderId}` : "No order"} /> },
      { label: "Party", width: 165, render: (report) => report.partyName || "-" },
      { label: "Route", width: 200, render: (report) => `${report.source.fromName || "-"} → ${report.source.toName || "-"}` },
      { label: "Vehicle", width: 130, align: "center", render: (report) => report.source.vehicleNumber || "Not set" },
      { label: "Generated", width: 115, align: "center", render: (report) => formatDate(report.source.generatedAt) },
      { label: "Valid until", width: 115, align: "center", render: (report) => formatDate(report.source.validUntil) },
      { label: "Status", width: 120, align: "center", render: (report) => <TableStatus value={report.status} /> },
    ],
  };
}

function ReportDataTable({ busyReport, disabled, onDelete, onOpen, onSelectCategory, preview, reports, total, type }) {
  const definition = reportTableDefinition(type);
  return (
    <View style={styles.tableSection}>
      <View style={styles.tableSectionHeader}>
        <View style={styles.tableSectionTitleWrap}>
          <Text style={styles.tableSectionTitle}>{definition.title}</Text>
          <Text style={styles.tableSectionDescription}>{definition.description}</Text>
        </View>
        <View style={styles.tableSectionMeta}>
          <Text style={styles.tableRecordCount}>{formatNumber(total)} records</Text>
          {preview && total > 5 && (
            <TouchableOpacity activeOpacity={0.82} onPress={onSelectCategory} style={styles.tableViewAllButton}>
              <Text style={styles.tableViewAllText}>View all</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
      {reports.length ? (
        <View style={styles.tableFrame}>
          <ScrollView horizontal showsHorizontalScrollIndicator contentContainerStyle={styles.tableScroller}>
            <View style={[styles.dataTable, { minWidth: definition.minWidth }]}>
              <View style={styles.tableHeaderRow}>
                {definition.columns.map((column) => (
                  <Text key={column.label} style={[styles.tableHeaderCell, { width: column.width }, column.align === "right" && styles.cellRight, column.align === "center" && styles.cellCenter]}>
                    {column.label}
                  </Text>
                ))}
                <Text style={[styles.tableHeaderCell, styles.actionColumn, styles.cellCenter, styles.lastColumn]}>Actions</Text>
              </View>
              {reports.map((report, index) => (
                <View key={report.id} style={[styles.tableRow, index % 2 === 1 && styles.tableRowAlternate, index === reports.length - 1 && styles.lastTableRow]}>
                  {definition.columns.map((column) => {
                    const content = column.render(report);
                    return (
                      <View key={column.label} style={[styles.tableCell, { width: column.width }, column.align === "right" && styles.cellRight, column.align === "center" && styles.cellCenter]}>
                        {React.isValidElement(content) ? content : <Text style={[styles.tableCellText, column.align === "right" && styles.cellTextRight, column.align === "center" && styles.cellTextCenter]} numberOfLines={2}>{content}</Text>}
                      </View>
                    );
                  })}
                  <View style={[styles.tableCell, styles.actionColumn, styles.tableActions, styles.lastColumn]}>
                    <TouchableOpacity disabled={disabled} activeOpacity={0.82} onPress={() => onOpen(report)} style={styles.tablePrimaryAction}>
                      <Text style={styles.tablePrimaryActionText}>{busyReport === `view-${report.id}` ? "Opening..." : type === "Supplier Return" ? "RTV PDF" : "View PDF"}</Text>
                    </TouchableOpacity>
                    {type !== "Supplier Return" && (
                      <TouchableOpacity disabled={disabled} activeOpacity={0.82} onPress={() => onDelete(report)} style={styles.tableDeleteAction}>
                        <Text style={styles.tableDeleteActionText}>{busyReport === `delete-${report.id}` ? "Deleting..." : "Delete"}</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              ))}
            </View>
          </ScrollView>
        </View>
      ) : (
        <View style={styles.tableEmptyState}>
          <Text style={styles.tableEmptyTitle}>No {definition.title.toLowerCase()} records</Text>
          <Text style={styles.tableEmptyText}>No records match the current search and filters.</Text>
        </View>
      )}
    </View>
  );
}

function TablePrimary({ primary, secondary }) {
  return (
    <View style={styles.tablePrimaryCell}>
      <Text style={styles.tablePrimaryText} numberOfLines={1}>{primary || "-"}</Text>
      <Text style={styles.tableSecondaryText} numberOfLines={1}>{secondary || "-"}</Text>
    </View>
  );
}

function TableStatus({ value }) {
  const normalized = String(value || "pending").toLowerCase();
  const success = ["paid", "approved", "active", "shipped", "received", "delivered", "closed", "supplier_received"].includes(normalized);
  const danger = ["cancelled", "deleted", "expired", "rejected", "failed"].includes(normalized);
  return (
    <View style={[styles.tableStatus, success ? styles.tableStatusSuccess : danger ? styles.tableStatusDanger : styles.tableStatusPending]}>
      <Text style={[styles.tableStatusText, success ? styles.tableStatusSuccessText : danger ? styles.tableStatusDangerText : styles.tableStatusPendingText]} numberOfLines={1}>
        {readableStatus(value)}
      </Text>
    </View>
  );
}

function readableStatus(value) {
  const text = String(value || "Pending").replaceAll("_", " ");
  return text.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function isCompletedStatus(value) {
  return ["approved", "shipped", "supplier_received", "closed", "completed"].includes(String(value || "").toLowerCase());
}

function SupplierReturnReportCard({ busy, busyLabel, onDownload, report }) {
  const supplierReturn = report.source;
  const items = supplierReturn.items || [];
  const quantityTotals = items.reduce(
    (totals, item) => ({
      requested: totals.requested + Number(item.quantityRequested || 0),
      shipped: totals.shipped + Number(item.quantityShipped || 0),
      accepted: totals.accepted + Number(item.quantitySupplierAccepted || 0),
      rejected: totals.rejected + Number(item.quantitySupplierRejected || 0),
    }),
    { requested: 0, shipped: 0, accepted: 0, rejected: 0 }
  );

  return (
    <View style={[styles.card, styles.returnReportCard]}>
      <View style={styles.returnCardHeader}>
        <View style={styles.returnIdentity}>
          <Text style={styles.returnEyebrow}>Return to vendor</Text>
          <Text style={styles.reportNumber}>{report.number}</Text>
          <Text style={styles.returnSupplier}>{report.supplierName || "Supplier not linked"}</Text>
        </View>
        <View style={styles.returnHeaderMeta}>
          <Text style={[styles.badge, styles.returnBadge]}>Supplier Return</Text>
          <Text style={styles.returnDate}>Created {formatDate(report.date)}</Text>
        </View>
      </View>

      <View style={styles.returnStatusGrid}>
        <ReturnStatus label="Workflow" value={report.status} />
        <ReturnStatus label="Approval" value={report.approvalStatus} />
        <ReturnStatus label="Shipment" value={report.shipmentStatus} />
      </View>

      <View style={styles.returnQuantityGrid}>
        <ReturnQuantity label="Requested" value={quantityTotals.requested} />
        <ReturnQuantity label="Shipped" value={quantityTotals.shipped} tone="primary" />
        <ReturnQuantity label="Accepted" value={quantityTotals.accepted} tone="success" />
        <ReturnQuantity label="Rejected" value={quantityTotals.rejected} tone="danger" />
      </View>

      <View style={styles.returnProductsSection}>
        <Text style={styles.returnSectionTitle}>Returned products</Text>
        {items.length ? items.map((item) => (
          <View key={item.id || `${report.id}-${item.productId}`} style={styles.returnProductRow}>
            <View style={styles.returnProductIdentity}>
              <Text style={styles.returnProductName}>{item.productName || `Product #${item.productId}`}</Text>
              <Text style={styles.returnProductMeta}>SKU {item.sku || "-"} · {item.reason || supplierReturn.reason || "No reason"}</Text>
            </View>
            <View style={styles.returnProductQuantities}>
              <Text style={styles.returnProductQty}>Requested {formatNumber(item.quantityRequested || 0)}</Text>
              <Text style={styles.returnProductQty}>Shipped {formatNumber(item.quantityShipped || 0)}</Text>
              <Text style={[styles.returnProductQty, styles.acceptedText]}>Accepted {formatNumber(item.quantitySupplierAccepted || 0)}</Text>
              {!!Number(item.quantitySupplierRejected || 0) && (
                <Text style={[styles.returnProductQty, styles.rejectedText]}>Rejected {formatNumber(item.quantitySupplierRejected)}</Text>
              )}
            </View>
          </View>
        )) : <Text style={styles.emptyText}>No returned products linked.</Text>}
      </View>

      {(supplierReturn.remarks || supplierReturn.reason) ? (
        <View style={styles.returnRemarks}>
          <Text style={styles.returnRemarksLabel}>Reason / remarks</Text>
          <Text style={styles.returnRemarksText}>{supplierReturn.remarks || supplierReturn.reason}</Text>
        </View>
      ) : null}

      <View style={styles.returnFooter}>
        <Text style={styles.returnFooterHint}>The RTV PDF contains the official supplier return document.</Text>
        <TouchableOpacity disabled={busy} activeOpacity={0.85} onPress={onDownload} style={styles.returnDownloadButton}>
          <Text style={styles.returnDownloadText}>{busyLabel ? "Preparing PDF..." : "Download RTV PDF"}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function ReturnStatus({ label, value }) {
  const completed = isCompletedStatus(value);
  return (
    <View style={styles.returnStatusItem}>
      <Text style={styles.returnStatusLabel}>{label}</Text>
      <View style={[styles.returnStatusPill, completed ? styles.returnStatusComplete : styles.returnStatusPending]}>
        <View style={[styles.returnStatusDot, completed ? styles.returnStatusDotComplete : styles.returnStatusDotPending]} />
        <Text style={[styles.returnStatusValue, completed ? styles.returnStatusValueComplete : styles.returnStatusValuePending]}>
          {readableStatus(value)}
        </Text>
      </View>
    </View>
  );
}

function ReturnQuantity({ label, tone, value }) {
  return (
    <View style={styles.returnQuantityItem}>
      <Text style={styles.returnQuantityLabel}>{label}</Text>
      <Text style={[
        styles.returnQuantityValue,
        tone === "primary" && styles.primaryQuantity,
        tone === "success" && styles.successQuantity,
        tone === "danger" && styles.dangerQuantity,
      ]}>{formatNumber(value)}</Text>
    </View>
  );
}

function escapeReportHtml(value) {
  return String(value ?? "-")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function buildSupplierReturnReportHtml({ supplierReturn }) {
  const rows = (supplierReturn.items || []).map((item, index) => `
    <tr>
      <td>${index + 1}</td>
      <td><strong>${escapeReportHtml(item.productName || `Product #${item.productId}`)}</strong><br><small>${escapeReportHtml(item.sku || "No SKU")}</small></td>
      <td>${escapeReportHtml(item.reason || supplierReturn.reason)}</td>
      <td>${escapeReportHtml(item.quantityRequested ?? 0)}</td>
      <td>${escapeReportHtml(item.quantityApproved ?? "-")}</td>
      <td>${escapeReportHtml(item.quantityShipped ?? 0)}</td>
      <td>${escapeReportHtml(item.quantitySupplierAccepted ?? "-")}</td>
      <td>${escapeReportHtml(item.quantitySupplierRejected ?? "-")}</td>
    </tr>`).join("");
  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${escapeReportHtml(supplierReturn.rtvNumber || `RTV ${supplierReturn.id}`)}</title>
        <style>
          body { font-family: Calibri, Arial, sans-serif; color: #22303a; padding: 28px; }
          h1 { margin: 0; font-size: 24px; }
          .subtitle { color: #6f7b86; margin: 5px 0 22px; }
          .meta { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; margin-bottom: 20px; }
          .box { background: #f7f4ee; border: 1px solid #e4dccf; border-radius: 10px; padding: 11px; }
          .label { color: #6f7b86; display: block; font-size: 10px; font-weight: 700; margin-bottom: 4px; text-transform: uppercase; }
          table { border-collapse: collapse; width: 100%; }
          th, td { border: 1px solid #e4dccf; font-size: 11px; padding: 8px; text-align: left; vertical-align: top; }
          th { background: #e8f2ed; color: #32584d; }
          small { color: #6f7b86; }
          .remarks { border: 1px solid #e4dccf; border-radius: 10px; margin-top: 18px; padding: 12px; }
        </style>
      </head>
      <body>
        <h1>Supplier Return Report</h1>
        <div class="subtitle">Return to Vendor (RTV) movement and quantity report</div>
        <div class="meta">
          <div class="box"><span class="label">RTV number</span><strong>${escapeReportHtml(supplierReturn.rtvNumber || supplierReturn.id)}</strong></div>
          <div class="box"><span class="label">Supplier</span><strong>${escapeReportHtml(supplierReturn.supplierName)}</strong></div>
          <div class="box"><span class="label">Created</span><strong>${escapeReportHtml(formatDate(supplierReturn.createdAt))}</strong></div>
          <div class="box"><span class="label">Workflow status</span><strong>${escapeReportHtml(supplierReturn.status)}</strong></div>
          <div class="box"><span class="label">Approval</span><strong>${escapeReportHtml(supplierReturn.approvalStatus)}</strong></div>
          <div class="box"><span class="label">Shipment</span><strong>${escapeReportHtml(supplierReturn.shipmentStatus)}</strong></div>
        </div>
        <table>
          <thead><tr><th>#</th><th>Product</th><th>Reason</th><th>Requested</th><th>Approved</th><th>Shipped</th><th>Accepted</th><th>Rejected</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="8">No returned products</td></tr>'}</tbody>
        </table>
        <div class="remarks"><span class="label">Remarks</span>${escapeReportHtml(supplierReturn.remarks || supplierReturn.reason || "No remarks")}</div>
      </body>
    </html>`;
}

function buildOrderReportHtml({ order }) {
  const rows = (order.items || [])
    .map(
      (item, index) => `
        <tr>
          <td>${index + 1}</td>
          <td>${item.productName || item.productId || "-"}</td>
          <td>${item.sku || "-"}</td>
          <td>${item.quantity || 0} ${item.unitLabel || item.unitType || ""}</td>
          <td>${item.rate || 0}</td>
          <td>${item.gstRate || 0}%</td>
        </tr>`
    )
    .join("");
  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>${order.orderNumber || `Order ${order.id}`}</title>
        <style>
          body { font-family: Calibri, sans-serif; color: #0f172a; padding: 24px; }
          h1 { text-align: center; margin: 0 0 18px; }
          .meta { display: grid; grid-template-columns: repeat(2, 1fr); gap: 8px; margin-bottom: 18px; }
          .box { border: 1px solid #cbd5e1; border-radius: 10px; padding: 10px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #cbd5e1; padding: 8px; font-size: 12px; text-align: left; }
          th { background: #eff6ff; }
          .totals { margin-top: 18px; text-align: right; font-weight: 800; }
        </style>
      </head>
      <body>
        <h1>Order Report</h1>
        <div class="meta">
          <div class="box"><strong>Order No:</strong> ${order.orderNumber || order.id}</div>
          <div class="box"><strong>Date:</strong> ${formatDate(order.date)}</div>
          <div class="box"><strong>Party:</strong> ${order.partyName || "-"}</div>
          <div class="box"><strong>Supplier:</strong> ${order.supplierName || (order.type === "purchase" ? order.partyName : "-")}</div>
          <div class="box"><strong>Status:</strong> ${order.status || "-"}</div>
          <div class="box"><strong>Payment:</strong> ${order.paymentStatus || "-"}</div>
        </div>
        <table>
          <thead><tr><th>#</th><th>Product</th><th>SKU</th><th>Qty</th><th>Rate</th><th>GST</th></tr></thead>
          <tbody>${rows || `<tr><td colspan="6">No items</td></tr>`}</tbody>
        </table>
        <div class="totals">Subtotal: ${order.taxableValue || 0} | GST: ${order.taxValue || 0} | Total: ${order.grandTotal || 0}</div>
      </body>
    </html>`;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingBottom: spacing.xl },
  periodSelector: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  periodSelectorLabel: { color: colors.ink, fontSize: 13, fontWeight: "700" },
  periodSelectorHint: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 2 },
  overviewSection: { gap: spacing.md, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  librarySection: { gap: spacing.md, paddingHorizontal: spacing.md, paddingTop: spacing.lg },
  sectionHeadingRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  overviewEyebrow: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.7,
    textTransform: "uppercase",
  },
  overviewTitle: { color: colors.ink, fontSize: 18, fontWeight: "700", marginTop: 3 },
  periodLabel: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    color: colors.muted,
    fontSize: 11,
    fontWeight: "600",
    overflow: "hidden",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  kpiCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    flexGrow: 0,
    minWidth: 170,
    minHeight: 132,
    overflow: "hidden",
    padding: spacing.md,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.06,
    shadowRadius: 10,
  },
  primaryKpiCard: { borderTopColor: colors.primary },
  dangerKpiCard: { borderTopColor: colors.danger },
  warningKpiCard: { borderTopColor: colors.warning },
  successKpiCard: { borderTopColor: colors.success },
  kpiAccent: { height: 3, left: 0, position: "absolute", right: 0, top: 0 },
  kpiCardHeader: { alignItems: "flex-start", flexDirection: "row", gap: spacing.sm, justifyContent: "space-between", minHeight: 28 },
  kpiLabel: { color: colors.muted, flex: 1, fontSize: 10, fontWeight: "800", letterSpacing: 0.25, lineHeight: 14, textTransform: "uppercase" },
  kpiIndicatorWrap: { alignItems: "center", borderRadius: 999, height: 22, justifyContent: "center", width: 22 },
  kpiIndicator: { borderRadius: 999, height: 7, width: 7 },
  primaryKpiIndicator: { backgroundColor: colors.primary },
  dangerKpiIndicator: { backgroundColor: colors.danger },
  warningKpiIndicator: { backgroundColor: colors.warning },
  successKpiIndicator: { backgroundColor: colors.success },
  primaryKpiSoft: { backgroundColor: colors.primarySoft },
  dangerKpiSoft: { backgroundColor: colors.dangerSoft },
  warningKpiSoft: { backgroundColor: colors.warningSoft },
  successKpiSoft: { backgroundColor: colors.successSoft },
  kpiValue: { color: colors.ink, fontSize: 22, fontWeight: "800", marginTop: spacing.sm },
  primaryKpiValue: { color: colors.primaryDark },
  dangerKpiValue: { color: colors.danger },
  warningKpiValue: { color: colors.warning },
  successKpiValue: { color: colors.success },
  kpiCaption: { color: colors.muted, fontSize: 10, lineHeight: 15, marginTop: spacing.xs, minHeight: 30 },
  reportPackSection: { gap: spacing.md, paddingHorizontal: spacing.md, paddingTop: spacing.lg },
  reportPackGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  insightCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    flexGrow: 0,
    minHeight: 220,
    minWidth: 220,
    padding: spacing.md,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
  },
  primaryInsightCard: { borderLeftColor: colors.primary, borderLeftWidth: 3 },
  successInsightCard: { borderLeftColor: colors.success, borderLeftWidth: 3 },
  warningInsightCard: { borderLeftColor: colors.warning, borderLeftWidth: 3 },
  dangerInsightCard: { borderLeftColor: colors.danger, borderLeftWidth: 3 },
  insightHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  insightEyebrow: {
    fontSize: 10,
    fontWeight: "800",
    letterSpacing: 0.6,
    textTransform: "uppercase",
  },
  insightTag: { borderRadius: 999, paddingHorizontal: spacing.sm, paddingVertical: 5 },
  primaryInsightText: { color: colors.primary },
  successInsightText: { color: colors.success },
  warningInsightText: { color: colors.warning },
  dangerInsightText: { color: colors.danger },
  insightDot: { borderRadius: 999, height: 8, width: 8 },
  insightTitle: { color: colors.ink, fontSize: 24, fontWeight: "800", marginTop: spacing.md },
  insightCaption: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: spacing.xs, minHeight: 34 },
  insightRows: { borderTopColor: colors.border, borderTopWidth: 1, gap: spacing.xs, marginTop: "auto", paddingTop: spacing.sm },
  insightRow: { alignItems: "center", flexDirection: "row", gap: spacing.sm, justifyContent: "space-between", minHeight: 20 },
  insightRowLabel: { color: colors.muted, flex: 1, fontSize: 11, fontWeight: "600" },
  insightRowValue: { color: colors.ink, flexShrink: 1, fontSize: 11, fontWeight: "800", textAlign: "right" },
  analysisGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  breakdownCard: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    flexBasis: 260,
    flexGrow: 1,
    minHeight: 194,
    padding: spacing.md,
  },
  carouselBreakdownCard: {
    overflow: "hidden",
    paddingHorizontal: spacing.lg,
  },
  breakdownHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    marginBottom: spacing.sm,
  },
  breakdownTitle: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  breakdownMeta: { color: colors.muted, flexShrink: 0, fontSize: 10, fontWeight: "700" },
  breakdownRows: { gap: spacing.sm },
  breakdownRow: { gap: spacing.xs },
  breakdownRowTop: { alignItems: "center", flexDirection: "row", gap: spacing.sm, justifyContent: "space-between" },
  breakdownRank: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    color: colors.primaryDark,
    fontSize: 10,
    fontWeight: "800",
    height: 20,
    lineHeight: 18,
    overflow: "hidden",
    textAlign: "center",
    width: 20,
  },
  breakdownLabel: { color: colors.muted, flex: 1, fontSize: 11, fontWeight: "700" },
  breakdownValue: { color: colors.ink, flexShrink: 1, fontSize: 11, fontWeight: "800", textAlign: "right" },
  breakdownTrack: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 8,
    overflow: "hidden",
  },
  breakdownFill: { backgroundColor: colors.primary, borderRadius: 999, height: "100%" },
  breakdownEmpty: { color: colors.muted, fontSize: 11, fontWeight: "600", paddingTop: spacing.md, textAlign: "center" },
  carouselControls: {
    alignItems: "center",
    bottom: 0,
    flexDirection: "row",
    justifyContent: "space-between",
    left: spacing.xs,
    opacity: 0,
    position: "absolute",
    right: spacing.xs,
    top: 0,
  },
  carouselControlsVisible: { opacity: 1 },
  carouselButton: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    height: 30,
    justifyContent: "center",
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    width: 30,
  },
  carouselButtonDisabled: {
    opacity: 0.45,
  },
  carouselButtonText: {
    color: colors.primaryDark,
    fontSize: 16,
    fontWeight: "900",
    lineHeight: 18,
  },
  carouselButtonTextDisabled: {
    color: colors.muted,
  },
  showAllButton: {
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  showAllText: { color: colors.primaryDark, fontSize: 11, fontWeight: "700" },
  categoryGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  categoryCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    flexGrow: 0,
    minWidth: 0,
    minHeight: 184,
    padding: spacing.md,
  },
  categoryCardSelected: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.1,
    shadowRadius: 10,
  },
  categoryCardTop: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  categorySymbol: { alignItems: "center", borderRadius: radii.sm, height: 34, justifyContent: "center", paddingHorizontal: spacing.sm },
  primaryCategorySymbol: { backgroundColor: colors.primarySoft },
  warningCategorySymbol: { backgroundColor: colors.warningSoft },
  dangerCategorySymbol: { backgroundColor: colors.dangerSoft },
  successCategorySymbol: { backgroundColor: colors.successSoft },
  categorySymbolText: { fontSize: 10, fontWeight: "700", letterSpacing: 0.4 },
  primaryCategoryText: { color: colors.primary },
  warningCategoryText: { color: colors.warning },
  dangerCategoryText: { color: colors.danger },
  successCategoryText: { color: colors.success },
  categoryCount: { color: colors.ink, fontSize: 22, fontWeight: "700" },
  categoryCountSelected: { color: colors.primaryDark },
  categoryTitle: { color: colors.ink, fontSize: 14, fontWeight: "700", marginTop: spacing.md, minHeight: 20 },
  categoryTitleSelected: { color: colors.primaryDark },
  categoryDescription: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 3, minHeight: 32 },
  categoryDescriptionSelected: { color: colors.muted },
  categoryFooter: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    justifyContent: "space-between",
    marginTop: "auto",
    paddingTop: spacing.sm,
  },
  categoryFooterSelected: { borderTopColor: "#C9DDD4" },
  categoryPending: { color: colors.primaryDark, fontSize: 10, fontWeight: "700" },
  categoryPendingSelected: { color: colors.primaryDark },
  categoryLatest: { color: colors.muted, fontSize: 10, fontWeight: "500" },
  categoryLatestSelected: { color: colors.muted },
  filterPanel: { gap: spacing.md, padding: spacing.md },
  twoColumn: { flexDirection: "row", gap: spacing.sm },
  flexItem: { flex: 1 },
  tablesArea: { gap: spacing.lg, paddingHorizontal: spacing.md },
  tableSection: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.04,
    shadowRadius: 8,
  },
  tableSectionHeader: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "space-between",
    padding: spacing.md,
  },
  tableSectionTitleWrap: { flexBasis: 260, flexGrow: 1 },
  tableSectionTitle: { color: colors.ink, fontSize: 15, fontWeight: "700" },
  tableSectionDescription: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 3 },
  tableSectionMeta: { alignItems: "center", flexDirection: "row", gap: spacing.sm },
  tableRecordCount: { color: colors.muted, fontSize: 11, fontWeight: "600" },
  tableViewAllButton: {
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  tableViewAllText: { color: colors.primaryDark, fontSize: 11, fontWeight: "700" },
  tableFrame: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    marginBottom: spacing.md,
    marginHorizontal: spacing.md,
    overflow: "hidden",
  },
  tableScroller: { flexGrow: 1 },
  dataTable: { backgroundColor: colors.surface, flex: 1 },
  tableHeaderRow: {
    backgroundColor: colors.primarySoft,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: 42,
  },
  tableHeaderCell: {
    borderRightColor: "#D9E6DF",
    borderRightWidth: 1,
    color: colors.primaryDark,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.35,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
    textTransform: "uppercase",
  },
  tableRow: {
    alignItems: "stretch",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: 64,
  },
  tableRowAlternate: { backgroundColor: "#FBFAF7" },
  lastTableRow: { borderBottomWidth: 0 },
  tableCell: {
    borderRightColor: "#EEE9E0",
    borderRightWidth: 1,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  tableCellText: { color: colors.ink, fontSize: 11, fontWeight: "500", lineHeight: 16 },
  tablePrimaryCell: { justifyContent: "center" },
  tablePrimaryText: { color: colors.ink, fontSize: 11, fontWeight: "700", lineHeight: 16 },
  tableSecondaryText: { color: colors.muted, fontSize: 10, fontWeight: "500", lineHeight: 14, marginTop: 2 },
  cellRight: { alignItems: "flex-end", textAlign: "right" },
  cellCenter: { alignItems: "center", textAlign: "center" },
  cellTextRight: { textAlign: "right" },
  cellTextCenter: { textAlign: "center" },
  actionColumn: { width: 170 },
  lastColumn: { borderRightWidth: 0 },
  tableActions: { alignItems: "center", flexDirection: "row", gap: spacing.xs },
  tablePrimaryAction: {
    backgroundColor: colors.primarySoft,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  tablePrimaryActionText: { color: colors.primaryDark, fontSize: 10, fontWeight: "700" },
  tableDeleteAction: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radii.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  tableDeleteActionText: { color: colors.danger, fontSize: 10, fontWeight: "700" },
  tableStatus: {
    alignSelf: "center",
    borderRadius: 999,
    maxWidth: "100%",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  tableStatusSuccess: { backgroundColor: colors.successSoft },
  tableStatusDanger: { backgroundColor: colors.dangerSoft },
  tableStatusPending: { backgroundColor: colors.warningSoft },
  tableStatusText: { fontSize: 10, fontWeight: "700" },
  tableStatusSuccessText: { color: colors.success },
  tableStatusDangerText: { color: colors.danger },
  tableStatusPendingText: { color: colors.warning },
  tableEmptyState: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: radii.md,
    marginBottom: spacing.md,
    marginHorizontal: spacing.md,
    padding: spacing.xl,
  },
  tableEmptyTitle: { color: colors.ink, fontSize: 13, fontWeight: "600" },
  tableEmptyText: { color: colors.muted, fontSize: 11, marginTop: spacing.xs, textAlign: "center" },
  list: { gap: spacing.md, paddingHorizontal: spacing.md },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.md,
  },
  returnReportCard: {
    borderColor: "#D9E6DF",
    gap: spacing.md,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.05,
    shadowRadius: 10,
  },
  returnCardHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  returnIdentity: { flexGrow: 1 },
  returnEyebrow: {
    color: colors.primary,
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.6,
    marginBottom: spacing.xs,
    textTransform: "uppercase",
  },
  returnSupplier: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "600",
    marginTop: spacing.xs,
  },
  returnHeaderMeta: { alignItems: "flex-end", gap: spacing.xs },
  returnDate: { color: colors.muted, fontSize: 11, fontWeight: "500" },
  returnStatusGrid: {
    backgroundColor: colors.background,
    borderRadius: radii.md,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    padding: spacing.md,
  },
  returnStatusItem: { flexBasis: 160, flexGrow: 1, gap: spacing.xs, minHeight: 54 },
  returnStatusLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "600",
  },
  returnStatusPill: {
    alignItems: "center",
    alignSelf: "flex-start",
    borderRadius: 999,
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  returnStatusComplete: { backgroundColor: colors.successSoft },
  returnStatusPending: { backgroundColor: colors.warningSoft },
  returnStatusDot: { borderRadius: 999, height: 7, width: 7 },
  returnStatusDotComplete: { backgroundColor: colors.success },
  returnStatusDotPending: { backgroundColor: colors.warning },
  returnStatusValue: { fontSize: 11, fontWeight: "700" },
  returnStatusValueComplete: { color: colors.success },
  returnStatusValuePending: { color: colors.warning },
  returnQuantityGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  returnQuantityItem: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexBasis: 125,
    flexGrow: 1,
    minHeight: 62,
    padding: spacing.sm,
  },
  returnQuantityLabel: { color: colors.muted, fontSize: 10, fontWeight: "600" },
  returnQuantityValue: { color: colors.ink, fontSize: 18, fontWeight: "700", marginTop: 3 },
  primaryQuantity: { color: colors.primary },
  successQuantity: { color: colors.success },
  dangerQuantity: { color: colors.danger },
  returnProductsSection: { gap: spacing.sm },
  returnSectionTitle: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "700",
  },
  returnProductRow: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: radii.md,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "space-between",
    padding: spacing.md,
  },
  returnProductIdentity: { flexBasis: 230, flexGrow: 1 },
  returnProductName: { color: colors.ink, fontSize: 13, fontWeight: "700" },
  returnProductMeta: { color: colors.muted, fontSize: 11, marginTop: 4 },
  returnProductQuantities: {
    flexBasis: 280,
    flexDirection: "row",
    flexGrow: 1,
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "flex-end",
  },
  returnProductQty: { color: colors.muted, flexBasis: 96, fontSize: 11, fontWeight: "600", textAlign: "right" },
  acceptedText: { color: colors.success },
  rejectedText: { color: colors.danger },
  returnRemarks: {
    backgroundColor: colors.warningSoft,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  returnRemarksLabel: {
    color: colors.warning,
    fontSize: 10,
    fontWeight: "700",
  },
  returnRemarksText: { color: colors.ink, fontSize: 12, marginTop: 4 },
  returnFooter: {
    alignItems: "center",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "space-between",
    paddingTop: spacing.md,
  },
  returnFooterHint: { color: colors.muted, flexBasis: 240, flexGrow: 1, fontSize: 11 },
  returnDownloadButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  returnDownloadText: { color: colors.white, fontSize: 12, fontWeight: "700" },
  cardHeader: { alignItems: "flex-start", flexDirection: "row", gap: spacing.md, justifyContent: "space-between" },
  titleWrap: { flex: 1 },
  reportNumber: { color: colors.ink, fontSize: 15, fontWeight: "700" },
  party: { color: colors.muted, fontSize: 12, marginTop: spacing.xs },
  badge: { borderRadius: 999, fontSize: 10, fontWeight: "700", overflow: "hidden", paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  invoiceBadge: { backgroundColor: colors.primarySoft, color: colors.primary },
  waybillBadge: { backgroundColor: colors.successSoft, color: colors.success },
  returnBadge: { backgroundColor: colors.warningSoft, color: colors.warning },
  metaRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, marginTop: spacing.md },
  meta: {
    backgroundColor: colors.background,
    borderRadius: 999,
    color: colors.muted,
    fontSize: 11,
    fontWeight: "600",
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  actionRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  viewButton: { backgroundColor: colors.primarySoft, borderRadius: radii.md, flex: 1, padding: spacing.sm },
  deleteButton: { backgroundColor: colors.dangerSoft, borderRadius: radii.md, flex: 1, padding: spacing.sm },
  viewText: { color: colors.primary, fontSize: 12, fontWeight: "700", textAlign: "center" },
  deleteText: { color: colors.danger, fontSize: 12, fontWeight: "700", textAlign: "center" },
  pagination: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  emptyText: { color: colors.muted, fontSize: 13, fontWeight: "600", textAlign: "center" },
});
