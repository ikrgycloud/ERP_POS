import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from "react-native";
import { SvgXml } from "react-native-svg";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { AppButton } from "../components/AppButton";
import { FilterChips } from "../components/FilterChips";
import { FormField } from "../components/FormField";
import { PaginationControls } from "../components/PaginationControls";
import { SearchablePicker } from "../components/SearchablePicker";
import { SearchInput } from "../components/SearchInput";
import { useModal } from "../components/ModalProvider";
import { createRequestKey } from "../services/api";
import { colors, radii, responsiveCardBasis, spacing } from "../constants/theme";
import { formatCurrency, formatDate } from "../utils/formatters";
import { isValidDate } from "../utils/validation";

const today = new Date().toISOString().slice(0, 10);

const PAGE_SIZE = 10;
const packagedTypes = new Set(["packets", "bags", "carton_boxes"]);
const missingInvoiceValues = new Set(["", "-", "--", "n/a", "na", "none", "not provided", "not available"]);

function cleanInvoiceValue(value) {
  if (value === null || value === undefined) return "";
  const text = String(value).trim();
  return missingInvoiceValues.has(text.toLowerCase()) ? "" : text;
}

function hasInvoiceValue(value) {
  return cleanInvoiceValue(value) !== "";
}

function optionalInvoiceLines(values) {
  return values.map(cleanInvoiceValue).filter(Boolean);
}

function joinInvoiceParts(values, separator = ", ") {
  return optionalInvoiceLines(values).join(separator);
}

function formatItemUnit(item) {
  if (!item?.unitType) {
    return `${item?.quantity || 0} units`;
  }
  if (packagedTypes.has(item.unitType)) {
    return `${item.packageCount || 0} ${item.unitLabel || "packs"} x ${item.packageSize || 1} ${item.packageSizeUnit || "units"}`;
  }
  return `${item.quantity || 0} ${item.unitLabel || "units"}`;
}

function getInvoicePartyPhone(invoice, order) {
  const isPurchase = order?.type === "purchase" || String(invoice?.invoiceType || "").toLowerCase() === "purchase";
  if (isPurchase) {
    return invoice?.partyPhone || invoice?.supplierPhone || order?.supplierPhone || order?.supplierMobile || null;
  }
  return invoice?.partyPhone || invoice?.customerPhone || order?.customerPhone || null;
}

function getInvoicePartyEmail(invoice, order) {
  const isPurchase = order?.type === "purchase" || String(invoice?.invoiceType || "").toLowerCase() === "purchase";
  if (isPurchase) {
    return invoice?.partyEmail || invoice?.supplierEmail || order?.supplierEmail || null;
  }
  return invoice?.partyEmail || invoice?.customerEmail || order?.customerEmail || null;
}

function getInvoicePartyIdentity(invoice, order) {
  if (invoice?.partyCategory && invoice?.partyRole) {
    return { category: invoice.partyCategory, role: invoice.partyRole };
  }
  const isPurchase = order?.type === "purchase" || String(invoice?.invoiceType || "").toLowerCase() === "purchase";
  if (isPurchase) {
    return { category: "B2B", role: "Supplier" };
  }
  const rawType = String(invoice?.partyType || order?.partyType || "").trim().toLowerCase();
  if (["customer", "consumer", "b2c_customer", "b2c"].includes(rawType) || order?.customerId) {
    return { category: "B2C", role: "Customer" };
  }
  return { category: "B2B", role: "Business" };
}

export function InvoicesScreen({
  businessProfile,
  currentOutlet,
  isBusy,
  invoices,
  orders,
  onDeleteInvoice,
  onDownloadInvoicePdf,
  onGetInvoiceNotifications,
  onResendInvoiceNotification,
  onCreateInvoicePayment,
  onGetInvoicePayments,
  onGetInvoicePaymentSummary,
  onDownloadPaymentReceipt,
  onReverseInvoicePayment,
  onGenerateInvoice,
  onApproveReverseInvoice,
  onReverseInvoice,
  sessionRole,
}) {
  const modal = useModal();
  const { width } = useWindowDimensions();
  const scrollRef = useRef(null);
  const hasMountedRef = useRef(false);
  const [statusFilter, setStatusFilter] = useState("All Status");
  const [sortMode, setSortMode] = useState("Newest first");
  const [search, setSearch] = useState("");
  const [showGenerateForm, setShowGenerateForm] = useState(false);
  const [selectedOrderId, setSelectedOrderId] = useState("");
  const [dueDate, setDueDate] = useState(today);
  const [invoiceStatus, setInvoiceStatus] = useState("Unpaid");
  const [taxMode, setTaxMode] = useState("CGST + SGST");
  const [previewInvoice, setPreviewInvoice] = useState(null);
  const [paymentInvoice, setPaymentInvoice] = useState(null);
  const [paymentEntries, setPaymentEntries] = useState([]);
  const [paymentAmount, setPaymentAmount] = useState("");
  const [paymentMethod, setPaymentMethod] = useState("UPI");
  const [paymentReference, setPaymentReference] = useState("");
  const [paymentNotes, setPaymentNotes] = useState("");
  const [paymentCollector, setPaymentCollector] = useState("");
  const [paymentError, setPaymentError] = useState("");
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [formError, setFormError] = useState("");
  const [notificationStatus, setNotificationStatus] = useState({});
  const [notificationHistory, setNotificationHistory] = useState([]);
  const [notificationLoading, setNotificationLoading] = useState(false);
  const [notificationAction, setNotificationAction] = useState("");

  useEffect(() => {
    if (!previewInvoice?.id || !onGetInvoiceNotifications) return;
    let active = true;
    setNotificationLoading(true);
    onGetInvoiceNotifications(previewInvoice.id)
      .then((result) => {
        if (!active) return;
        setNotificationStatus(result?.channels || {});
        setNotificationHistory(result?.history || []);
      })
      .catch(() => {
        if (!active) return;
        setNotificationStatus({});
        setNotificationHistory([]);
      })
      .finally(() => active && setNotificationLoading(false));
    return () => { active = false; };
  }, [onGetInvoiceNotifications, previewInvoice?.id]);

  const resendNotification = async (channel) => {
    if (!previewInvoice?.id || !onResendInvoiceNotification) return;
    setNotificationAction(channel);
    try {
      await onResendInvoiceNotification(previewInvoice.id, channel);
      const result = await onGetInvoiceNotifications?.(previewInvoice.id);
      setNotificationStatus(result?.channels || {});
      setNotificationHistory(result?.history || []);
      await modal.success(`${channel.toUpperCase()} queued successfully`, "The notification worker will retry delivery safely.");
    } catch (error) {
      setFormError(error?.message || `Unable to queue ${channel.toUpperCase()}.`);
    } finally {
      setNotificationAction("");
    }
  };

  const orderLookup = useMemo(
    () => Object.fromEntries(orders.map((order) => [String(order.id), order])),
    [orders]
  );

  const orderOptions = useMemo(
    () =>
      orders.map((order) => ({
        hint: `${order.partyName} - ${order.partyType}`,
        label: order.orderNumber || `Order ${order.id}`,
        value: String(order.id),
      })),
    [orders]
  );

  const filteredInvoices = useMemo(() => {
    return invoices.filter((invoice) => {
      const invoiceOrder = orderLookup[String(invoice.orderId)];
      const itemBlob =
        invoiceOrder?.items
          ?.flatMap((item) => [item.productName, item.productSku, item.productId])
          .filter(Boolean)
          .join(" ")
          .toLowerCase() || "";
      const paymentStatus = invoice.paymentStatus || "Unpaid";
      const matchesStatus = statusFilter === "All Status" ||
        (statusFilter === "Overdue"
          ? invoice.dueDate && invoice.dueDate < today && paymentStatus !== "Paid"
          : paymentStatus === statusFilter);
      const matchesSearch = [invoice.invoiceNumber, invoice.orderNumber, invoice.partyName, itemBlob]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase());

      return (
        matchesStatus &&
        matchesSearch
      );
    }).sort((left, right) => {
      if (sortMode === "Highest amount") return getInvoiceTotal(right) - getInvoiceTotal(left);
      if (sortMode === "Balance due") return Number(right.remainingAmount || 0) - Number(left.remainingAmount || 0);
      const leftCreated = Date.parse(left.createdAt || "") || 0;
      const rightCreated = Date.parse(right.createdAt || "") || 0;
      const direction = sortMode === "Oldest first" ? 1 : -1;
      if (leftCreated !== rightCreated) return (leftCreated - rightCreated) * direction;
      return (Number(left.id || 0) - Number(right.id || 0)) * direction;
    });
  }, [invoices, orderLookup, search, sortMode, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredInvoices.length / PAGE_SIZE));

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [search, sortMode, statusFilter]);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    scrollRef.current?.scrollTo({ animated: true, y: 0 });
  }, [currentPage]);

  const visibleInvoices = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    return filteredInvoices.slice(startIndex, startIndex + PAGE_SIZE);
  }, [currentPage, filteredInvoices]);

  const invoiceSummary = useMemo(() => {
    const normalizedStatus = (invoice) => String(invoice.paymentStatus || "Unpaid").trim().toLowerCase();
    const totalValue = invoices.reduce((sum, invoice) => sum + getInvoiceTotal(invoice), 0);
    const averageValue = invoices.length ? totalValue / invoices.length : 0;
    const largestValue = invoices.reduce((largest, invoice) => Math.max(largest, getInvoiceTotal(invoice)), 0);
    const paid = invoices.filter((invoice) => normalizedStatus(invoice) === "paid");
    const partial = invoices.filter((invoice) => normalizedStatus(invoice) === "partially paid");
    const overdue = invoices.filter(
      (invoice) => invoice.dueDate && invoice.dueDate < today && !["paid", "refunded", "cancelled"].includes(normalizedStatus(invoice))
    );
    const pending = invoices.filter(
      (invoice) => !["paid", "refunded", "cancelled", "partially paid"].includes(normalizedStatus(invoice))
    );
    const outstanding = invoices
      .filter((invoice) => !["paid", "refunded", "cancelled"].includes(normalizedStatus(invoice)))
      .reduce((sum, invoice) => sum + Number(invoice.remainingAmount ?? getInvoiceTotal(invoice)), 0);
    const todayCollection = paid
      .filter((invoice) => invoice.date === today)
      .reduce((sum, invoice) => sum + getInvoiceTotal(invoice), 0);
    const share = (count) => (invoices.length ? Math.round((count / invoices.length) * 100) : 0);
    return [
      { icon: "invoice", label: "Total invoices", value: String(invoices.length), meta: `${filteredInvoices.length} in current view`, definition: "Count of every invoice currently loaded. The small line below shows how many match your active search and filters.", tone: "blue", progress: 100 },
      { icon: "paid", label: "Paid", value: String(paid.length), meta: `${share(paid.length)}% of invoices`, definition: "Invoices whose payment status is Paid. Their remaining balance is zero.", tone: "green", progress: share(paid.length) },
      { icon: "pending", label: "Pending", value: String(pending.length), meta: `${share(pending.length)}% need action`, definition: "Invoices with no recorded payment yet. Partially paid invoices are shown separately.", tone: "amber", progress: share(pending.length) },
      { icon: "overdue", label: "Overdue", value: String(overdue.length), meta: `${share(overdue.length)}% past due`, definition: "Unpaid or partly paid invoices with a due date before today. Paid, refunded, and cancelled invoices are excluded.", tone: "red", progress: share(overdue.length) },
      { icon: "partial", label: "Partially paid", value: String(partial.length), meta: `${share(partial.length)}% in progress`, definition: "Invoices where some payment has been recorded but a balance is still due.", tone: "violet", progress: share(partial.length) },
      { icon: "outstanding", label: "Outstanding", value: formatCurrency(outstanding), meta: "Open invoice value", definition: "The total unpaid balance across every unpaid and partially paid invoice. It uses each invoice's remaining amount, not its original total.", tone: "amber", progress: totalValue ? Math.round((outstanding / totalValue) * 100) : 0 },
      { icon: "collection", label: "Invoices paid today", value: formatCurrency(todayCollection), meta: "Paid invoices issued today", definition: "Total value of invoices dated today that are currently marked Paid. This is an invoice-status measure, not a separate payment-date ledger report.", tone: "green", progress: totalValue ? Math.round((todayCollection / totalValue) * 100) : 0 },
      { icon: "revenue", label: "Total invoice value", value: formatCurrency(totalValue), meta: `Average ${formatCurrency(averageValue)}`, definition: "Sum of the grand totals for all loaded invoice records. The average shown below is total invoice value divided by invoice count.", tone: "blue", progress: largestValue ? Math.round((averageValue / largestValue) * 100) : 0 },
    ];
  }, [filteredInvoices.length, invoices]);

  const clearFilters = () => {
    setStatusFilter("All Status");
    setSortMode("Newest first");
    setSearch("");
    setCurrentPage(1);
  };

  const handlePageChange = (page) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  const activeFilterCount = [
    search,
    statusFilter !== "All Status",
    sortMode !== "Newest first",
  ].filter(Boolean).length;

  const generateInvoice = async () => {
    setFormError("");
    if (!selectedOrderId) {
      setFormError("Choose an order to generate invoice");
      return;
    }
    if (!isValidDate(dueDate)) {
      setFormError("Enter a valid due date");
      return;
    }
    try {
      const invoice = await onGenerateInvoice(
        {
          dueDate,
          intraState: taxMode === "CGST + SGST",
          orderId: Number(selectedOrderId),
          status: invoiceStatus,
        },
        createRequestKey("invoice")
      );
      setShowGenerateForm(false);
      setSelectedOrderId("");
      setDueDate(today);
      setInvoiceStatus("Unpaid");
      setTaxMode("CGST + SGST");
      await modal.success(
        "Invoice generated successfully",
        invoice?.invoiceNumber ? `${invoice.invoiceNumber} is ready.` : "The invoice list has been refreshed."
      );
    } catch (error) {
      setFormError(error?.message || "Unable to generate invoice. Please try again.");
      await modal.error("Invoice generation failed", error?.message || "Please try again.");
    }
  };

  const openPaymentDrawer = async (invoice) => {
    setPaymentInvoice(invoice);
    setPaymentLoading(true);
    setPaymentError("");
    setPaymentMethod("UPI");
    setPaymentReference("");
    setPaymentNotes("");
    try {
      const [summary, entries] = await Promise.all([
        onGetInvoicePaymentSummary?.(invoice.id),
        onGetInvoicePayments?.(invoice.id),
      ]);
      const current = summary ? { ...invoice, ...summary } : invoice;
      setPaymentInvoice(current);
      setPaymentEntries(entries || []);
      setPaymentAmount(String(Math.max(0, Number(current.remainingAmount ?? getInvoiceTotal(current)))));
    } catch (error) {
      setPaymentError(error?.message || "Unable to load payment history");
    } finally {
      setPaymentLoading(false);
    }
  };

  const completeInvoicePayment = async () => {
    const amount = Number(paymentAmount);
    const remaining = Number(paymentInvoice?.remainingAmount ?? (getInvoiceTotal(paymentInvoice) - getInvoicePaidAmount(paymentInvoice)));
    if (!Number.isFinite(amount) || amount <= 0) return setPaymentError("Enter an amount greater than zero.");
    if (amount > remaining) return setPaymentError("Payment cannot exceed the remaining balance.");
    setPaymentLoading(true);
    setPaymentError("");
    try {
      const key = `invoice-payment-${paymentInvoice.id}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const result = await onCreateInvoicePayment(paymentInvoice.id, {
        amount,
        paymentMethod,
        transactionReference: paymentReference.trim() || null,
        notes: paymentNotes.trim() || null,
        receivedBy: paymentCollector.trim() || null,
      }, key);
      const entries = await onGetInvoicePayments(paymentInvoice.id);
      setPaymentEntries(entries || []);
      setPaymentInvoice((current) => ({ ...current, ...(result?.summary || {}) }));
      setPaymentAmount(String(Number(result?.summary?.remainingAmount || 0)));
      setPaymentReference("");
      setPaymentNotes("");
      await modal.success("Payment recorded successfully", result?.receiptNumber || "The invoice balance has been updated.");
    } catch (error) {
      setPaymentError(error?.message || "Payment could not be recorded.");
    } finally {
      setPaymentLoading(false);
    }
  };

  const downloadPaymentReceipt = async (entry) => {
    const blob = await onDownloadPaymentReceipt(entry.id);
    if (Platform.OS === "web") {
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${entry.receiptNumber || `Receipt-${entry.id}`}.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    }
  };

  const reversePayment = async (entry) => {
    const confirmed = await modal.confirm({ title: "Reverse payment?", message: `A reversal receipt will be created for ${entry.receiptNumber}.`, confirmLabel: "Reverse", cancelLabel: "Cancel", tone: "danger" });
    if (!confirmed) return;
    await onReverseInvoicePayment(entry.id, `payment-reversal-${entry.id}-${Date.now()}`);
    await openPaymentDrawer(paymentInvoice);
    await modal.success("Payment reversed successfully", entry.receiptNumber || "The payment reversal has been recorded.");
  };

  const createReverseInvoice = async (invoice) => {
    try {
      const reversed = await onReverseInvoice(invoice.id, {
        dueDate: today,
        invoiceId: invoice.id,
        status: "Pending Approval",
      });
      if (reversed) {
        setPreviewInvoice({
          ...reversed,
          invoiceNumber: reversed.invoiceNumber || `${invoice.invoiceNumber || invoice.id}-REV`,
        });
      }
      await modal.success(
        "Reverse invoice created successfully",
        reversed?.invoiceNumber || `${invoice.invoiceNumber || invoice.id}-REV`
      );
    } catch (error) {
      await modal.error("Reverse failed", error?.message || "Please try again.");
    }
  };

  const reverseInvoice = async (invoice) => {
    const confirmed = await modal.confirm({
      cancelLabel: "Cancel",
      confirmLabel: "Reverse",
      message: "This creates a reverse invoice for return or refund.",
      title: "Reverse invoice?",
      tone: "danger",
    });
    if (confirmed) {
      await createReverseInvoice(invoice);
    }
  };

  const confirmDelete = async (invoice) => {
    const confirmed = await modal.confirm({
      cancelLabel: "Keep invoice",
      confirmLabel: "Delete",
      message: invoice.invoiceNumber || String(invoice.id),
      title: "Delete invoice?",
      tone: "danger",
    });
    if (confirmed) {
      try {
        await onDeleteInvoice(invoice.id);
        await modal.success("Invoice deleted successfully", invoice.invoiceNumber || String(invoice.id));
      } catch (error) {
        await modal.error("Delete failed", error?.message || "Please try again.");
      }
    }
  };

  const approveReverseInvoice = async (invoice) => {
    const confirmed = await modal.confirm({
      cancelLabel: "Cancel",
      confirmLabel: "Approve",
      message: `Approve reverse invoice ${invoice.invoiceNumber || invoice.id}? This will refund/return the stock.`,
      title: "Approve reverse?",
      tone: "warning",
    });
    if (confirmed) {
      await onApproveReverseInvoice?.(invoice.id);
      await modal.success("Reverse invoice approved successfully", invoice.invoiceNumber || String(invoice.id));
    }
  };

  const canApproveReverse = (invoice) => {
    if (!invoice.isReverse || invoice.status === "Refunded" || invoice.status === "Approved") {
      return false;
    }
    if (sessionRole === "admin") {
      return invoice.invoiceDirection === "outlet_to_admin";
    }
    if (sessionRole === "outlet") {
      return (
        invoice.invoiceDirection === "customer_to_outlet" &&
        (!currentOutlet?.id || Number(invoice.outletId) === Number(currentOutlet.id))
      );
    }
    return false;
  };

  const createInvoicePdf = async (invoice) => {
    const order = orderLookup[String(invoice.orderId)];
    const html = buildInvoiceHtml({ businessProfile, invoice, order });
    const file = await Print.printToFileAsync({
      base64: false,
      html,
    });
    return file.uri;
  };

  const openPrintableInvoice = (invoice) => {
    const order = orderLookup[String(invoice.orderId)];
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      modal.warning("Popup blocked", "Allow popups and try again to save this invoice as PDF.");
      return;
    }
    printWindow.document.open();
    printWindow.document.write(buildInvoiceHtml({ businessProfile, invoice, order }));
    printWindow.document.close();
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 300);
  };

  const downloadInvoicePdf = async (invoice) => {
    if (Platform.OS === "web") {
      if (onDownloadInvoicePdf) {
        const blob = await onDownloadInvoicePdf(invoice.id);
        const url = window.URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = `${invoice.invoiceNumber || `Invoice-${invoice.id}`}.pdf`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(url);
        return;
      }
      const order = orderLookup[String(invoice.orderId)];
      const html = buildInvoiceHtml({ businessProfile, invoice, order });
      if (window.erpDesktop?.savePdf) {
        const result = await window.erpDesktop.savePdf({
          defaultFileName: invoice.invoiceNumber || `Invoice-${invoice.id}`,
          html,
          showInFolder: true,
          title: "Save invoice PDF",
        });
        if (result?.error) {
          await modal.error("PDF save failed", result.error);
        }
        return;
      }
      openPrintableInvoice(invoice);
      return;
    }
    const uri = await createInvoicePdf(invoice);
    const canShare = await Sharing.isAvailableAsync();
    if (!canShare) {
      await modal.success("PDF created", uri);
      return;
    }
    await Sharing.shareAsync(uri, {
      dialogTitle: invoice.invoiceNumber || "Download invoice PDF",
      mimeType: "application/pdf",
      UTI: "com.adobe.pdf",
    });
  };

  const selectedOrder = orderLookup[String(selectedOrderId)];
  const isCompactLayout = width < 760;
  const metricCardBasis = responsiveCardBasis(width);

  return (
    <View style={styles.invoiceScreenRoot}>
      <ScrollView
        ref={scrollRef}
        style={styles.screen}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.enterprisePage}>
          <View style={[styles.enterpriseHero, isCompactLayout && styles.enterpriseHeroCompact]}>
            <View style={styles.heroCopy}>
              <Text style={styles.breadcrumb}>FINANCE  /  ACCOUNTS RECEIVABLE  /  INVOICES</Text>
              <Text style={styles.heroTitle}>Invoice management</Text>
              <Text style={styles.heroSubtitle}>Create, review and manage GST invoices, payments and reverse workflows.</Text>
            </View>
            <View style={styles.heroActions}>
              <TouchableOpacity
                activeOpacity={0.86}
                disabled={isBusy}
                onPress={clearFilters}
                style={styles.secondaryToolbarButton}
              >
                <Text style={styles.secondaryToolbarButtonText}>Reset view</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.86}
                disabled={isBusy}
                onPress={showGenerateForm ? () => setShowGenerateForm(false) : () => setShowGenerateForm(true)}
                style={styles.primaryToolbarButton}
              >
                <Text style={styles.primaryToolbarButtonIcon}>{showGenerateForm ? "×" : "+"}</Text>
                <Text style={styles.primaryToolbarButtonText}>{showGenerateForm ? "Close form" : "Create invoice"}</Text>
              </TouchableOpacity>
            </View>
          </View>

          <View style={styles.metricRail}>
            {invoiceSummary.map((metric) => (
              <InvoiceMetric key={metric.label} {...metric} basis={metricCardBasis} />
            ))}
          </View>

          {showGenerateForm && (
            <View style={styles.createPanel}>
              <View style={styles.createPanelHeading}>
                <View style={styles.createPanelIcon}><Text style={styles.createPanelIconText}>+</Text></View>
                <View style={styles.createPanelCopy}>
                  <Text style={styles.createPanelTitle}>Create invoice from order</Text>
                  <Text style={styles.createPanelSubtitle}>Select an eligible order and confirm billing terms.</Text>
                </View>
              </View>
              <View style={[styles.createFormGrid, isCompactLayout && styles.createFormGridCompact]}>
                <View style={styles.createOrderField}>
                  <SearchablePicker
                    activeValue={selectedOrderId}
                    disabled={isBusy}
                    emptyText="No orders match your search"
                    label="Order"
                    onChange={setSelectedOrderId}
                    options={orderOptions}
                    placeholder="Search order number or party"
                    searchKeys={["label", "hint"]}
                  />
                </View>
                <View style={styles.createDateField}>
                  <FormField label="Due date" value={dueDate} onChangeText={setDueDate} placeholder="YYYY-MM-DD" />
                </View>
              </View>
              <Text style={styles.helperText}>
                {selectedOrder
                  ? `${selectedOrder.orderNumber} · ${selectedOrder.partyName} · ${formatCurrency(selectedOrder.grandTotal || 0)}`
                  : "Choose an order using search or scroll."}
              </Text>
              <View style={[styles.createOptionsRow, isCompactLayout && styles.createOptionsRowCompact]}>
                <View style={styles.createOptionGroup}>
                  <Text style={styles.optionLabel}>Payment status</Text>
                  <FilterChips disabled={isBusy} activeValue={invoiceStatus} onChange={setInvoiceStatus} options={["Unpaid", "Partially Paid", "Paid"]} />
                </View>
                <View style={styles.createOptionGroup}>
                  <Text style={styles.optionLabel}>Tax structure</Text>
                  <FilterChips disabled={isBusy} activeValue={taxMode} onChange={setTaxMode} options={["CGST + SGST", "IGST"]} />
                </View>
              </View>
              {!!formError && <Text style={styles.formErrorText}>{formError}</Text>}
              <View style={styles.createSubmitRow}>
                <AppButton disabled={isBusy} label="Create Invoice" onPress={generateInvoice} />
              </View>
            </View>
          )}

          <View style={styles.compactInvoiceFilter}>
            <View style={styles.compactFilterHeading}>
              <View>
                <Text style={styles.resultTitle}>Invoice register</Text>
                <Text style={styles.resultSubtitle}>{filteredInvoices.length} of {invoices.length} invoices · Page {currentPage} of {totalPages}</Text>
              </View>
              {activeFilterCount > 0 && (
                <TouchableOpacity activeOpacity={0.82} onPress={clearFilters} style={styles.compactResetButton}>
                  <Text style={styles.compactResetText}>Reset filters</Text>
                </TouchableOpacity>
              )}
            </View>
            <View style={[styles.compactFilterControls, isCompactLayout && styles.compactFilterControlsMobile]}>
              <View style={styles.compactUniversalSearch}>
                <Text style={styles.compactControlLabel}>Search</Text>
                <SearchInput disabled={isBusy} placeholder="Invoice, order, customer, product or SKU" value={search} onChangeText={setSearch} />
              </View>
              <View style={styles.compactStatusPicker}>
                <SearchablePicker
                  activeValue={statusFilter}
                  disabled={isBusy}
                  label="Payment status"
                  onChange={setStatusFilter}
                  overlayDropdown
                  options={[
                    { label: "All payments", value: "All Status", hint: "Every payment status" },
                    { label: "Unpaid", value: "Unpaid", hint: "No payment recorded" },
                    { label: "Partially paid", value: "Partially Paid", hint: "Balance still due" },
                    { label: "Paid", value: "Paid", hint: "Fully settled invoices" },
                    { label: "Overdue", value: "Overdue", hint: "Past the due date" },
                  ]}
                  placeholder="All payments"
                  searchKeys={["label", "hint"]}
                />
              </View>
              <View style={styles.compactSortPicker}>
                <SearchablePicker
                  activeValue={sortMode}
                  disabled={isBusy}
                  label="Sort by"
                  onChange={setSortMode}
                  overlayDropdown
                  options={[
                    { label: "Newest first", value: "Newest first", hint: "Recently created invoices" },
                    { label: "Oldest first", value: "Oldest first", hint: "Earliest invoices first" },
                    { label: "Highest amount", value: "Highest amount", hint: "Largest totals first" },
                    { label: "Balance due", value: "Balance due", hint: "Largest outstanding balance" },
                  ]}
                  placeholder="Newest first"
                  searchKeys={["label", "hint"]}
                />
              </View>
            </View>
          </View>

          {isBusy && invoices.length === 0 ? (
            <View style={styles.skeletonPanel}>{[1, 2, 3, 4].map((item) => <InvoiceSkeleton key={item} />)}</View>
          ) : visibleInvoices.length === 0 ? (
            <View style={styles.emptyState}>
              <View style={styles.emptyDocument}><Text style={styles.emptyDocumentText}>INV</Text></View>
              <Text style={styles.emptyTitle}>No invoices found</Text>
              <Text style={styles.emptySubtitle}>Try adjusting your filters or create an invoice from an eligible order.</Text>
              <View style={styles.emptyActions}>
                <TouchableOpacity onPress={clearFilters} style={styles.secondaryToolbarButton}><Text style={styles.secondaryToolbarButtonText}>Reset filters</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => setShowGenerateForm(true)} style={styles.primaryToolbarButton}><Text style={styles.primaryToolbarButtonText}>Create invoice</Text></TouchableOpacity>
              </View>
            </View>
          ) : isCompactLayout ? (
            <View style={styles.enterpriseCardList}>
              {visibleInvoices.map((invoice) => (
                <EnterpriseInvoiceCard
                  key={invoice.id}
                  canApprove={canApproveReverse(invoice)}
                  disabled={isBusy}
                  invoice={invoice}
                  onApprove={() => approveReverseInvoice(invoice)}
                  onDelete={() => confirmDelete(invoice)}
                  onDownload={() => downloadInvoicePdf(invoice)}
                  onPay={() => openPaymentDrawer(invoice)}
                  onHistory={() => openPaymentDrawer(invoice)}
                  onPreview={() => setPreviewInvoice(invoice)}
                  onReverse={() => reverseInvoice(invoice)}
                  order={orderLookup[String(invoice.orderId)]}
                />
              ))}
            </View>
          ) : (
            <EnterpriseInvoiceTable
              canApproveReverse={canApproveReverse}
              disabled={isBusy}
              invoices={visibleInvoices}
              onApprove={approveReverseInvoice}
              onDelete={confirmDelete}
              onDownload={downloadInvoicePdf}
              onPay={openPaymentDrawer}
              onHistory={openPaymentDrawer}
              onPreview={setPreviewInvoice}
              onReverse={reverseInvoice}
              orderLookup={orderLookup}
            />
          )}

          <View style={styles.enterprisePagination}>
            <PaginationControls
              currentPage={currentPage}
              label="invoices"
              onPageChange={handlePageChange}
              pageSize={PAGE_SIZE}
              totalCount={filteredInvoices.length}
              totalPages={totalPages}
            />
          </View>
        </View>
      </ScrollView>
      {!!previewInvoice && (
        <View style={styles.previewDrawerOverlay}>
          <TouchableOpacity
            accessibilityLabel="Close invoice preview"
            activeOpacity={1}
            onPress={() => setPreviewInvoice(null)}
            style={styles.previewDrawerBackdrop}
          />
          <View style={[styles.previewDrawer, isCompactLayout && styles.previewDrawerCompact]}>
            <ScrollView contentContainerStyle={styles.previewDrawerContent} showsVerticalScrollIndicator={false}>
              <InvoicePreview
                businessProfile={businessProfile}
                compact={isCompactLayout}
                invoice={previewInvoice}
                order={orderLookup[String(previewInvoice.orderId)]}
                onClose={() => setPreviewInvoice(null)}
                onDownload={() => downloadInvoicePdf(previewInvoice)}
                notificationLoading={notificationLoading}
                notificationHistory={notificationHistory}
                notificationStatus={notificationStatus}
                onResendNotification={resendNotification}
                notificationAction={notificationAction}
                paymentMode={false}
              />
            </ScrollView>
          </View>
        </View>
      )}
      {!!paymentInvoice && (
        <View style={styles.paymentModalOverlay}>
          <TouchableOpacity accessibilityLabel="Close payment overlay" activeOpacity={1} onPress={() => setPaymentInvoice(null)} style={styles.previewDrawerBackdrop} />
          <View style={[styles.paymentModal, isCompactLayout && styles.paymentModalCompact]}>
            <View style={styles.paymentModalTopbar}>
              <View>
                <Text style={styles.paymentModalEyebrow}>ACCOUNTS RECEIVABLE</Text>
                <Text style={styles.paymentModalTitle}>Invoice payment</Text>
              </View>
              <TouchableOpacity accessibilityLabel="Close payment overlay" activeOpacity={0.8} onPress={() => setPaymentInvoice(null)} style={styles.paymentModalClose}>
                <Text style={styles.paymentModalCloseText}>×</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.paymentModalContent} showsVerticalScrollIndicator={false}>
              <PaymentLifecyclePanel
                amount={paymentAmount}
                collector={paymentCollector}
                disabled={paymentLoading || isBusy}
                entries={paymentEntries}
                error={paymentError}
                invoice={paymentInvoice}
                loading={paymentLoading}
                method={paymentMethod}
                notes={paymentNotes}
                onAmountChange={setPaymentAmount}
                onCollectorChange={setPaymentCollector}
                onDownloadReceipt={downloadPaymentReceipt}
                onMethodChange={setPaymentMethod}
                onNotesChange={setPaymentNotes}
                onReferenceChange={setPaymentReference}
                onReverse={reversePayment}
                onSubmit={completeInvoicePayment}
                reference={paymentReference}
              />
            </ScrollView>
          </View>
        </View>
      )}
    </View>
  );
}

function PaymentLifecyclePanel({ amount, collector, disabled, entries, error, invoice, loading, method, notes, onAmountChange, onCollectorChange, onDownloadReceipt, onMethodChange, onNotesChange, onReferenceChange, onReverse, onSubmit, reference }) {
  const total = getInvoiceTotal(invoice);
  const paid = getInvoicePaidAmount(invoice);
  const remaining = Number(invoice.remainingAmount ?? Math.max(0, total - paid));
  const percent = paymentProgress(invoice);
  return (
    <View style={styles.paymentLifecycleCard}>
      <View style={styles.paymentLifecycleHeader}>
        <View><Text style={styles.paymentReviewEyebrow}>PAYMENT LEDGER</Text><Text style={styles.paymentReviewTitle}>Receive payment</Text><Text style={styles.paymentReviewSubtitle}>{invoice.invoiceNumber} · {invoice.partyName}</Text></View>
        <InvoiceStatusBadge invoice={{ ...invoice, status: invoice.paymentStatus || "Unpaid" }} />
      </View>
      {loading && <View style={styles.paymentLoadingBanner}><Text style={styles.paymentLoadingText}>Refreshing invoice balance and payment ledger…</Text></View>}
      <View style={styles.paymentReviewAmounts}>
        <View style={styles.paymentReviewMetric}><Text style={styles.paymentReviewLabel}>Grand total</Text><Text style={styles.paymentReviewValue}>{formatCurrency(total)}</Text></View>
        <View style={styles.paymentReviewMetric}><Text style={styles.paymentReviewLabel}>Paid amount</Text><Text style={styles.paymentReviewPaid}>{formatCurrency(paid)}</Text></View>
        <View style={styles.paymentReviewMetric}><Text style={styles.paymentReviewLabel}>Remaining</Text><Text style={styles.paymentReviewDue}>{formatCurrency(remaining)}</Text></View>
        <View style={styles.paymentReviewMetric}><Text style={styles.paymentReviewLabel}>Payment</Text><Text style={styles.paymentReviewValue}>{percent}%</Text></View>
      </View>
      {remaining > 0 && (
        <View style={styles.paymentFormGrid}>
          <FormField disabled={disabled} keyboardType="decimal-pad" label="Payment amount" value={amount} onChangeText={onAmountChange} />
          <View style={styles.paymentMethodField}><Text style={styles.paymentFieldLabel}>Payment method</Text><FilterChips disabled={disabled} options={["Cash", "UPI", "Card", "Bank Transfer", "Wallet"]} activeValue={method} onChange={onMethodChange} /></View>
          <FormField disabled={disabled} label="Reference number" value={reference} onChangeText={onReferenceChange} placeholder="Optional transaction reference" />
          <FormField disabled={disabled} label="Collected by" value={collector} onChangeText={onCollectorChange} placeholder="Employee or cashier name" />
          <View style={styles.paymentNotesField}><FormField disabled={disabled} label="Notes" multiline value={notes} onChangeText={onNotesChange} placeholder="Optional payment notes" /></View>
          {!!error && <Text style={styles.formErrorText}>{error}</Text>}
          <TouchableOpacity disabled={disabled} onPress={onSubmit} style={[styles.paymentReviewButton, disabled && styles.invoiceActionDisabled]}><Text style={styles.paymentReviewButtonText}>Receive {formatCurrency(Number(amount) || 0)}</Text></TouchableOpacity>
        </View>
      )}
      <View style={styles.paymentHistorySection}>
        <Text style={styles.paymentHistoryTitle}>Payment history</Text>
        {!entries.length && <Text style={styles.paymentHistoryEmpty}>No payment transactions recorded yet.</Text>}
        {entries.map((entry) => (
          <View key={entry.id} style={styles.paymentTimelineRow}>
            <View style={styles.paymentTimelineDot} />
            <View style={styles.paymentTimelineCopy}><Text style={styles.paymentReceiptNumber}>{entry.receiptNumber}</Text><Text style={styles.paymentTimelineMeta}>{formatDate(entry.paidAt)} · {String(entry.paymentMethod || "").replaceAll("_", " ")} · {entry.transactionReference || "No reference"}</Text><Text style={styles.paymentTimelineMeta}>{entry.receivedBy || "ERP User"} · {entry.status}</Text></View>
            <Text style={styles.paymentTimelineAmount}>{["reversal", "refund", "debit_adjustment"].includes(entry.transactionType) ? "−" : ""}{formatCurrency(entry.amount)}</Text>
            <View style={styles.paymentTimelineActions}><InvoiceAction label="Receipt" onPress={() => onDownloadReceipt(entry)} symbol="↓" /><InvoiceAction danger disabled={disabled || entry.status !== "successful" || !["payment", "credit_adjustment"].includes(entry.transactionType)} label="Reverse" onPress={() => onReverse(entry)} symbol="↩" /></View>
          </View>
        ))}
      </View>
    </View>
  );
}

const metricTones = {
  blue: { accent: "#2563EB", soft: "#EFF6FF" },
  green: { accent: "#16A34A", soft: "#F0FDF4" },
  amber: { accent: "#D97706", soft: "#FFFBEB" },
  red: { accent: "#DC2626", soft: "#FEF2F2" },
  violet: { accent: "#7C3AED", soft: "#F5F3FF" },
  slate: { accent: "#334155", soft: "#F8FAFC" },
};

const metricIconPaths = {
  invoice: '<path d="M7 3.75h7.25L18 7.5v12.75H7z"/><path d="M14 3.75V8h4M9.75 12h5.5M9.75 15.5h5.5"/>',
  paid: '<circle cx="12" cy="12" r="8.25"/><path d="m8.5 12.25 2.25 2.25 4.75-5"/>',
  pending: '<circle cx="12" cy="12" r="8.25"/><path d="M12 7.75v4.75l3 1.75"/>',
  overdue: '<path d="M12 3.75 21 19.5H3z"/><path d="M12 9v4.5M12 16.5v.1"/>',
  partial: '<circle cx="12" cy="12" r="8.25"/><path d="M12 3.75V12l5.8 5.8"/>',
  outstanding: '<path d="M4 7.5h16v11H4zM6 5h12v2.5"/><path d="M15.5 12.75h2"/>',
  collection: '<path d="M5 6.5h14v13H5zM8 3.75v5.5M16 3.75v5.5M5 10h14"/><path d="m9 14 2 2 4-4"/>',
  revenue: '<path d="M4 19.5V15M9.3 19.5v-8M14.7 19.5V8M20 19.5V4.5"/><path d="m4 11 5-4 5 1.5L20 3.75"/>',
};

function metricIconXml(icon, color) {
  const paths = metricIconPaths[icon] || metricIconPaths.invoice;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
}

function InvoiceMetric({ basis = "100%", definition, icon, label, meta, progress, tone = "blue", value }) {
  const modal = useModal();
  const palette = metricTones[tone] || metricTones.blue;
  return (
    <TouchableOpacity
      accessibilityHint={`Explains how ${label} is calculated`}
      accessibilityRole="button"
      activeOpacity={0.86}
      onPress={() => modal.info(label, definition)}
      style={[styles.metricCardEnterprise, { flexBasis: basis }]}
    >
      <View style={styles.metricCardTop}>
        <View style={[styles.metricIconEnterprise, { backgroundColor: palette.soft }]}>
          <SvgXml height={20} width={20} xml={metricIconXml(icon, palette.accent)} />
        </View>
        <Text style={[styles.metricPercent, { color: palette.accent }]}>{Math.max(0, Math.min(100, progress || 0))}%</Text>
      </View>
      <Text style={styles.metricLabelEnterprise}>{label}</Text>
      <Text adjustsFontSizeToFit minimumFontScale={0.78} numberOfLines={1} style={styles.metricValueEnterprise}>{value}</Text>
      <Text numberOfLines={1} style={styles.metricMetaEnterprise}>{meta}</Text>
      <View style={styles.metricProgressTrack}>
        <View style={[styles.metricProgressFill, { backgroundColor: palette.accent, width: `${Math.max(3, Math.min(100, progress || 0))}%` }]} />
      </View>
    </TouchableOpacity>
  );
}

function invoiceStatusPalette(status, isReverse) {
  const normalized = String(status || "Pending").trim().toLowerCase();
  if (isReverse || normalized.includes("reverse")) return { backgroundColor: "#F5F3FF", color: "#7C3AED", dot: "#8B5CF6" };
  if (["paid", "approved", "refunded"].includes(normalized)) return { backgroundColor: "#F0FDF4", color: "#15803D", dot: "#22C55E" };
  if (["cancelled", "rejected", "overdue"].includes(normalized)) return { backgroundColor: "#FEF2F2", color: "#B91C1C", dot: "#EF4444" };
  if (["partially paid", "pending approval"].includes(normalized)) return { backgroundColor: "#FFF7ED", color: "#C2410C", dot: "#F97316" };
  return { backgroundColor: "#FFFBEB", color: "#A16207", dot: "#F59E0B" };
}

function InvoiceStatusBadge({ invoice }) {
  const displayStatus = invoice.isReverse ? invoice.status : (invoice.paymentStatus || invoice.status || "Unpaid");
  const palette = invoiceStatusPalette(displayStatus, invoice.isReverse);
  return (
    <View style={[styles.enterpriseBadge, { backgroundColor: palette.backgroundColor }]}>
      <View style={[styles.enterpriseBadgeDot, { backgroundColor: palette.dot }]} />
      <Text style={[styles.enterpriseBadgeText, { color: palette.color }]}>{displayStatus}</Text>
    </View>
  );
}

function paymentProgress(invoice) {
  const total = getInvoiceTotal(invoice);
  const recordedPercentage = Number(invoice.paymentPercentage);
  if (Number.isFinite(recordedPercentage)) return Math.max(0, Math.round(recordedPercentage));
  const recordedPaid = Number(invoice.paidAmount ?? 0);
  return total > 0 && Number.isFinite(recordedPaid) ? Math.max(0, Math.round((recordedPaid / total) * 100)) : 0;
}

function getInvoicePaidAmount(invoice) {
  const recordedPaid = Number(invoice.paidAmount ?? 0);
  return Number.isFinite(recordedPaid) ? Math.max(0, recordedPaid) : 0;
}

function PaymentProgress({ invoice }) {
  const value = paymentProgress(invoice);
  const total = getInvoiceTotal(invoice);
  const paid = getInvoicePaidAmount(invoice);
  const remaining = Math.max(0, total - paid);
  const color = value === 100 ? "#22C55E" : value > 0 ? "#F59E0B" : "#EF4444";
  return (
    <View style={styles.paymentTypography}>
      <Text style={[styles.paymentPaidText, { color }]}>{formatCurrency(paid)} paid</Text>
      <Text style={styles.paymentRemainingText}>{formatCurrency(remaining)} remaining</Text>
      <Text style={[styles.paymentPercentText, { color }]}>{value}%</Text>
    </View>
  );
}

function RemainingCredit({ invoice }) {
  const total = getInvoiceTotal(invoice);
  const value = paymentProgress(invoice);
  const remaining = Math.max(0, total - getInvoicePaidAmount(invoice));
  const color = value === 100 ? "#16A34A" : value > 0 ? "#D97706" : "#DC2626";
  return (
    <View style={styles.remainingCreditContent}>
      <Text style={[styles.creditValue, { color }]}>{formatCurrency(remaining)}</Text>
      {remaining > 0 && <Text style={styles.creditLabel}>{value > 0 ? "Partial credit" : "Open credit"}</Text>}
    </View>
  );
}

function InvoiceAction({ danger = false, disabled, label, onPress, style, symbol, tone = "default" }) {
  return (
    <TouchableOpacity
      accessibilityLabel={label}
      activeOpacity={0.78}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.invoiceAction,
        tone === "primary" && styles.invoiceActionPrimary,
        tone === "success" && styles.invoiceActionSuccess,
        tone === "payment" && styles.invoiceActionPayment,
        danger && styles.invoiceActionDanger,
        style,
        disabled && styles.invoiceActionDisabled,
      ]}
      title={label}
    >
      <Text style={[
        styles.invoiceActionSymbol,
        tone === "primary" && styles.invoiceActionSymbolPrimary,
        tone === "success" && styles.invoiceActionSymbolSuccess,
        tone === "payment" && styles.invoiceActionSymbolPayment,
        danger && styles.invoiceActionSymbolDanger,
      ]}>{symbol}</Text>
      <Text numberOfLines={1} style={[
        styles.invoiceActionLabel,
        tone === "primary" && styles.invoiceActionSymbolPrimary,
        tone === "success" && styles.invoiceActionSymbolSuccess,
        tone === "payment" && styles.invoiceActionSymbolPayment,
        danger && styles.invoiceActionSymbolDanger,
      ]}>{label}</Text>
    </TouchableOpacity>
  );
}

function ProductSummary({ order }) {
  const items = order?.items || [];
  const completeList = items.map((item) => item.productName || item.productSku || `Product ${item.productId}`).join("\n");
  return (
    <View accessibilityLabel={completeList || "No linked products"} style={styles.productSummary} title={completeList || "No linked products"}>
      {items.slice(0, 2).map((item, index) => (
        <Text key={item.id || item.productId || index} numberOfLines={1} style={styles.productSummaryName}>
          {item.productName || item.productSku || `Product ${item.productId}`}
        </Text>
      ))}
      {items.length > 2 && <Text style={styles.productSummaryMore}>+{items.length - 2} more items</Text>}
      {!items.length && <Text style={styles.productSummaryEmpty}>No linked products</Text>}
    </View>
  );
}

function EnterpriseInvoiceTable({
  canApproveReverse,
  disabled,
  invoices,
  onApprove,
  onDelete,
  onDownload,
  onHistory,
  onPay,
  onPreview,
  onReverse,
  orderLookup,
}) {
  return (
    <View style={styles.enterpriseTableShell}>
      <ScrollView horizontal showsHorizontalScrollIndicator>
        <View style={styles.enterpriseTable}>
          <View style={styles.enterpriseTableHeader}>
            <Text style={[styles.enterpriseHeadText, styles.colInvoice]}>Invoice</Text>
            <Text style={[styles.enterpriseHeadText, styles.colCustomer]}>Party</Text>
            <Text style={[styles.enterpriseHeadText, styles.colProducts]}>Products</Text>
            <Text style={[styles.enterpriseHeadText, styles.enterpriseHeadCenter, styles.colAmountTable]}>Total</Text>
            <Text style={[styles.enterpriseHeadText, styles.enterpriseHeadCenter, styles.colAmountTable]}>Paid</Text>
            <Text style={[styles.enterpriseHeadText, styles.enterpriseHeadCenter, styles.colCredit]}>Remaining credit</Text>
            <Text style={[styles.enterpriseHeadText, styles.enterpriseHeadCenter, styles.colStatus]}>Payment status</Text>
            <Text style={[styles.enterpriseHeadText, styles.enterpriseHeadCenter, styles.colStatus]}>Invoice status</Text>
            <Text style={[styles.enterpriseHeadText, styles.enterpriseHeadCenter, styles.colType]}>Invoice type</Text>
            <Text style={[styles.enterpriseHeadText, styles.enterpriseHeadCenter, styles.colPaymentPercent]}>Payment %</Text>
            <Text style={[styles.enterpriseHeadText, styles.enterpriseHeadCenter, styles.colDate]}>Invoice date</Text>
            <Text style={[styles.enterpriseHeadText, styles.enterpriseHeadCenter, styles.colDate]}>Due date</Text>
            <Text style={[styles.enterpriseHeadText, styles.enterpriseHeadCenter, styles.colDate]}>Last payment</Text>
            <Text style={[styles.enterpriseHeadText, styles.enterpriseHeadCenter, styles.colPaymentAction]}>Payment</Text>
            <Text style={[styles.enterpriseHeadText, styles.colActions, styles.actionsHeaderCell]}>Actions</Text>
          </View>
          {invoices.map((invoice, index) => {
            const order = orderLookup[String(invoice.orderId)];
            const grandTotal = getInvoiceTotal(invoice);
            const paidAmount = getInvoicePaidAmount(invoice);
            const paidPercent = paymentProgress(invoice);
            const remainingAmount = Math.max(0, grandTotal - paidAmount);
            const partyPhone = getInvoicePartyPhone(invoice, order);
            const partyIdentity = getInvoicePartyIdentity(invoice, order);
            const customerGstin = invoice.customerGstin || invoice.customerGSTIN || invoice.gstin;
            const customerCode = invoice.customerCode || order?.customerCode;
            return (
              <View key={invoice.id} style={[styles.enterpriseTableRow, index % 2 === 1 && styles.enterpriseTableRowAlternate]}>
                <TouchableOpacity activeOpacity={0.75} onPress={() => onPreview(invoice)} style={[styles.enterpriseCell, styles.colInvoice, styles.invoiceIdentityCell]}>
                  <View style={styles.invoiceThumbnail}><Text style={styles.invoiceThumbnailText}>INV</Text><View style={styles.invoiceThumbnailLine} /><View style={styles.invoiceThumbnailLineShort} /></View>
                  <View style={styles.invoiceIdentityCopy}>
                    <Text numberOfLines={1} style={styles.invoiceNumberLink}>{invoice.invoiceNumber || `Invoice ${invoice.id}`}</Text>
                    <Text numberOfLines={1} style={styles.invoiceSecondary}>{formatDate(invoice.date)} · Order {invoice.orderNumber || invoice.orderId || "—"}</Text>
                    <Text numberOfLines={1} style={styles.invoiceTypeMini}>{invoice.invoiceType || "GST Invoice"}</Text>
                    {invoice.source === "POS" && <Text style={styles.posSourceLabel}>POS SALE</Text>}
                    {invoice.isReverse && <Text style={styles.reverseLabel}>REVERSE</Text>}
                  </View>
                </TouchableOpacity>
                <View style={[styles.enterpriseCell, styles.colCustomer, styles.customerCell]}>
                  <View style={styles.customerAvatar}><Text style={styles.customerAvatarText}>{String(invoice.partyName || "C").slice(0, 1).toUpperCase()}</Text></View>
                  <View style={styles.customerCopy}>
                    <Text numberOfLines={1} style={styles.customerName}>{invoice.partyName || "Unassigned party"}</Text>
                    {hasInvoiceValue(partyPhone) && <Text numberOfLines={1} style={styles.customerMeta}>{partyPhone}</Text>}
                    {!!customerGstin && <Text numberOfLines={1} style={styles.customerDetail}>GSTIN {customerGstin}</Text>}
                    <Text numberOfLines={1} style={styles.partyIdentity}>{partyIdentity.category} · {partyIdentity.role}</Text>
                    {!!customerCode && <Text numberOfLines={1} style={styles.customerDetail}>Code {customerCode}</Text>}
                  </View>
                </View>
                <View style={[styles.enterpriseCell, styles.colProducts]}><ProductSummary order={order} /></View>
                <View style={[styles.enterpriseCell, styles.enterpriseCellCenter, styles.colAmountTable]}><Text style={styles.amountGrand}>{formatCurrency(grandTotal)}</Text></View>
                <View style={[styles.enterpriseCell, styles.enterpriseCellCenter, styles.colAmountTable]}><Text style={styles.paymentPaidAmount}>{formatCurrency(paidAmount)}</Text></View>
                <View style={[styles.enterpriseCell, styles.colCredit, styles.remainingCreditCell]}><RemainingCredit invoice={invoice} /></View>
                <View style={[styles.enterpriseCell, styles.enterpriseCellCenter, styles.colStatus]}><InvoiceStatusBadge invoice={invoice} /></View>
                <View style={[styles.enterpriseCell, styles.enterpriseCellCenter, styles.colStatus]}><Text style={styles.typePrimary}>{invoice.status || "Generated"}</Text></View>
                <View style={[styles.enterpriseCell, styles.enterpriseCellCenter, styles.colType]}><Text style={styles.typePrimary}>{invoice.invoiceType || "GST Invoice"}</Text><Text style={styles.dateSecondary}>{Number(invoice.igst || 0) > 0 ? "IGST" : "CGST + SGST"}</Text></View>
                <View style={[styles.enterpriseCell, styles.enterpriseCellCenter, styles.colPaymentPercent]}><Text style={[styles.paymentPercentStandalone, { color: paidPercent === 100 ? "#16A34A" : paidPercent > 0 ? "#D97706" : "#DC2626" }]}>{paidPercent}%</Text></View>
                <View style={[styles.enterpriseCell, styles.enterpriseCellCenter, styles.colDate]}><Text style={styles.datePrimary}>{formatDate(invoice.date)}</Text><Text style={styles.dateSecondary}>Issued</Text></View>
                <View style={[styles.enterpriseCell, styles.enterpriseCellCenter, styles.colDate]}><Text style={styles.datePrimary}>{formatDate(invoice.dueDate)}</Text><Text style={[styles.dateSecondary, invoice.dueDate && invoice.dueDate < today && paidPercent < 100 && styles.pastDueText]}>{invoice.dueDate && invoice.dueDate < today && paidPercent < 100 ? "Past due" : "Due date"}</Text></View>
                <View style={[styles.enterpriseCell, styles.enterpriseCellCenter, styles.colDate]}><Text style={styles.datePrimary}>{invoice.lastPaymentDate ? formatDate(invoice.lastPaymentDate) : "—"}</Text><Text style={styles.dateSecondary}>{invoice.lastPaymentDate ? "Collected" : "No payment"}</Text></View>
                <View style={[styles.enterpriseCell, styles.colPaymentAction, styles.paymentActionCell]}>
                  <InvoiceAction disabled={disabled || remainingAmount <= 0} label={remainingAmount <= 0 ? (invoice.source === "POS" ? "Paid on POS" : "Paid") : "Pay"} onPress={() => onPay(invoice)} symbol={remainingAmount <= 0 ? "✓" : "₹"} tone="payment" />
                  {remainingAmount > 0 && <Text style={styles.paymentActionHint}>{formatCurrency(remainingAmount)} due</Text>}
                </View>
                <View style={[styles.enterpriseCell, styles.colActions, styles.tableActionCell]}>
                  <View style={styles.tableActionRow}>
                    <InvoiceAction disabled={disabled} label="View" onPress={() => onPreview(invoice)} style={styles.tableActionButton} symbol="↗" tone="primary" />
                    <InvoiceAction disabled={disabled} label="Download" onPress={() => onDownload(invoice)} style={styles.tableActionButton} symbol="↓" />
                    <InvoiceAction disabled={disabled} label="History" onPress={() => onHistory(invoice)} style={styles.tableActionButton} symbol="₹" />
                  </View>
                  <View style={styles.tableActionRow}>
                    {!invoice.isReverse && <InvoiceAction disabled={disabled} label="Reverse" onPress={() => onReverse(invoice)} style={styles.tableActionButton} symbol="↩" />}
                    {canApproveReverse(invoice) && <InvoiceAction disabled={disabled} label="Approve" onPress={() => onApprove(invoice)} style={styles.tableActionButton} symbol="✓" tone="success" />}
                    <InvoiceAction danger disabled={disabled} label="Delete" onPress={() => onDelete(invoice)} style={styles.tableActionButton} symbol="×" />
                  </View>
                </View>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

function EnterpriseInvoiceCard({ canApprove, disabled, invoice, onApprove, onDelete, onDownload, onHistory, onPay, onPreview, onReverse, order }) {
  const grandTotal = getInvoiceTotal(invoice);
  const paidAmount = getInvoicePaidAmount(invoice);
  const remainingAmount = Math.max(0, grandTotal - paidAmount);
  const partyIdentity = getInvoicePartyIdentity(invoice, order);
  const partyPhone = getInvoicePartyPhone(invoice, order);
  return (
    <View style={styles.enterpriseInvoiceCard}>
      <View style={styles.mobileCardTop}>
        <TouchableOpacity activeOpacity={0.75} onPress={onPreview} style={styles.mobileInvoiceIdentity}>
          <View style={styles.invoiceThumbnail}><Text style={styles.invoiceThumbnailText}>INV</Text><View style={styles.invoiceThumbnailLine} /><View style={styles.invoiceThumbnailLineShort} /></View>
          <View style={styles.invoiceIdentityCopy}>
            <Text style={styles.invoiceNumberLink}>{invoice.invoiceNumber || `Invoice ${invoice.id}`}</Text>
            <Text style={styles.invoiceSecondary}>Order {invoice.orderNumber || invoice.orderId || "—"}</Text>
          </View>
        </TouchableOpacity>
        <InvoiceStatusBadge invoice={invoice} />
      </View>
      <View style={styles.mobileCustomerRow}>
        <View style={styles.customerAvatar}><Text style={styles.customerAvatarText}>{String(invoice.partyName || "C").slice(0, 1).toUpperCase()}</Text></View>
        <View style={styles.customerCopy}><Text style={styles.customerName}>{invoice.partyName || "Unassigned party"}</Text>{hasInvoiceValue(partyPhone) && <Text style={styles.customerMeta}>{partyPhone}</Text>}<Text style={styles.partyIdentity}>{partyIdentity.category} · {partyIdentity.role}</Text></View>
      </View>
      <ProductSummary order={order} />
      <View style={styles.mobileDateGrid}>
        <View style={styles.mobileMetaBlock}><Text style={styles.mobileMetaLabel}>Invoice date</Text><Text style={styles.mobileMetaValue}>{formatDate(invoice.date)}</Text></View>
        <View style={styles.mobileMetaBlock}><Text style={styles.mobileMetaLabel}>Due date</Text><Text style={styles.mobileMetaValue}>{formatDate(invoice.dueDate)}</Text></View>
      </View>
      <PaymentProgress invoice={invoice} />
      <View style={styles.mobileAmountGrid}>
        <View><Text style={styles.mobileMetaLabel}>Total</Text><Text style={styles.mobileGrandValue}>{formatCurrency(grandTotal)}</Text></View>
        <View><Text style={styles.mobileMetaLabel}>Paid</Text><Text style={styles.mobilePaidValue}>{formatCurrency(paidAmount)}</Text></View>
        <View><Text style={styles.mobileMetaLabel}>Remaining credit</Text><RemainingCredit invoice={invoice} /></View>
      </View>
      <View style={styles.mobileActionRow}>
        <InvoiceAction disabled={disabled} label="View" onPress={onPreview} symbol="↗" tone="primary" />
        <InvoiceAction disabled={disabled} label="Download" onPress={onDownload} symbol="↓" />
        <InvoiceAction disabled={disabled} label="History" onPress={onHistory} symbol="₹" />
        <InvoiceAction disabled={disabled || remainingAmount <= 0} label="Pay" onPress={onPay} symbol="₹" tone="payment" />
        {!invoice.isReverse && <InvoiceAction disabled={disabled} label="Reverse" onPress={onReverse} symbol="↩" />}
        {canApprove && <InvoiceAction disabled={disabled} label="Approve" onPress={onApprove} symbol="✓" tone="success" />}
        <InvoiceAction danger disabled={disabled} label="Delete" onPress={onDelete} symbol="×" />
      </View>
    </View>
  );
}

function InvoiceSkeleton() {
  return (
    <View style={styles.skeletonRow}>
      <View style={styles.skeletonSquare} />
      <View style={styles.skeletonCopy}><View style={styles.skeletonLineWide} /><View style={styles.skeletonLineShort} /></View>
      <View style={styles.skeletonPill} />
    </View>
  );
}

function InvoicePreview({ businessProfile, compact, invoice, onClose, onDownload, onPay, order, paymentMode = false, notificationStatus = {}, notificationHistory = [], notificationLoading, notificationAction, onResendNotification }) {
  const unresolvedNotificationHistory = notificationHistory.filter((entry) => {
    const currentStatus = String(notificationStatus[entry.channel]?.status || "").toLowerCase();
    return currentStatus && !["sent", "not queued"].includes(currentStatus);
  });
  const grandTotal = getInvoiceTotal(invoice);
  const paidAmount = getInvoicePaidAmount(invoice);
  const remainingAmount = Math.max(0, grandTotal - paidAmount);
  const paymentPercent = paymentProgress(invoice);
  const invoiceCaption = invoice.isReverse ? "REVERSE / CREDIT COPY" : String(invoice.status || "").toLowerCase() === "draft" ? "DRAFT" : "ORIGINAL FOR RECIPIENT";
  const businessLocation = joinInvoiceParts([businessProfile?.city, businessProfile?.state, businessProfile?.pincode]);
  const businessContact = joinInvoiceParts([businessProfile?.mobile, businessProfile?.email], " · ");
  const businessTax = joinInvoiceParts([
    businessProfile?.gstin ? `GSTIN ${businessProfile.gstin}` : null,
    businessProfile?.pan ? `PAN ${businessProfile.pan}` : null,
  ], " · ");
  const customerAddress = invoice.customerAddress || order?.customerAddress;
  const partyPhone = getInvoicePartyPhone(invoice, order);
  const partyEmail = getInvoicePartyEmail(invoice, order);
  const isPurchase = order?.type === "purchase" || String(invoice.invoiceType || "").toLowerCase() === "purchase";
  const partyIdentity = getInvoicePartyIdentity(invoice, order);
  const hasBankDetails = [businessProfile?.bankName, businessProfile?.accountNumber, businessProfile?.ifsc, businessProfile?.upiId].some(hasInvoiceValue);
  const items = (order?.items || []).map((item) => {
    const subtotal = Number(item.quantity || 0) * Number(item.rate || 0);
    const tax = (subtotal * Number(item.gstRate || 0)) / 100;
    return {
      name: item.productName || item.productSku || String(item.productId),
      description: item.description || item.productDescription || "",
      sku: cleanInvoiceValue(item.productSku || item.sku),
      hsn: cleanInvoiceValue(item.hsnCode || item.sku),
      quantity: item.quantity,
      unit: item.unitLabel || item.packageSizeUnit || "Nos",
      rate: item.rate,
      gstRate: item.gstRate,
      tax,
      subtotal,
      amount: subtotal + tax,
    };
  });

  return (
    <View style={styles.previewCard}>
      <View style={styles.previewTopBar}>
        <View style={styles.previewHeadingWrap}>
          <Text style={styles.previewTitle}>Tax Invoice</Text>
          <Text style={styles.previewSubtitle}>{invoice.invoiceNumber || String(invoice.id)}</Text>
        </View>
        <View style={styles.previewActionRow}>
          <TouchableOpacity activeOpacity={0.85} onPress={onDownload} style={styles.downloadPreviewButton}>
            <Text style={styles.downloadPreviewText}>Download</Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.85} onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>

      {paymentMode && (
        <View style={[styles.paymentReviewPanel, compact && styles.paymentReviewPanelCompact]}>
          <View style={styles.paymentReviewCopy}>
            <Text style={styles.paymentReviewEyebrow}>PAYMENT REVIEW</Text>
            <Text style={styles.paymentReviewTitle}>Review the complete invoice before payment</Text>
            <Text style={styles.paymentReviewSubtitle}>The existing invoice workflow will mark this balance as fully paid after confirmation.</Text>
          </View>
          <View style={styles.paymentReviewAmounts}>
            <View style={styles.paymentReviewMetric}><Text style={styles.paymentReviewLabel}>Invoice total</Text><Text style={styles.paymentReviewValue}>{formatCurrency(grandTotal)}</Text></View>
            <View style={styles.paymentReviewMetric}><Text style={styles.paymentReviewLabel}>Already paid</Text><Text style={styles.paymentReviewPaid}>{formatCurrency(paidAmount)}</Text></View>
            <View style={styles.paymentReviewMetric}><Text style={styles.paymentReviewLabel}>Amount to pay</Text><Text style={styles.paymentReviewDue}>{formatCurrency(remainingAmount)}</Text></View>
          </View>
          <TouchableOpacity accessibilityLabel={`Pay remaining ${formatCurrency(remainingAmount)}`} activeOpacity={0.84} disabled={remainingAmount <= 0} onPress={onPay} style={[styles.paymentReviewButton, remainingAmount <= 0 && styles.invoiceActionDisabled]}>
            <Text style={styles.paymentReviewButtonText}>{remainingAmount > 0 ? `Pay ${formatCurrency(remainingAmount)}` : "Invoice fully paid"}</Text>
          </TouchableOpacity>
        </View>
      )}

      {!paymentMode && (
        <View style={styles.notificationPanel}>
          <View><Text style={styles.notificationTitle}>Delivery status</Text><Text style={styles.notificationHint}>Actual email and SMS delivery progress for this invoice.</Text></View>
          {['email', 'sms'].map((channel) => {
            const item = notificationStatus[channel];
            const status = item?.status || (notificationLoading ? 'loading' : 'not queued');
            return <View key={channel} style={styles.notificationRow}>
              <View><Text style={styles.notificationChannel}>{channel === 'sms' ? 'SMS' : 'Email'}</Text><Text style={styles.notificationMeta}>{item?.sentAt ? `Sent ${formatDate(item.sentAt)}` : item?.lastError || status}</Text></View>
              <View style={styles.notificationActions}><Text style={[styles.notificationBadge, status === 'sent' ? styles.notificationSent : status === 'failed' || status === 'dead_letter' ? styles.notificationFailed : styles.notificationPending]}>{status.replace('_', ' ')}</Text><TouchableOpacity disabled={notificationAction === channel} onPress={() => onResendNotification?.(channel)} style={styles.notificationResend}><Text style={styles.notificationResendText}>{notificationAction === channel ? 'Queuing…' : 'Resend'}</Text></TouchableOpacity></View>
            </View>;
          })}
          {!!unresolvedNotificationHistory.length && (
            <View style={styles.notificationAudit}>
              <Text style={styles.notificationAuditTitle}>Delivery issue details</Text>
              {unresolvedNotificationHistory.slice(0, 4).map((entry, index) => (
                <Text key={`${entry.correlationId || entry.createdAt}-${index}`} style={styles.notificationAuditEntry}>
                  {entry.channel.toUpperCase()} · {String(entry.status || 'unknown').replaceAll('_', ' ')} · attempt {entry.attempt || 1}
                  {entry.errorMessage ? ` · ${entry.errorMessage}` : entry.completedAt ? ` · ${formatDate(entry.completedAt)}` : ''}
                </Text>
              ))}
            </View>
          )}
        </View>
      )}

      <View style={styles.premiumInvoiceSheet}>
        <View style={[styles.premiumHeader, compact && styles.premiumStack]}>
          <View style={styles.premiumCompanyBlock}>
            <View style={styles.premiumBrandRow}>
              <View style={styles.premiumLogo}><Text style={styles.premiumLogoText}>{businessProfile?.logoText || "ERP"}</Text></View>
              <View style={styles.premiumBrandCopy}><Text style={styles.premiumCompanyName}>{businessProfile?.tradeName || businessProfile?.legalName || "Company"}</Text>{hasInvoiceValue(businessProfile?.legalName) && <Text style={styles.premiumCompanyLegal}>{businessProfile.legalName}</Text>}</View>
            </View>
            {hasInvoiceValue(businessProfile?.billingAddress) && <Text style={styles.premiumAddress}>{businessProfile.billingAddress}</Text>}
            {hasInvoiceValue(businessLocation) && <Text style={styles.premiumAddress}>{businessLocation}</Text>}
            {hasInvoiceValue(businessContact) && <Text style={styles.premiumContact}>{businessContact}</Text>}
            {hasInvoiceValue(businessTax) && <Text style={styles.premiumContact}>{businessTax}</Text>}
          </View>
          <View style={styles.premiumTitleBlock}>
            <Text style={styles.premiumInvoiceTitle}>TAX INVOICE</Text>
            <Text style={styles.premiumCopyBadge}>{invoiceCaption}</Text>
          </View>
          <View style={[styles.premiumInvoiceMeta, compact && styles.premiumInvoiceMetaCompact]}>
            <InvoiceInfo label="Invoice No." value={invoice.invoiceNumber || String(invoice.id)} strong />
            <InvoiceInfo label="Invoice Date" value={formatDate(invoice.date)} />
            <InvoiceInfo label="Due Date" value={formatDate(invoice.dueDate)} />
            <InvoiceInfo label="Place of Supply" value={invoice.placeOfSupply || businessProfile?.state} />
            <InvoiceInfo label="Invoice Type" value={invoice.invoiceType || "GST Tax Invoice"} />
            <InvoiceInfo label="Payment Status" value={invoice.paymentStatus || "Unpaid"} />
          </View>
        </View>

        <View style={[styles.premiumCardGrid, compact && styles.premiumStack]}>
          <InvoiceDetailCard title={isPurchase ? "SUPPLIER" : "BILL TO"}>
            <View style={styles.premiumCustomerTitleRow}><View style={styles.premiumAvatar}><Text style={styles.premiumAvatarText}>{String(invoice.partyName || "C").slice(0, 1)}</Text></View><View><Text style={styles.premiumCustomerName}>{invoice.partyName || "Customer"}</Text><Text style={styles.premiumCustomerType}>{partyIdentity.category} · {partyIdentity.role}</Text></View></View>
            <InvoiceInfo label="Customer code" value={invoice.customerCode || order?.customerCode} />
            <InvoiceInfo label="Phone" value={partyPhone} />
            <InvoiceInfo label="Email" value={partyEmail} />
            <InvoiceInfo label="GSTIN" value={invoice.customerGstin || invoice.gstin} />
            <InvoiceInfo label="Address" value={customerAddress} />
          </InvoiceDetailCard>
          <InvoiceDetailCard title="SHIP TO">
            <InvoiceInfo label="Contact person" value={invoice.shippingContact || invoice.partyName} />
            <InvoiceInfo label="Shipping address" value={invoice.shippingAddress || customerAddress} />
            <InvoiceInfo label="Phone" value={invoice.shippingPhone || partyPhone} />
            <InvoiceInfo label="State" value={invoice.shippingState} />
            <InvoiceInfo label="Country" value={invoice.shippingCountry || "India"} />
          </InvoiceDetailCard>
          <InvoiceDetailCard title="INVOICE DETAILS">
            <InvoiceInfo label="Order number" value={invoice.orderNumber || order?.orderNumber || invoice.orderId} />
            <InvoiceInfo label="Quotation" value={invoice.quotationNumber} />
            <InvoiceInfo label="Delivery challan" value={invoice.deliveryChallan} />
            <InvoiceInfo label="Sales person" value={invoice.salesPerson} />
            <InvoiceInfo label="Payment terms" value={invoice.paymentTerms} />
            <InvoiceInfo label="Payment method" value={invoice.paymentMethod} />
            <InvoiceInfo label="Currency" value={businessProfile?.currency || "INR"} />
          </InvoiceDetailCard>
        </View>

        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.premiumItemsScroll}>
          <View style={styles.premiumItemsTable}>
            <View style={styles.premiumItemsHead}>{["#", "ITEM & DESCRIPTION", "SKU", "HSN / SAC", "QTY", "UNIT", "UNIT PRICE", "DISC.", "TAX %", "TAX AMOUNT", "SUBTOTAL", "TOTAL"].map((label, index) => <Text key={label} style={[styles.premiumItemCell, styles.premiumItemHeadText, index === 1 ? styles.premiumItemDescription : styles.premiumItemNarrow]}>{label}</Text>)}</View>
            {items.length ? items.map((item, index) => (
              <View key={`${invoice.id}-premium-${index}`} style={[styles.premiumItemRow, index % 2 === 1 && styles.premiumItemRowAlternate]}>
                <Text style={[styles.premiumItemCell, styles.premiumItemNarrow]}>{index + 1}</Text>
                <View style={[styles.premiumItemCell, styles.premiumItemDescription]}><Text style={styles.premiumItemName}>{item.name}</Text>{hasInvoiceValue(item.description || item.sku) && <Text style={styles.premiumItemSub}>{item.description || `SKU: ${item.sku}`}</Text>}</View>
                <Text style={[styles.premiumItemCell, styles.premiumItemNarrow]}>{item.sku}</Text><Text style={[styles.premiumItemCell, styles.premiumItemNarrow]}>{item.hsn}</Text><Text style={[styles.premiumItemCell, styles.premiumItemNarrow]}>{item.quantity}</Text><Text style={[styles.premiumItemCell, styles.premiumItemNarrow]}>{item.unit}</Text><Text style={[styles.premiumItemCell, styles.premiumItemNarrow]}>{formatCurrency(item.rate)}</Text><Text style={[styles.premiumItemCell, styles.premiumItemNarrow]}>{formatCurrency(invoice.discount || 0)}</Text><Text style={[styles.premiumItemCell, styles.premiumItemNarrow]}>{item.gstRate}%</Text><Text style={[styles.premiumItemCell, styles.premiumItemNarrow]}>{formatCurrency(item.tax)}</Text><Text style={[styles.premiumItemCell, styles.premiumItemNarrow]}>{formatCurrency(item.subtotal)}</Text><Text style={[styles.premiumItemCell, styles.premiumItemNarrow, styles.premiumItemTotal]}>{formatCurrency(item.amount)}</Text>
              </View>
            )) : <View style={styles.premiumEmptyItems}><Text style={styles.productSummaryEmpty}>No order items linked</Text></View>}
          </View>
        </ScrollView>

        <View style={[styles.premiumSummaryGrid, compact && styles.premiumStack]}>
          <View style={styles.premiumSummaryLeft}>
            <View style={styles.premiumWordsBox}><Text style={styles.premiumSectionEyebrow}>AMOUNT IN WORDS</Text><Text style={styles.premiumWords}>{numberToWords(grandTotal)} Only</Text></View>
            <View style={[styles.premiumLowerGrid, compact && styles.premiumStack]}>
              {hasBankDetails && (
                <InvoiceDetailCard title="BANK DETAILS">
                  <InvoiceInfo label="Bank name" value={businessProfile?.bankName} /><InvoiceInfo label="Account name" value={businessProfile?.legalName || businessProfile?.tradeName} /><InvoiceInfo label="Account number" value={businessProfile?.accountNumber} /><InvoiceInfo label="IFSC" value={businessProfile?.ifsc} /><InvoiceInfo label="UPI ID" value={businessProfile?.upiId} />
                </InvoiceDetailCard>
              )}
              <InvoiceDetailCard title="QR PAYMENT">
                <View style={styles.premiumQrPlaceholder}><Text style={styles.premiumQrMark}>UPI</Text></View><Text style={styles.premiumQrTitle}>{businessProfile?.upiId ? "Pay using configured UPI ID" : "UPI ID not configured"}</Text><Text style={styles.premiumQrHint}>A scannable QR is shown only when provided by the payment system.</Text>
              </InvoiceDetailCard>
            </View>
          </View>
          <View style={styles.premiumSummaryRight}>
            <View style={styles.premiumTotalsCard}><PreviewTotal label="Subtotal" value={formatCurrency(invoice.taxableValue)} /><PreviewTotal label="Discount" value={formatCurrency(invoice.discount || 0)} /><PreviewTotal label="Taxable amount" value={formatCurrency(invoice.taxableValue)} /><PreviewTotal label="CGST" value={formatCurrency(invoice.cgst)} /><PreviewTotal label="SGST" value={formatCurrency(invoice.sgst)} /><PreviewTotal label="IGST" value={formatCurrency(invoice.igst)} /><PreviewTotal label="CESS / Shipping / Round off" value={formatCurrency(Number(invoice.cess || 0) + Number(invoice.shipping || 0) + Number(invoice.roundOff || 0))} /><PreviewTotal label="Grand total" strong value={formatCurrency(grandTotal)} /></View>
            <View style={styles.premiumPaymentCard}><InvoiceInfo label="Paid amount" value={formatCurrency(paidAmount)} valueTone="success" /><InvoiceInfo label="Remaining amount" value={formatCurrency(remainingAmount)} valueTone={remainingAmount > 0 ? "danger" : "success"} /><InvoiceInfo label="Payment percentage" value={`${paymentPercent}%`} /></View>
          </View>
        </View>

        <View style={styles.premiumTerms}><Text style={styles.premiumSectionEyebrow}>TERMS & CONDITIONS</Text><Text style={styles.premiumTerm}>1. Goods once sold are subject to the company return and warranty policy.</Text><Text style={styles.premiumTerm}>2. Applicable GST is charged as shown and payment is due by the stated due date.</Text><Text style={styles.premiumTerm}>3. Delayed payments may attract charges under the agreed commercial terms.</Text><Text style={styles.premiumTerm}>4. Disputes are subject to the jurisdiction of the seller’s registered office.</Text></View>
        <View style={[styles.premiumFooter, compact && styles.premiumStack]}><View><Text style={styles.premiumFooterLabel}>GENERATED BY</Text><Text style={styles.premiumFooterValue}>{invoice.createdBy || "ERP System"}</Text></View><View style={styles.premiumFooterCenter}><Text style={styles.premiumFooterStrong}>Computer Generated Invoice</Text><Text style={styles.premiumFooterLabel}>No signature required</Text></View><View style={styles.premiumSignature}><Text style={styles.premiumFooterStrong}>Authorized Signature</Text><Text style={styles.premiumFooterLabel}>{businessProfile?.tradeName || "Company"}</Text></View></View>
      </View>
    </View>
  );
}

function InvoiceDetailCard({ children, title }) {
  return <View style={styles.premiumDetailCard}><Text style={styles.premiumSectionEyebrow}>{title}</Text>{children}</View>;
}

function InvoiceInfo({ label, strong = false, value, valueTone }) {
  const displayValue = cleanInvoiceValue(value);
  if (!displayValue) return null;
  return <View style={styles.premiumInfoRow}><Text style={styles.premiumInfoLabel}>{label}</Text><Text style={[styles.premiumInfoValue, strong && styles.premiumInfoStrong, valueTone === "success" && styles.premiumValueSuccess, valueTone === "danger" && styles.premiumValueDanger]}>{displayValue}</Text></View>;
}

function MetaRow({ label, value }) {
  return (
    <View style={styles.metaRowCompact}>
      <Text style={styles.metaLabelCompact}>{label}</Text>
      <Text style={styles.metaValueCompact}>{value}</Text>
    </View>
  );
}

function PreviewMeta({ label, value }) {
  return (
    <View style={styles.previewMeta}>
      <Text style={styles.previewMetaLabel}>{label}</Text>
      <Text style={styles.previewMetaValue}>{value}</Text>
    </View>
  );
}

function PreviewTotal({ label, strong, value }) {
  return (
    <View style={styles.previewTotalRow}>
      <Text style={[styles.previewTotalLabel, strong && styles.previewGrandLabel]}>{label}</Text>
      <Text style={[styles.previewTotalValue, strong && styles.previewGrandValue]}>{value}</Text>
    </View>
  );
}

function Tax({ label, value }) {
  return (
    <View style={styles.taxItem}>
      <Text style={styles.taxLabel}>{label}</Text>
      <Text style={styles.taxValue}>{value}</Text>
    </View>
  );
}

function getInvoiceTotal(invoice) {
  return Number(invoice.taxableValue || 0) + Number(invoice.cgst || 0) + Number(invoice.sgst || 0) + Number(invoice.igst || 0);
}

function numberToWords(amount) {
  const rounded = Math.round(Number(amount || 0));
  const units = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine"];
  const teens = ["Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  function twoDigits(value) {
    if (value < 10) return units[value];
    if (value < 20) return teens[value - 10];
    const ten = Math.floor(value / 10);
    const unit = value % 10;
    return `${tens[ten]}${unit ? ` ${units[unit]}` : ""}`.trim();
  }

  function threeDigits(value) {
    const hundred = Math.floor(value / 100);
    const rest = value % 100;
    const parts = [];
    if (hundred) parts.push(`${units[hundred]} Hundred`);
    if (rest) parts.push(twoDigits(rest));
    return parts.join(" ");
  }

  if (!rounded) return "Zero Rupees";
  const crore = Math.floor(rounded / 10000000);
  const lakh = Math.floor((rounded % 10000000) / 100000);
  const thousand = Math.floor((rounded % 100000) / 1000);
  const rest = rounded % 1000;
  const parts = [];
  if (crore) parts.push(`${threeDigits(crore)} Crore`);
  if (lakh) parts.push(`${threeDigits(lakh)} Lakh`);
  if (thousand) parts.push(`${threeDigits(thousand)} Thousand`);
  if (rest) parts.push(threeDigits(rest));
  return `${parts.join(" ")} Rupees`;
}


function legacyBuildInvoiceHtml({ businessProfile, invoice, order }) {
  const grandTotal = getInvoiceTotal(invoice);
  const partyIdentity = getInvoicePartyIdentity(invoice, order);
  const sellerName = cleanInvoiceValue(businessProfile?.tradeName) || cleanInvoiceValue(businessProfile?.legalName) || "Company";
  const sellerLines = [
    businessProfile?.legalName,
    businessProfile?.billingAddress,
    businessProfile?.shippingAddress,
    joinInvoiceParts([businessProfile?.city, businessProfile?.state, businessProfile?.pincode]),
    businessProfile?.gstin ? `GSTIN: ${businessProfile.gstin}` : null,
    businessProfile?.pan ? `PAN: ${businessProfile.pan}` : null,
    businessProfile?.email ? `Email: ${businessProfile.email}` : null,
    businessProfile?.mobile ? `Contact: ${businessProfile.mobile}` : null,
  ].map(cleanInvoiceValue).filter(Boolean);
  const receiverLines = [
    invoice.partyName,
    `${partyIdentity.category} · ${partyIdentity.role}`,
    invoice.customerName,
    getInvoicePartyPhone(invoice, order),
  ].map(cleanInvoiceValue).filter(Boolean);
  const deliveryLines = [
    invoice.partyName,
    `${partyIdentity.category} · ${partyIdentity.role}`,
    invoice.invoiceType,
    invoice.status || "Unpaid",
  ].map(cleanInvoiceValue).filter(Boolean);
  const metaRows = [
    ["Invoice No", invoice.invoiceNumber || invoice.id],
    ["Dated", formatDate(invoice.date)],
    ["Delivery Note", invoice.orderNumber || invoice.orderId],
    ["Mode/Terms of payment", invoice.status || "Unpaid"],
    ["Supplier Ref", invoice.orderNumber],
    ["Other Reference(s)", invoice.invoiceType],
    ["Buyer Order No.", invoice.orderNumber],
    ["Due Date", formatDate(invoice.dueDate)],
    ["Delivery Point", invoice.partyName],
    ["Party Category", partyIdentity.category],
    ["Transport", invoice.invoiceDirection],
    ["Party Role", partyIdentity.role],
  ]
    .map(([label, value]) => [label, cleanInvoiceValue(value)])
    .filter(([, value]) => value);
  const items = (order?.items || []).map((item) => {
    const subtotal = Number(item.quantity || 0) * Number(item.rate || 0);
    const tax = (subtotal * Number(item.gstRate || 0)) / 100;
    return {
      name: item.productName || item.productSku || String(item.productId),
      hsn: item.hsnCode || item.sku || "-",
      quantity: item.quantity,
      unitSummary: formatItemUnit(item),
      rate: item.rate,
      gstRate: item.gstRate,
      tax,
      amount: subtotal + tax,
      subtotal,
    };
  });

  const itemRows = items
    .map((item, index) => `
      <div class="itemsTableRow">
        <div class="itemsCell colNo">${index + 1}</div>
        <div class="itemsCell colDesc">${item.name}</div>
        <div class="itemsCell colHsn">${item.hsn}</div>
        <div class="itemsCell colQty">${item.unitSummary}</div>
        <div class="itemsCell colRate">${formatCurrency(item.rate)}</div>
        <div class="itemsCell colTax">${item.gstRate}%</div>
        <div class="itemsCell colAmount">${formatCurrency(item.amount)}</div>
      </div>
    `)
    .join("");

  const gstRows = items
    .slice(0, 2)
    .map((item) => `
      <div class="gstSummaryRow">
        <div class="gstSummaryCell">${item.hsn}</div>
        <div class="gstSummaryCell">${formatCurrency(item.subtotal)}</div>
        <div class="gstSummaryCell">${item.gstRate}%</div>
        <div class="gstSummaryCell">${formatCurrency(item.tax)}</div>
      </div>
    `)
    .join("");

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          @page { size: A4 portrait; margin: 6mm; }
          html, body { margin: 0; padding: 0; }
          body { font-family: Calibri, sans-serif; color: #0f172a; }
          .page { padding: 2px 0; }
          .titlebar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px; }
          .title { font-size: 18px; font-weight: 900; }
          .subtitle { color: #475569; font-size: 10px; font-weight: 700; }
          .header { display: grid; grid-template-columns: 1.2fr 1fr; gap: 8px; align-items: stretch; }
          .sellerBox, .metaBox, .partyBox, .tableBox, .totalsBox, .gstBox, .termsBox { border: 1px solid #1f2937; }
          .sellerBox { padding: 8px; }
          .companyName { color: #0f7a2d; font-size: 13px; font-weight: 900; margin: 0 0 2px; }
          .companyLine { font-size: 9px; line-height: 12px; margin: 0; }
          .metaBox { display: grid; grid-template-columns: 1fr 1fr; }
          .metaCell { border-left: 1px solid #1f2937; border-bottom: 1px solid #1f2937; padding: 5px 6px; font-size: 9px; line-height: 11px; min-height: 26px; }
          .metaCell strong { display: block; font-size: 8px; font-weight: 700; }
          .invoiceTitle { text-align: center; font-size: 14px; font-weight: 900; margin: 4px 0 6px; }
          .parties { display: grid; grid-template-columns: 1fr 1fr; gap: 0; margin-top: 6px; }
          .partyBox { padding: 6px; min-height: 80px; }
          .sectionLabel { font-size: 9px; font-weight: 900; margin-bottom: 4px; text-transform: none; }
          .partyLine { font-size: 9px; line-height: 12px; margin: 0; }
          .tableBox { margin-top: 6px; }
          .itemsTableHead, .itemsTableRow, .gstSummaryRow { display: grid; grid-template-columns: 0.45fr 2.2fr 0.7fr 0.6fr 0.7fr 0.55fr 0.8fr; }
          .itemsTableHead { background: #f8fafc; border-bottom: 1px solid #1f2937; }
          .itemsCell { border-right: 1px solid #1f2937; padding: 5px 4px; font-size: 9px; line-height: 11px; min-height: 22px; }
          .itemsTableRow { border-bottom: 1px solid #1f2937; }
          .itemsTableRow:last-child { border-bottom: 0; }
          .itemsCell:last-child { border-right: 0; }
          .colNo { text-align: center; }
          .colQty, .colRate, .colTax, .colAmount, .colHsn { text-align: center; }
          .totalsArea { display: grid; grid-template-columns: 1.2fr 1fr; gap: 6px; margin-top: 6px; }
          .amountWordsBox, .totalsPanel, .gstBox, .termsBox { padding: 6px; }
          .amountWordsLabel, .gstTitle, .termsTitle { font-size: 9px; font-weight: 900; margin: 0 0 2px; }
          .amountWordsText { font-size: 9px; line-height: 12px; margin: 0; }
          .totalRow { display: flex; justify-content: space-between; font-size: 9px; line-height: 12px; margin: 0; }
          .totalRow strong { font-size: 9px; }
          .grandRow { background: #0f172a; color: white; padding: 4px 6px; margin-top: 4px; }
          .gstBox { margin-top: 6px; }
          .gstSummaryRow { grid-template-columns: 0.8fr 1fr 0.7fr 0.9fr; }
          .gstSummaryCell { border-right: 1px solid #1f2937; border-top: 1px solid #1f2937; padding: 4px 4px; font-size: 8px; line-height: 10px; }
          .gstSummaryCell:last-child { border-right: 0; }
          .gstHeader { display: grid; grid-template-columns: 0.8fr 1fr 0.7fr 0.9fr; background: #f8fafc; }
          .termsBox { margin-top: 6px; }
          .termsText { font-size: 8px; line-height: 10px; margin: 0; }
          .footer { margin-top: 6px; display: grid; grid-template-columns: 1.5fr 1fr; gap: 6px; align-items: end; }
          .signBox, .computerBox { border: 1px solid #1f2937; min-height: 36px; padding: 6px; font-size: 8px; }
          .signBox { text-align: right; }
          .computerText { font-size: 8px; text-align: center; margin-top: 4px; }
        </style>
      </head>
      <body>
        <div class="page">
          <div class="titlebar">
            <div class="subtitle">${invoice.invoiceNumber || invoice.id}</div>
            <div class="title">Tax Invoice</div>
            <div class="subtitle">${formatDate(invoice.date)}</div>
          </div>

          <div class="header">
            <div class="sellerBox">
              <div class="companyName">${sellerName}</div>
              ${sellerLines.map((line) => `<p class="companyLine">${line}</p>`).join("")}
            </div>
            <div class="metaBox">
              ${metaRows.map(([label, value]) => `<div class="metaCell"><strong>${label}</strong>${value}</div>`).join("")}
            </div>
          </div>

          <div class="invoiceTitle">Tax Invoice</div>

          <div class="parties">
            ${receiverLines.length ? `<div class="partyBox">
              <div class="sectionLabel">Buyer</div>
              ${receiverLines.map((line) => `<div class="partyLine">${line}</div>`).join("")}
            </div>` : ""}
            ${deliveryLines.length ? `<div class="partyBox">
              <div class="sectionLabel">Delivery Point</div>
              ${deliveryLines.map((line) => `<div class="partyLine">${line}</div>`).join("")}
            </div>` : ""}
          </div>

          <div class="tableBox">
            <div class="itemsTableHead">
              <div class="itemsCell colNo">Sl No</div>
              <div class="itemsCell colDesc">Description of Goods</div>
              <div class="itemsCell colHsn">HSN Code</div>
              <div class="itemsCell colQty">Quantity</div>
              <div class="itemsCell colRate">Rate</div>
              <div class="itemsCell colTax">Discount / GST</div>
              <div class="itemsCell colAmount">Amount</div>
            </div>
            ${itemRows || `<div class="itemsTableRow"><div class="itemsCell colDesc">No order items linked</div></div>`}
          </div>

          <div style="margin-top:6px; font-size:8px;">GST 5%</div>

          <div class="totalsArea">
            <div class="amountWordsBox">
              <div class="amountWordsLabel">Amount Chargeable (in words)</div>
              <div class="amountWordsText">${numberToWords(grandTotal)} only</div>
            </div>
            <div class="totalsPanel">
              <div class="totalRow"><span>Subtotal</span><strong>${formatCurrency(invoice.taxableValue)}</strong></div>
              <div class="totalRow"><span>CGST</span><strong>${formatCurrency(invoice.cgst)}</strong></div>
              <div class="totalRow"><span>SGST</span><strong>${formatCurrency(invoice.sgst)}</strong></div>
              <div class="totalRow"><span>IGST</span><strong>${formatCurrency(invoice.igst)}</strong></div>
              <div class="totalRow grandRow"><span>Total</span><strong>${formatCurrency(grandTotal)}</strong></div>
            </div>
          </div>

          <div class="gstBox">
            <div class="gstTitle">HSN CODE</div>
            <div class="gstHeader">
              <div class="gstSummaryCell">HSN</div>
              <div class="gstSummaryCell">Taxable Value</div>
              <div class="gstSummaryCell">GST Tax</div>
              <div class="gstSummaryCell">Amount</div>
            </div>
            ${gstRows || `<div class="gstSummaryRow"><div class="gstSummaryCell">-</div><div class="gstSummaryCell">${formatCurrency(invoice.taxableValue)}</div><div class="gstSummaryCell">0%</div><div class="gstSummaryCell">${formatCurrency(invoice.taxableValue)}</div></div>`}
          </div>

          <div class="termsBox">
            <div class="termsTitle">Terms & Conditions</div>
            <p class="termsText">1. All sales are final and refunds are not permitted.</p>
            <p class="termsText">2. We are not responsible for shortage, breakdown, transit loss, or damage after dispatch.</p>
            <p class="termsText">3. Goods once sold will not be taken back unless covered by a separate written agreement.</p>
            <p class="termsText">4. This is a computer generated tax invoice.</p>
          </div>

          <div class="footer">
            <div class="computerBox">This is a Computer Generated Invoice</div>
            <div class="signBox">For ${businessProfile?.tradeName || "Company"}<br/><br/>Authorised signatory</div>
          </div>
        </div>
      </body>
    </html>
  `;
}

export function buildInvoiceHtml({ businessProfile, invoice, order }) {
  const grandTotal = getInvoiceTotal(invoice);
  const paidAmount = getInvoicePaidAmount(invoice);
  const remainingAmount = Math.max(0, grandTotal - paidAmount);
  const paymentPercent = paymentProgress(invoice);
  const partyPhone = getInvoicePartyPhone(invoice, order);
  const partyEmail = getInvoicePartyEmail(invoice, order);
  const isPurchase = order?.type === "purchase" || String(invoice.invoiceType || "").toLowerCase() === "purchase";
  const partyIdentity = getInvoicePartyIdentity(invoice, order);
  const cityLine = joinInvoiceParts([businessProfile?.city, businessProfile?.state, businessProfile?.pincode]);
  const businessContact = joinInvoiceParts([businessProfile?.mobile, businessProfile?.email], " · ");
  const businessTax = joinInvoiceParts([
    businessProfile?.gstin ? `GSTIN ${businessProfile.gstin}` : null,
    businessProfile?.pan ? `PAN ${businessProfile.pan}` : null,
  ], " · ");
  const hasBankDetails = [businessProfile?.bankName, businessProfile?.accountNumber, businessProfile?.ifsc, businessProfile?.upiId].some(hasInvoiceValue);
  const items = (order?.items || []).map((item) => {
    const subtotal = Number(item.quantity || 0) * Number(item.rate || 0);
    const tax = (subtotal * Number(item.gstRate || 0)) / 100;
    return { name: item.productName || item.productSku || `Product ${item.productId}`, sku: cleanInvoiceValue(item.productSku || item.sku), hsn: cleanInvoiceValue(item.hsnCode), quantity: item.quantity || 0, unit: item.unitLabel || item.packageSizeUnit || "Nos", rate: Number(item.rate || 0), taxRate: Number(item.gstRate || 0), tax, subtotal, total: subtotal + tax };
  });
  const rows = items.map((item, index) => `<tr><td>${index + 1}</td><td class="item"><b>${item.name}</b>${item.sku ? `<small>SKU: ${item.sku}</small>` : ""}</td><td>${item.hsn}</td><td>${item.quantity}</td><td>${item.unit}</td><td>${formatCurrency(item.rate)}</td><td>${formatCurrency(invoice.discount || 0)}</td><td>${item.taxRate}%</td><td>${formatCurrency(item.tax)}</td><td class="amount">${formatCurrency(item.total)}</td></tr>`).join("");
  const info = (label, value, className = "") => {
    const displayValue = cleanInvoiceValue(value);
    return displayValue ? `<div class="info"><span>${label}</span><b class="${className}">${displayValue}</b></div>` : "";
  };
  const invoiceCopy = invoice.isReverse ? "REVERSE / CREDIT COPY" : String(invoice.status || "").toLowerCase() === "draft" ? "DRAFT" : "ORIGINAL FOR RECIPIENT";
  const bankDetails = hasBankDetails ? `<div class="bank"><div class="eyebrow">BANK DETAILS</div>${info("Bank name", businessProfile?.bankName)}${info("Account name", businessProfile?.legalName || businessProfile?.tradeName)}${info("Account number", businessProfile?.accountNumber)}${info("IFSC", businessProfile?.ifsc)}${info("UPI ID", businessProfile?.upiId)}</div>` : "";
  return `<!doctype html>
  <html><head><meta charset="utf-8"><title>${invoice.invoiceNumber || "Tax Invoice"}</title><style>
  @page{size:A4 portrait;margin:7mm}*{box-sizing:border-box}html,body{margin:0;padding:0;color:#10203a;font-family:Arial,sans-serif;-webkit-print-color-adjust:exact;print-color-adjust:exact}body{background:#fff;font-size:8px}.page{width:100%;border:1px solid #dce4ef;border-radius:12px;padding:12px}.header{display:grid;grid-template-columns:1.15fr .8fr 1fr;gap:12px;border-bottom:1px solid #dce4ef;padding-bottom:12px}.brand{display:flex;align-items:center;gap:8px;margin-bottom:7px}.logo{background:#2563eb;color:#fff;border-radius:8px;padding:10px 8px;font-weight:900;font-size:13px}.company h1{font-size:15px;margin:0}.company p,.contact{color:#52627a;line-height:1.45;margin:2px 0}.title{text-align:center;align-self:center}.title h2{font-size:22px;letter-spacing:.8px;margin:0}.copy{display:inline-block;margin-top:9px;padding:5px 9px;border:1px solid #bfdbfe;border-radius:6px;background:#eff6ff;color:#1d4ed8;font-weight:900}.meta{border-left:1px solid #dce4ef;padding-left:12px}.info{display:flex;justify-content:space-between;gap:8px;margin:0 0 5px;line-height:1.35}.info span{color:#64748b}.info b{text-align:right}.info .primary{color:#1d4ed8;font-size:11px}.cards{display:grid;grid-template-columns:1fr 1fr 1fr;gap:7px;margin-top:10px}.card{border:1px solid #dce4ef;border-radius:10px;padding:9px;min-height:118px}.eyebrow{color:#1e3a8a;font-size:7px;font-weight:900;letter-spacing:.45px;margin:0 0 8px}.customer{font-size:11px;margin:0 0 6px}.type{color:#64748b;font-size:7px}.items{width:100%;border-collapse:separate;border-spacing:0;margin-top:10px;border:1px solid #dce4ef;border-radius:9px;overflow:hidden;table-layout:fixed}.items thead{display:table-header-group}.items th{background:#eff6ff;color:#1d4ed8;font-size:6.5px;padding:6px 3px;border-right:1px solid #dce4ef}.items td{padding:7px 3px;border-right:1px solid #dce4ef;border-top:1px solid #dce4ef;text-align:center;vertical-align:middle;line-height:1.35;word-break:break-word}.items tr:nth-child(even) td{background:#f8fafc}.items tr{break-inside:avoid}.items th:last-child,.items td:last-child{border-right:0}.items .item{text-align:left;width:23%}.items .amount{font-weight:900}.items small{display:block;color:#64748b;margin-top:2px}.summary{display:grid;grid-template-columns:1.35fr .85fr;gap:9px;margin-top:10px;break-inside:avoid}.words,.bank,.payqr,.totals,.payment,.terms{border:1px solid #dce4ef;border-radius:9px;padding:9px}.words b{display:block;font-size:10px;margin-top:5px}.lower{display:grid;grid-template-columns:1fr 1fr;gap:7px;margin-top:7px}.qrbox{height:45px;width:45px;margin:3px auto 6px;display:flex;align-items:center;justify-content:center;background:#eff6ff;border:1px solid #bfdbfe;border-radius:7px;color:#1d4ed8;font-weight:900}.qrnote{text-align:center;color:#64748b;line-height:1.35}.right{display:flex;flex-direction:column;gap:7px}.totalrow{display:flex;justify-content:space-between;margin-bottom:5px}.grand{background:#eff6ff;color:#1d4ed8;font-size:12px;font-weight:900;margin:8px -9px -9px;padding:9px}.success{color:#16a34a}.danger{color:#dc2626}.terms{margin-top:10px;break-inside:avoid}.terms p{color:#52627a;margin:3px 0;line-height:1.35}.signature{display:grid;grid-template-columns:1fr 1fr 1fr;align-items:end;gap:10px;margin-top:10px;padding:10px;background:#f8fafc;border-radius:9px;break-inside:avoid}.center{text-align:center}.rightalign{text-align:right}.footer{display:flex;justify-content:space-between;margin-top:9px;padding:6px 9px;background:#eff6ff;color:#52627a;border-radius:6px;font-size:7px}.blue{color:#1d4ed8;font-weight:900}@media print{.page{border:0;padding:0}.items{page-break-inside:auto}.cards,.summary,.terms,.signature{page-break-inside:avoid}}
  </style></head><body><main class="page">
  <section class="header"><div class="company"><div class="brand"><div class="logo">${businessProfile?.logoText || "ERP"}</div><div><h1>${businessProfile?.tradeName || businessProfile?.legalName || "Company"}</h1>${hasInvoiceValue(businessProfile?.legalName) ? `<p>${businessProfile.legalName}</p>` : ""}</div></div>${hasInvoiceValue(businessProfile?.billingAddress) ? `<p>${businessProfile.billingAddress}</p>` : ""}${hasInvoiceValue(cityLine) ? `<p>${cityLine}</p>` : ""}${hasInvoiceValue(businessContact) ? `<p class="contact">${businessContact}</p>` : ""}${hasInvoiceValue(businessTax) ? `<p class="contact">${businessTax}</p>` : ""}</div><div class="title"><h2>TAX INVOICE</h2><div class="copy">${invoiceCopy}</div></div><div class="meta">${info("Invoice No.", invoice.invoiceNumber || invoice.id, "primary")}${info("Invoice Date", formatDate(invoice.date))}${info("Due Date", formatDate(invoice.dueDate))}${info("Place of Supply", invoice.placeOfSupply || businessProfile?.state)}${info("Invoice Type", invoice.invoiceType || "GST Tax Invoice")}${info("Payment Status", invoice.paymentStatus || "Unpaid")}</div></section>
  <section class="cards"><div class="card"><div class="eyebrow">${isPurchase ? "SUPPLIER" : "BILL TO"}</div><h3 class="customer">${invoice.partyName || "Customer"} <span class="type">${partyIdentity.category} · ${partyIdentity.role}</span></h3>${info("Customer code", invoice.customerCode || order?.customerCode)}${info("Phone", partyPhone)}${info("Email", partyEmail)}${info("GSTIN", invoice.customerGstin || invoice.gstin)}${info("Address", invoice.customerAddress || order?.customerAddress)}</div><div class="card"><div class="eyebrow">SHIP TO</div>${info("Contact person", invoice.shippingContact || invoice.partyName)}${info("Shipping address", invoice.shippingAddress || invoice.customerAddress || order?.customerAddress)}${info("Phone", invoice.shippingPhone || partyPhone)}${info("State", invoice.shippingState)}${info("Country", invoice.shippingCountry || "India")}</div><div class="card"><div class="eyebrow">INVOICE DETAILS</div>${info("Order number", invoice.orderNumber || order?.orderNumber || invoice.orderId)}${info("Quotation", invoice.quotationNumber)}${info("Delivery challan", invoice.deliveryChallan)}${info("Sales person", invoice.salesPerson)}${info("Payment terms", invoice.paymentTerms)}${info("Payment method", invoice.paymentMethod)}${info("Currency", businessProfile?.currency || "INR")}</div></section>
  <table class="items"><thead><tr><th style="width:4%">#</th><th style="width:23%">ITEM & DESCRIPTION</th><th style="width:9%">HSN/SAC</th><th style="width:6%">QTY</th><th style="width:6%">UNIT</th><th style="width:11%">UNIT PRICE</th><th style="width:7%">DISC.</th><th style="width:7%">TAX %</th><th style="width:12%">TAX AMOUNT</th><th style="width:15%">TOTAL</th></tr></thead><tbody>${rows || `<tr><td colspan="10">No order items linked</td></tr>`}</tbody></table>
  <section class="summary"><div><div class="words"><div class="eyebrow">AMOUNT IN WORDS</div><b>${numberToWords(grandTotal)} Only</b></div><div class="lower">${bankDetails}<div class="payqr"><div class="eyebrow">QR PAYMENT</div><div class="qrbox">UPI</div><div class="qrnote">${businessProfile?.upiId ? businessProfile.upiId : "UPI ID not configured"}<br>Scannable QR supplied by payment system only.</div></div></div></div><div class="right"><div class="totals">${[["Subtotal", invoice.taxableValue], ["Discount", invoice.discount || 0], ["Taxable amount", invoice.taxableValue], ["CGST", invoice.cgst], ["SGST", invoice.sgst], ["IGST", invoice.igst]].map(([l, v]) => `<div class="totalrow"><span>${l}</span><b>${formatCurrency(v)}</b></div>`).join("")}<div class="totalrow grand"><span>Grand Total</span><b>${formatCurrency(grandTotal)}</b></div></div><div class="payment">${info("Paid amount", formatCurrency(paidAmount), "success")}${info("Remaining amount", formatCurrency(remainingAmount), remainingAmount > 0 ? "danger" : "success")}${info("Payment percentage", `${paymentPercent}%`)}</div></div></section>
  <section class="terms"><div class="eyebrow">TERMS & CONDITIONS</div><p>1. Goods once sold are subject to the company return and warranty policy.</p><p>2. Applicable GST is charged as shown and payment is due by the stated due date.</p><p>3. Delayed payments may attract charges under the agreed commercial terms.</p><p>4. Disputes are subject to the jurisdiction of the seller’s registered office.</p></section><section class="signature"><div><div class="eyebrow">GENERATED BY</div><b>${invoice.createdBy || "ERP System"}</b></div><div class="center"><b class="blue">Computer Generated Invoice</b><br><span>No signature required</span></div><div class="rightalign"><b>Authorized Signature</b><br><span>${businessProfile?.tradeName || "Company"}</span></div></section><footer class="footer"><span>Generated ${formatDate(today)}</span><span>ERP Invoice · Digital tax document</span><span>Page 1</span></footer>
  </main></body></html>`;
}

const styles = StyleSheet.create({
  invoiceScreenRoot: {
    flex: 1,
    position: "relative",
  },
  screen: {
    flex: 1,
  },
  content: {
    paddingBottom: spacing.xl,
  },
  filterPanel: {
    gap: spacing.md,
    padding: spacing.md,
  },
  formCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  formTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "700",
  },
  helperText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  formErrorText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: "700",
  },
  twoColumn: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  flexItem: {
    flex: 1,
  },
  previewOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(15,23,42,0.3)",
    padding: spacing.md,
    zIndex: 40,
  },
  previewModal: {
    flexGrow: 1,
    justifyContent: "center",
  },
  previewDrawerOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "flex-end",
    backgroundColor: "rgba(15, 23, 42, 0.38)",
    justifyContent: "center",
    zIndex: 60,
  },
  previewDrawerBackdrop: {
    ...StyleSheet.absoluteFillObject,
  },
  previewDrawer: {
    backgroundColor: "#F8FAFC",
    borderLeftColor: "#CBD5E1",
    borderLeftWidth: 1,
    height: "100%",
    maxWidth: 780,
    shadowColor: "#0F172A",
    shadowOffset: { width: -12, height: 0 },
    shadowOpacity: 0.18,
    shadowRadius: 28,
    width: "68%",
  },
  previewDrawerCompact: {
    maxWidth: "100%",
    width: "100%",
  },
  previewDrawerContent: {
    padding: spacing.md,
  },
  paymentModalOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    backgroundColor: "rgba(15, 23, 42, 0.58)",
    justifyContent: "center",
    padding: spacing.lg,
    zIndex: 70,
  },
  paymentModal: {
    backgroundColor: "#FFFFFF",
    borderColor: "#CBD5E1",
    borderRadius: 20,
    borderWidth: 1,
    boxShadow: "0 24px 70px rgba(15, 23, 42, 0.28)",
    maxHeight: "90%",
    maxWidth: 920,
    overflow: "hidden",
    width: "82%",
  },
  paymentModalCompact: {
    maxHeight: "94%",
    width: "100%",
  },
  paymentModalTopbar: {
    alignItems: "center",
    borderBottomColor: "#E2E8F0",
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: 20,
    paddingVertical: 15,
  },
  paymentModalEyebrow: { color: "#2563EB", fontSize: 9, fontWeight: "700", letterSpacing: 0.8 },
  paymentModalTitle: { color: "#0F172A", fontSize: 18, fontWeight: "700", marginTop: 3 },
  paymentModalClose: { alignItems: "center", backgroundColor: "#F1F5F9", borderRadius: 18, height: 36, justifyContent: "center", width: 36 },
  paymentModalCloseText: { color: "#334155", fontSize: 22, fontWeight: "500", lineHeight: 24 },
  paymentModalContent: { backgroundColor: "#F8FAFC", padding: 18 },
  previewWrap: {
    paddingHorizontal: spacing.md,
  },
  invoiceSheet: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  invoiceHeader: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  invoiceSellerBox: {
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    padding: spacing.sm,
  },
  invoiceMetaBox: {
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
  },
  metaRowCompact: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  metaLabelCompact: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "600",
  },
  metaValueCompact: {
    color: colors.ink,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },
  invoicePartiesRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  invoicePartyBox: {
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    minHeight: 82,
    padding: spacing.sm,
  },
  sectionLabel: {
    color: colors.ink,
    fontSize: 11,
    fontWeight: "700",
    marginBottom: 4,
  },
  partyLine: {
    color: colors.ink,
    fontSize: 11,
    fontWeight: "700",
    lineHeight: 15,
  },
  itemsTableWrap: {
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: "hidden",
  },
  itemsTableHead: {
    backgroundColor: colors.background,
    flexDirection: "row",
  },
  itemsTableRow: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
  },
  itemsCell: {
    borderRightColor: colors.border,
    borderRightWidth: 1,
    color: colors.ink,
    fontSize: 10,
    fontWeight: "600",
    paddingHorizontal: 4,
    paddingVertical: 5,
  },
  colNo: { width: 32, textAlign: "center" },
  colDesc: { flex: 2 },
  colHsn: { width: 56, textAlign: "center" },
  colQty: { width: 52, textAlign: "center" },
  colRate: { width: 60, textAlign: "center" },
  colTax: { width: 58, textAlign: "center" },
  colAmount: { width: 68, textAlign: "center", borderRightWidth: 0 },
  totalsSection: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  amountWordsBox: {
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1.1,
    padding: spacing.sm,
  },
  amountWordsLabel: {
    color: colors.ink,
    fontSize: 10,
    fontWeight: "700",
  },
  amountWordsText: {
    color: colors.ink,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 4,
  },
  totalsBox: {
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 0.9,
    padding: spacing.sm,
  },
  gstSummaryBox: {
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    overflow: "hidden",
  },
  gstSummaryRow: {
    flexDirection: "row",
  },
  gstSummaryCell: {
    borderRightColor: colors.border,
    borderRightWidth: 1,
    color: colors.ink,
    flex: 1,
    fontSize: 9,
    fontWeight: "600",
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  termsBox: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 4,
    padding: spacing.sm,
  },
  termsTitle: {
    color: colors.ink,
    fontSize: 11,
    fontWeight: "700",
  },
  termsText: {
    color: colors.muted,
    fontSize: 10,
    lineHeight: 14,
  },
  list: {
    gap: spacing.md,
    paddingHorizontal: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.md,
  },
  cardHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  titleWrap: {
    flex: 1,
  },
  invoiceId: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "700",
  },
  party: {
    color: colors.muted,
    fontSize: 12,
    marginTop: spacing.xs,
  },
  statusBadge: {
    borderRadius: 99,
    fontSize: 11,
    fontWeight: "700",
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  paidBadge: {
    backgroundColor: colors.successSoft,
    color: colors.success,
  },
  pendingBadge: {
    backgroundColor: colors.warningSoft,
    color: colors.warning,
  },
  metaRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  meta: {
    backgroundColor: colors.background,
    borderRadius: 99,
    color: colors.muted,
    fontSize: 11,
    fontWeight: "600",
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  reverseMeta: {
    color: colors.danger,
  },
  invoiceItems: {
    backgroundColor: colors.background,
    borderRadius: radii.md,
    gap: spacing.sm,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  invoiceItemRow: {
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  invoiceItemName: {
    color: colors.ink,
    flex: 1,
    fontSize: 12,
    fontWeight: "600",
  },
  invoiceItemValue: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
  },
  taxBox: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  taxItem: {
    backgroundColor: colors.background,
    borderRadius: radii.md,
    minWidth: "47%",
    padding: spacing.sm,
  },
  taxLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
  },
  taxValue: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "700",
    marginTop: 3,
  },
  footer: {
    backgroundColor: colors.primaryDark,
    borderRadius: radii.md,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.md,
    padding: spacing.md,
  },
  footerLabel: {
    color: "#CBD5E1",
    fontSize: 10,
    fontWeight: "700",
  },
  footerValue: {
    color: colors.white,
    fontSize: 12,
    fontWeight: "700",
    marginTop: spacing.xs,
  },
  total: {
    color: colors.white,
    fontSize: 14,
    fontWeight: "700",
    marginTop: spacing.xs,
  },
  statusActions: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  actionRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  paidAction: {
    backgroundColor: colors.successSoft,
    borderRadius: radii.md,
    flex: 1,
    padding: spacing.sm,
  },
  unpaidAction: {
    backgroundColor: colors.warningSoft,
    borderRadius: radii.md,
    flex: 1,
    padding: spacing.sm,
  },
  paidActionText: {
    color: colors.success,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  unpaidActionText: {
    color: colors.warning,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  previewButton: {
    backgroundColor: colors.primarySoft,
    borderRadius: radii.md,
    flex: 1,
    padding: spacing.sm,
  },
  reverseButton: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radii.md,
    flex: 1,
    padding: spacing.sm,
  },
  shareButton: {
    backgroundColor: colors.successSoft,
    borderRadius: radii.md,
    flex: 1,
    padding: spacing.sm,
  },
  downloadButton: {
    backgroundColor: colors.warningSoft,
    borderRadius: radii.md,
    flex: 1,
    padding: spacing.sm,
  },
  saveButton: {
    backgroundColor: colors.successSoft,
    borderRadius: radii.md,
    flex: 1,
    padding: spacing.sm,
  },
  closeButton: {
    backgroundColor: colors.danger,
    borderRadius: radii.md,
    flex: 1,
    padding: spacing.sm,
  },
  previewText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  reverseText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  shareText: {
    color: colors.success,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  downloadText: {
    color: colors.warning,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  saveText: {
    color: colors.success,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  closeText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  deleteButton: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radii.md,
    marginTop: spacing.md,
    padding: spacing.sm,
  },
  deleteText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  pagination: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  previewCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
    width: "100%",
  },
  previewTopBar: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  previewTitle: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: "700",
  },
  previewSubtitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  previewActionRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  previewHeader: {
    flexDirection: "row",
    gap: spacing.md,
  },
  previewLogo: {
    alignItems: "center",
    backgroundColor: colors.primaryDark,
    borderRadius: 22,
    height: 68,
    justifyContent: "center",
    width: 68,
  },
  previewLogoText: {
    color: colors.white,
    fontSize: 18,
    fontWeight: "700",
  },
  previewCompany: {
    flex: 1,
  },
  previewTrade: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "700",
  },
  previewLegal: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },
  previewSmall: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 17,
    marginTop: 2,
  },
  previewDivider: {
    backgroundColor: colors.border,
    height: 1,
    marginVertical: spacing.md,
  },
  partyGrid: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  partyCard: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    gap: 4,
    padding: spacing.md,
  },
  partyLabel: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 1,
  },
  partyValue: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "700",
  },
  previewMetaGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  previewMeta: {
    backgroundColor: colors.background,
    borderRadius: radii.md,
    minWidth: "47%",
    padding: spacing.sm,
  },
  previewMetaLabel: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "600",
  },
  previewMetaValue: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 3,
  },
  billBox: {
    backgroundColor: colors.primarySoft,
    borderRadius: radii.md,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  billTitle: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "700",
  },
  billName: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "700",
    marginTop: spacing.xs,
  },
  previewItems: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  previewTableHead: {
    backgroundColor: colors.background,
    borderRadius: radii.md,
    flexDirection: "row",
    gap: spacing.xs,
    padding: spacing.sm,
  },
  previewTableHeadText: {
    color: colors.muted,
    flex: 1,
    fontSize: 11,
    fontWeight: "700",
  },
  previewItem: {
    backgroundColor: colors.background,
    borderRadius: radii.md,
    padding: spacing.sm,
  },
  previewItemTop: {
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  previewItemName: {
    color: colors.ink,
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
  },
  previewItemTotal: {
    color: colors.success,
    fontSize: 13,
    fontWeight: "700",
  },
  previewTableCell: {
    color: colors.muted,
    flex: 1,
    fontSize: 11,
    fontWeight: "700",
  },
  previewTableCellStrong: {
    color: colors.ink,
    flex: 1,
    fontSize: 11,
    fontWeight: "700",
  },
  previewTotals: {
    backgroundColor: colors.primaryDark,
    borderRadius: radii.md,
    gap: spacing.xs,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  previewTotalRow: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  previewTotalLabel: {
    color: "#475569",
    fontSize: 8,
    fontWeight: "700",
  },
  previewTotalValue: {
    color: "#0F172A",
    fontSize: 8,
    fontWeight: "700",
  },
  previewGrandLabel: {
    color: "#1D4ED8",
    fontSize: 11,
    fontWeight: "700",
  },
  previewGrandValue: {
    color: "#1D4ED8",
    fontSize: 13,
  },
  termsBox: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: 4,
    padding: spacing.md,
  },
  termsTitle: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "700",
  },
  termsText: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 16,
  },
  enterprisePage: {
    gap: 18,
    paddingHorizontal: spacing.md,
  },
  enterpriseHero: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#E2E8F0",
    borderRadius: 16,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 22,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
  },
  enterpriseHeroCompact: {
    alignItems: "flex-start",
    gap: 18,
    flexDirection: "column",
  },
  heroCopy: {
    flex: 1,
  },
  breadcrumb: {
    color: "#2563EB",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.9,
  },
  heroTitle: {
    color: "#0F172A",
    fontSize: 24,
    fontWeight: "700",
    letterSpacing: -0.6,
    marginTop: 7,
  },
  heroSubtitle: {
    color: "#64748B",
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 19,
    marginTop: 5,
  },
  heroActions: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
  },
  primaryToolbarButton: {
    alignItems: "center",
    backgroundColor: "#2563EB",
    borderRadius: 12,
    flexDirection: "row",
    gap: 8,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 16,
    shadowColor: "#2563EB",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 12,
  },
  primaryToolbarButtonIcon: {
    color: "#FFFFFF",
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 20,
  },
  primaryToolbarButtonText: {
    color: "#FFFFFF",
    fontSize: 12,
    fontWeight: "700",
  },
  secondaryToolbarButton: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#CBD5E1",
    borderRadius: 12,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 42,
    paddingHorizontal: 16,
  },
  secondaryToolbarButtonText: {
    color: "#334155",
    fontSize: 12,
    fontWeight: "700",
  },
  metricRail: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    paddingBottom: 3,
  },
  metricCardEnterprise: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E2E8F0",
    borderRadius: 16,
    borderWidth: 1,
    minHeight: 154,
    padding: 15,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 5 },
    shadowOpacity: 0.045,
    shadowRadius: 14,
    flexGrow: 0,
    minWidth: 0,
  },
  metricCardTop: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  metricIconEnterprise: {
    alignItems: "center",
    borderRadius: 11,
    height: 34,
    justifyContent: "center",
    width: 34,
  },
  metricIconDot: {
    borderRadius: 4,
    height: 8,
    width: 8,
  },
  metricPercent: {
    fontSize: 11,
    fontWeight: "700",
  },
  metricLabelEnterprise: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "600",
    marginTop: 13,
  },
  metricValueEnterprise: {
    color: "#0F172A",
    fontSize: 21,
    fontWeight: "700",
    letterSpacing: -0.35,
    marginTop: 4,
  },
  metricMetaEnterprise: {
    color: "#94A3B8",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 4,
  },
  metricProgressTrack: {
    backgroundColor: "#EEF2F7",
    borderRadius: 999,
    height: 4,
    marginTop: 12,
    overflow: "hidden",
  },
  metricProgressFill: {
    borderRadius: 999,
    height: 4,
  },
  createPanel: {
    backgroundColor: "#FFFFFF",
    borderColor: "#BFDBFE",
    borderRadius: 16,
    borderWidth: 1,
    gap: 15,
    padding: 20,
    shadowColor: "#2563EB",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
  },
  createPanelHeading: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  createPanelIcon: {
    alignItems: "center",
    backgroundColor: "#EFF6FF",
    borderRadius: 12,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  createPanelIconText: {
    color: "#2563EB",
    fontSize: 18,
    fontWeight: "700",
  },
  createPanelCopy: { flex: 1 },
  createPanelTitle: {
    color: "#0F172A",
    fontSize: 17,
    fontWeight: "700",
  },
  createPanelSubtitle: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 3,
  },
  createFormGrid: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: 14,
  },
  createFormGridCompact: {
    alignItems: "stretch",
    flexDirection: "column",
  },
  createOrderField: { flex: 1 },
  createDateField: { minWidth: 220 },
  createOptionsRow: {
    flexDirection: "row",
    gap: 18,
  },
  createOptionsRowCompact: {
    flexDirection: "column",
  },
  createOptionGroup: {
    flex: 1,
    gap: 7,
  },
  optionLabel: {
    color: "#475569",
    fontSize: 11,
    fontWeight: "700",
  },
  createSubmitRow: {
    alignItems: "flex-end",
  },
  compactInvoiceFilter: {
    backgroundColor: "#FFFFFF",
    borderColor: "#DCE6F2",
    borderRadius: 16,
    borderWidth: 1,
    boxShadow: "0 8px 24px rgba(15, 23, 42, 0.05)",
    gap: 15,
    padding: 16,
    position: "relative",
    zIndex: 20,
  },
  compactFilterHeading: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 10, justifyContent: "space-between" },
  compactFilterControls: { alignItems: "flex-end", flexDirection: "row", gap: 12 },
  compactFilterControlsMobile: { alignItems: "stretch", flexDirection: "column" },
  compactUniversalSearch: { flex: 1.8, gap: 7, minWidth: 260 },
  compactStatusPicker: { flex: 0.9, minWidth: 190 },
  compactSortPicker: { flex: 0.9, minWidth: 190 },
  compactControlLabel: { color: "#0F172A", fontSize: 13, fontWeight: "700" },
  compactResetButton: { backgroundColor: "#EFF6FF", borderColor: "#BFDBFE", borderRadius: 999, borderWidth: 1, paddingHorizontal: 12, paddingVertical: 8 },
  compactResetText: { color: "#1D4ED8", fontSize: 10, fontWeight: "700" },
  filterWorkspace: {
    backgroundColor: "#FFFFFF",
    borderColor: "#DCE6F2",
    borderRadius: 18,
    borderWidth: 1,
    boxShadow: "0 10px 30px rgba(15, 23, 42, 0.06)",
    gap: 14,
    padding: 18,
  },
  filterWorkspaceHeader: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: 12, justifyContent: "space-between" },
  filterHeadingGroup: { alignItems: "center", flexDirection: "row", gap: 11 },
  filterHeadingIcon: { alignItems: "center", backgroundColor: "#EFF6FF", borderRadius: 11, height: 38, justifyContent: "center", width: 38 },
  filterHeadingIconText: { color: "#2563EB", fontSize: 20, fontWeight: "700" },
  filterWorkspaceTitle: { color: "#0F172A", fontSize: 16, fontWeight: "700" },
  filterWorkspaceSubtitle: { color: "#64748B", fontSize: 10, fontWeight: "600", marginTop: 3 },
  filterHeaderMeta: { alignItems: "center", flexDirection: "row", gap: 9 },
  filterActiveBadge: { backgroundColor: "#EFF6FF", borderColor: "#BFDBFE", borderRadius: 999, borderWidth: 1, paddingHorizontal: 10, paddingVertical: 6 },
  filterActiveBadgeText: { color: "#1D4ED8", fontSize: 9, fontWeight: "700" },
  filterSortLabel: { color: "#475569", fontSize: 10, fontWeight: "600" },
  quickFilterRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  quickFilterButton: { alignItems: "center", backgroundColor: "#F8FAFC", borderColor: "#E2E8F0", borderRadius: 10, borderWidth: 1, flexDirection: "row", gap: 8, minHeight: 38, paddingHorizontal: 12 },
  quickFilterButtonActive: { backgroundColor: "#2563EB", borderColor: "#2563EB" },
  quickFilterPaid: { backgroundColor: "#15803D", borderColor: "#15803D" },
  quickFilterOverdue: { backgroundColor: "#DC2626", borderColor: "#DC2626" },
  quickFilterPartial: { backgroundColor: "#D97706", borderColor: "#D97706" },
  quickFilterLabel: { color: "#475569", fontSize: 10, fontWeight: "600" },
  quickFilterLabelActive: { color: "#FFFFFF" },
  quickFilterCount: { alignItems: "center", backgroundColor: "#E2E8F0", borderRadius: 999, justifyContent: "center", minWidth: 23, paddingHorizontal: 6, paddingVertical: 3 },
  quickFilterCountActive: { backgroundColor: "rgba(255, 255, 255, 0.2)" },
  quickFilterCountText: { color: "#475569", fontSize: 9, fontWeight: "700" },
  quickFilterCountTextActive: { color: "#FFFFFF" },
  searchRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 12,
  },
  searchRowCompact: {
    alignItems: "stretch",
    flexDirection: "column",
  },
  primarySearch: { flex: 1.7 },
  productSearch: { flex: 1 },
  invoiceSortRow: { alignItems: "center", backgroundColor: "#F8FAFC", borderColor: "#E2E8F0", borderRadius: 12, borderWidth: 1, flexDirection: "row", gap: 12, paddingHorizontal: 12, paddingVertical: 9 },
  invoiceSortTitle: { color: "#475569", fontSize: 10, fontWeight: "700", textTransform: "uppercase" },
  invoiceSortOptions: { flex: 1 },
  resultBar: {
    alignItems: "center",
    borderTopColor: "#E2E8F0",
    borderTopWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 12,
    justifyContent: "space-between",
    paddingTop: 14,
  },
  resultTitle: {
    color: "#0F172A",
    fontSize: 15,
    fontWeight: "700",
  },
  resultSubtitle: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 3,
  },
  enterpriseTableShell: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E2E8F0",
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.05,
    shadowRadius: 18,
  },
  enterpriseTable: {
    minWidth: 2015,
    width: 2015,
  },
  enterpriseTableHeader: {
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderBottomColor: "#CBD5E1",
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: 48,
    paddingHorizontal: 10,
  },
  enterpriseHeadText: {
    borderRightColor: "#E2E8F0",
    borderRightWidth: 1,
    color: "#475569",
    fontSize: 10,
    fontWeight: "700",
    letterSpacing: 0.45,
    paddingHorizontal: 8,
    textTransform: "uppercase",
  },
  enterpriseHeadCenter: {
    textAlign: "center",
  },
  enterpriseTableRow: {
    alignItems: "stretch",
    borderBottomColor: "#E2E8F0",
    borderBottomWidth: 1,
    flexDirection: "row",
    minHeight: 108,
    paddingHorizontal: 10,
  },
  enterpriseTableRowAlternate: {
    backgroundColor: "#F8FAFC",
  },
  enterpriseCell: {
    borderRightColor: "#EDF2F7",
    borderRightWidth: 1,
    justifyContent: "center",
    paddingHorizontal: 8,
    paddingVertical: 12,
  },
  enterpriseCellCenter: {
    alignItems: "center",
  },
  colInvoice: { flexShrink: 0, width: 230 },
  colCustomer: { flexShrink: 0, width: 205 },
  colProducts: { flexShrink: 0, width: 210 },
  colDate: { flexShrink: 0, width: 105 },
  colType: { flexShrink: 0, width: 120 },
  colStatus: { flexShrink: 0, width: 135 },
  colAmountTable: { flexShrink: 0, width: 120 },
  colCredit: { flexShrink: 0, width: 145 },
  colPaymentPercent: { flexShrink: 0, width: 95 },
  colPaymentAction: { flexShrink: 0, width: 120 },
  colActions: { flexShrink: 0, width: 285 },
  invoiceIdentityCell: {
    alignItems: "center",
    flexDirection: "row",
    gap: 10,
  },
  invoiceThumbnail: {
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    borderRadius: 9,
    borderWidth: 1,
    height: 50,
    flexShrink: 0,
    justifyContent: "center",
    paddingHorizontal: 7,
    width: 42,
  },
  invoiceThumbnailText: {
    color: "#2563EB",
    fontSize: 9,
    fontWeight: "700",
  },
  invoiceThumbnailLine: {
    backgroundColor: "#93C5FD",
    borderRadius: 2,
    height: 2,
    marginTop: 5,
    width: 26,
  },
  invoiceThumbnailLineShort: {
    backgroundColor: "#BFDBFE",
    borderRadius: 2,
    height: 2,
    marginTop: 4,
    width: 17,
  },
  invoiceIdentityCopy: { flex: 1 },
  invoiceNumberLink: {
    color: "#1D4ED8",
    fontSize: 12,
    fontWeight: "700",
  },
  invoiceSecondary: {
    color: "#64748B",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 4,
  },
  invoiceTypeMini: {
    alignSelf: "flex-start",
    backgroundColor: "#F1F5F9",
    borderRadius: 999,
    color: "#475569",
    fontSize: 8,
    fontWeight: "700",
    marginTop: 5,
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  posSourceLabel: {
    alignSelf: "flex-start",
    backgroundColor: "#E0F2FE",
    borderRadius: 999,
    color: "#0369A1",
    fontSize: 9,
    fontWeight: "800",
    marginTop: 3,
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  reverseLabel: {
    color: "#7C3AED",
    fontSize: 8,
    fontWeight: "700",
    letterSpacing: 0.6,
    marginTop: 4,
  },
  customerCell: {
    alignItems: "center",
    flexDirection: "row",
    gap: 9,
  },
  customerAvatar: {
    alignItems: "center",
    backgroundColor: "#E0E7FF",
    borderRadius: 18,
    height: 36,
    flexShrink: 0,
    justifyContent: "center",
    width: 36,
  },
  customerAvatarText: {
    color: "#4338CA",
    fontSize: 12,
    fontWeight: "700",
  },
  customerCopy: { flex: 1 },
  customerName: {
    color: "#0F172A",
    fontSize: 11,
    fontWeight: "700",
  },
  customerMeta: {
    color: "#64748B",
    fontSize: 10,
    fontWeight: "700",
    marginTop: 4,
  },
  customerDetail: {
    color: "#94A3B8",
    fontSize: 8,
    fontWeight: "700",
    marginTop: 3,
  },
  partyIdentity: {
    alignSelf: "flex-start",
    backgroundColor: "#EFF6FF",
    borderRadius: 999,
    color: "#1D4ED8",
    fontSize: 8,
    fontWeight: "700",
    marginTop: 4,
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  productSummary: {
    gap: 3,
  },
  productSummaryName: {
    color: "#334155",
    fontSize: 10,
    fontWeight: "600",
  },
  productSummaryMore: {
    color: "#2563EB",
    fontSize: 9,
    fontWeight: "700",
    marginTop: 2,
  },
  productSummaryEmpty: {
    color: "#94A3B8",
    fontSize: 10,
    fontStyle: "italic",
  },
  datePrimary: {
    color: "#334155",
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
  },
  dateSecondary: {
    color: "#94A3B8",
    fontSize: 9,
    fontWeight: "700",
    marginTop: 4,
    textAlign: "center",
  },
  pastDueText: {
    color: "#DC2626",
    fontWeight: "700",
  },
  typePrimary: {
    color: "#334155",
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
  },
  enterpriseBadge: {
    alignItems: "center",
    alignSelf: "center",
    borderRadius: 999,
    flexDirection: "row",
    gap: 6,
    paddingHorizontal: 9,
    paddingVertical: 6,
  },
  enterpriseBadgeDot: {
    borderRadius: 4,
    height: 6,
    width: 6,
  },
  enterpriseBadgeText: {
    fontSize: 9,
    fontWeight: "700",
  },
  paymentProgressWrap: {
    gap: 7,
  },
  paymentProgressLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  paymentProgressValue: {
    color: "#334155",
    fontSize: 9,
    fontWeight: "700",
  },
  paymentProgressRemaining: {
    color: "#94A3B8",
    fontSize: 9,
    fontWeight: "700",
  },
  paymentProgressTrack: {
    backgroundColor: "#E2E8F0",
    borderRadius: 999,
    height: 6,
    overflow: "hidden",
  },
  paymentProgressFill: {
    borderRadius: 999,
    height: 6,
  },
  paymentTypography: {
    gap: 3,
  },
  paymentPaidText: {
    fontSize: 11,
    fontWeight: "700",
  },
  paymentRemainingText: {
    color: "#64748B",
    fontSize: 10,
    fontWeight: "700",
  },
  paymentPercentText: {
    fontSize: 10,
    fontWeight: "700",
  },
  paymentPaidAmount: {
    color: "#15803D",
    fontSize: 11,
    fontWeight: "700",
  },
  paymentPercentStandalone: {
    fontSize: 13,
    fontWeight: "700",
  },
  paymentActionHint: {
    color: "#DC2626",
    fontSize: 8,
    fontWeight: "600",
    marginTop: 5,
    textAlign: "center",
  },
  paymentActionCell: {
    alignItems: "center",
    paddingHorizontal: 14,
  },
  creditValue: {
    fontSize: 11,
    fontWeight: "700",
    textAlign: "center",
  },
  creditLabel: {
    color: "#94A3B8",
    fontSize: 9,
    fontWeight: "700",
    marginTop: 4,
    textAlign: "center",
  },
  remainingCreditCell: {
    alignItems: "center",
  },
  remainingCreditContent: {
    alignItems: "center",
    justifyContent: "center",
  },
  amountPrimary: {
    color: "#334155",
    fontSize: 11,
    fontWeight: "600",
  },
  amountSecondary: {
    color: "#64748B",
    fontSize: 11,
    fontWeight: "600",
  },
  amountGrand: {
    color: "#0F172A",
    fontSize: 12,
    fontWeight: "700",
  },
  tableActionCell: {
    alignItems: "center",
    borderRightWidth: 0,
    gap: 6,
    justifyContent: "center",
  },
  tableActionRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: 6,
    justifyContent: "center",
    minHeight: 32,
    width: "100%",
  },
  tableActionButton: {
    flexBasis: 76,
    flexGrow: 1,
    maxWidth: 112,
    minWidth: 68,
  },
  actionsHeaderCell: {
    borderRightWidth: 0,
    textAlign: "center",
  },
  invoiceAction: {
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderColor: "#E2E8F0",
    borderRadius: 9,
    borderWidth: 1,
    flexDirection: "row",
    gap: 5,
    height: 32,
    justifyContent: "center",
    paddingHorizontal: 8,
  },
  invoiceActionPrimary: {
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
  },
  invoiceActionSuccess: {
    backgroundColor: "#F0FDF4",
    borderColor: "#BBF7D0",
  },
  invoiceActionPayment: {
    backgroundColor: "#2563EB",
    borderColor: "#2563EB",
  },
  invoiceActionDanger: {
    backgroundColor: "#FEF2F2",
    borderColor: "#FECACA",
  },
  invoiceActionDisabled: { opacity: 0.45 },
  invoiceActionSymbol: {
    color: "#475569",
    fontSize: 14,
    fontWeight: "700",
  },
  invoiceActionLabel: {
    color: "#475569",
    fontSize: 9,
    fontWeight: "700",
  },
  invoiceActionSymbolPrimary: { color: "#2563EB" },
  invoiceActionSymbolSuccess: { color: "#16A34A" },
  invoiceActionSymbolPayment: { color: "#FFFFFF" },
  invoiceActionSymbolDanger: { color: "#DC2626" },
  enterpriseCardList: {
    gap: 14,
  },
  enterpriseInvoiceCard: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E2E8F0",
    borderRadius: 16,
    borderWidth: 1,
    gap: 15,
    padding: 16,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 7 },
    shadowOpacity: 0.05,
    shadowRadius: 16,
  },
  mobileCardTop: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: 10,
    justifyContent: "space-between",
  },
  mobileInvoiceIdentity: {
    alignItems: "center",
    flex: 1,
    flexDirection: "row",
    gap: 10,
  },
  mobileCustomerRow: {
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    flexDirection: "row",
    gap: 10,
    padding: 10,
  },
  mobileDateGrid: {
    flexDirection: "row",
    gap: 10,
  },
  mobileMetaBlock: {
    backgroundColor: "#F8FAFC",
    borderRadius: 10,
    flex: 1,
    padding: 10,
  },
  mobileMetaLabel: {
    color: "#64748B",
    fontSize: 9,
    fontWeight: "600",
    textTransform: "uppercase",
  },
  mobileMetaValue: {
    color: "#0F172A",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 4,
  },
  mobileAmountGrid: {
    alignItems: "flex-end",
    backgroundColor: "#F8FAFC",
    borderRadius: 12,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: 12,
  },
  mobileAmountValue: {
    color: "#334155",
    fontSize: 11,
    fontWeight: "700",
    marginTop: 4,
  },
  mobileGrandValue: {
    color: "#1D4ED8",
    fontSize: 14,
    fontWeight: "700",
    marginTop: 4,
  },
  mobilePaidValue: {
    color: "#15803D",
    fontSize: 12,
    fontWeight: "700",
    marginTop: 4,
  },
  mobileActionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  emptyState: {
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderColor: "#CBD5E1",
    borderRadius: 16,
    borderStyle: "dashed",
    borderWidth: 1,
    paddingHorizontal: 24,
    paddingVertical: 48,
  },
  emptyDocument: {
    alignItems: "center",
    backgroundColor: "#EFF6FF",
    borderColor: "#BFDBFE",
    borderRadius: 18,
    borderWidth: 1,
    height: 72,
    justifyContent: "center",
    width: 62,
  },
  emptyDocumentText: {
    color: "#2563EB",
    fontSize: 15,
    fontWeight: "700",
  },
  emptyTitle: {
    color: "#0F172A",
    fontSize: 19,
    fontWeight: "700",
    marginTop: 18,
  },
  emptySubtitle: {
    color: "#64748B",
    fontSize: 12,
    lineHeight: 18,
    marginTop: 6,
    maxWidth: 440,
    textAlign: "center",
  },
  emptyActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 10,
    justifyContent: "center",
    marginTop: 20,
  },
  skeletonPanel: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E2E8F0",
    borderRadius: 16,
    borderWidth: 1,
    overflow: "hidden",
  },
  skeletonRow: {
    alignItems: "center",
    borderBottomColor: "#E2E8F0",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 14,
    minHeight: 88,
    padding: 16,
  },
  skeletonSquare: {
    backgroundColor: "#E2E8F0",
    borderRadius: 10,
    height: 46,
    width: 42,
  },
  skeletonCopy: { flex: 1, gap: 8 },
  skeletonLineWide: {
    backgroundColor: "#E2E8F0",
    borderRadius: 5,
    height: 10,
    width: "44%",
  },
  skeletonLineShort: {
    backgroundColor: "#F1F5F9",
    borderRadius: 5,
    height: 8,
    width: "28%",
  },
  skeletonPill: {
    backgroundColor: "#E2E8F0",
    borderRadius: 999,
    height: 26,
    width: 88,
  },
  enterprisePagination: {
    backgroundColor: "#FFFFFF",
    borderColor: "#E2E8F0",
    borderRadius: 16,
    borderWidth: 1,
    padding: 12,
  },
  paymentReviewPanel: {
    alignItems: "center",
    backgroundColor: "#F8FAFC",
    borderColor: "#BFDBFE",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: 14,
    padding: 14,
  },
  paymentReviewPanelCompact: {
    alignItems: "stretch",
    flexDirection: "column",
  },
  paymentReviewCopy: { flex: 1.2 },
  paymentReviewEyebrow: { color: "#2563EB", fontSize: 8, fontWeight: "700", letterSpacing: 0.7 },
  paymentReviewTitle: { color: "#0F172A", fontSize: 14, fontWeight: "700", marginTop: 4 },
  paymentReviewSubtitle: { color: "#64748B", fontSize: 9, lineHeight: 13, marginTop: 3 },
  paymentReviewAmounts: { flex: 1.3, flexDirection: "row", flexWrap: "wrap", gap: 7 },
  paymentReviewMetric: { backgroundColor: "#FFFFFF", borderColor: "#E2E8F0", borderRadius: 9, borderWidth: 1, flex: 1, padding: 8 },
  paymentReviewLabel: { color: "#64748B", fontSize: 7, fontWeight: "600", textTransform: "uppercase" },
  paymentReviewValue: { color: "#0F172A", fontSize: 10, fontWeight: "700", marginTop: 4 },
  paymentReviewPaid: { color: "#16A34A", fontSize: 10, fontWeight: "700", marginTop: 4 },
  paymentReviewDue: { color: "#DC2626", fontSize: 11, fontWeight: "700", marginTop: 4 },
  paymentReviewButton: { alignItems: "center", backgroundColor: "#2563EB", borderRadius: 10, justifyContent: "center", minHeight: 42, paddingHorizontal: 14 },
  paymentReviewButtonText: { color: "#FFFFFF", fontSize: 10, fontWeight: "700" },
  paymentLifecycleCard: { backgroundColor: "#FFFFFF", borderColor: "#BFDBFE", borderRadius: 16, borderWidth: 1, gap: 16, padding: 16 },
  paymentLifecycleHeader: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
  paymentFormGrid: { gap: 12 },
  paymentMethodField: { gap: 7 },
  paymentFieldLabel: { color: "#0F172A", fontSize: 13, fontWeight: "700" },
  paymentNotesField: { width: "100%" },
  paymentHistorySection: { borderTopColor: "#E2E8F0", borderTopWidth: 1, gap: 10, paddingTop: 14 },
  paymentHistoryTitle: { color: "#0F172A", fontSize: 13, fontWeight: "700" },
  paymentHistoryEmpty: { color: "#64748B", fontSize: 11, paddingVertical: 10 },
  paymentTimelineRow: { alignItems: "center", backgroundColor: "#FFFFFF", borderColor: "#E2E8F0", borderRadius: 10, borderWidth: 1, flexDirection: "row", gap: 10, padding: 10 },
  paymentTimelineDot: { backgroundColor: "#2563EB", borderRadius: 5, height: 10, width: 10 },
  paymentTimelineCopy: { flex: 1, gap: 3 },
  paymentReceiptNumber: { color: "#1D4ED8", fontSize: 11, fontWeight: "700" },
  paymentTimelineMeta: { color: "#64748B", fontSize: 9, textTransform: "capitalize" },
  paymentTimelineAmount: { color: "#0F172A", fontSize: 11, fontWeight: "700" },
  paymentTimelineActions: { flexDirection: "row", gap: 6 },
  paymentLoadingBanner: { backgroundColor: "#EFF6FF", borderRadius: 9, paddingHorizontal: 12, paddingVertical: 9 },
  paymentLoadingText: { color: "#1D4ED8", fontSize: 10, fontWeight: "600" },
  premiumInvoiceSheet: {
    backgroundColor: "#FFFFFF",
    borderColor: "#DCE4EF",
    borderRadius: 16,
    borderWidth: 1,
    gap: 12,
    padding: 16,
    shadowColor: "#0F172A",
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
  },
  premiumHeader: {
    alignItems: "stretch",
    borderBottomColor: "#DCE4EF",
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: 14,
    paddingBottom: 14,
  },
  premiumStack: {
    alignItems: "stretch",
    flexDirection: "column",
  },
  premiumCompanyBlock: { flex: 1.15 },
  premiumBrandRow: { alignItems: "center", flexDirection: "row", gap: 9, marginBottom: 8 },
  premiumLogo: { alignItems: "center", backgroundColor: "#2563EB", borderRadius: 10, height: 42, justifyContent: "center", minWidth: 42, paddingHorizontal: 7 },
  premiumLogoText: { color: "#FFFFFF", fontSize: 12, fontWeight: "700", letterSpacing: 0.5 },
  premiumBrandCopy: { flex: 1 },
  premiumCompanyName: { color: "#0F172A", fontSize: 15, fontWeight: "700" },
  premiumCompanyLegal: { color: "#64748B", fontSize: 8, fontWeight: "700", marginTop: 2 },
  premiumAddress: { color: "#475569", fontSize: 8, lineHeight: 12 },
  premiumContact: { color: "#334155", fontSize: 8, fontWeight: "700", lineHeight: 12 },
  premiumTitleBlock: { alignItems: "center", flex: 0.9, justifyContent: "center" },
  premiumInvoiceTitle: { color: "#0F172A", fontSize: 24, fontWeight: "700", letterSpacing: 0.8 },
  premiumCopyBadge: { backgroundColor: "#EFF6FF", borderColor: "#BFDBFE", borderRadius: 7, borderWidth: 1, color: "#1D4ED8", fontSize: 8, fontWeight: "700", marginTop: 10, overflow: "hidden", paddingHorizontal: 10, paddingVertical: 6 },
  premiumInvoiceMeta: { borderLeftColor: "#DCE4EF", borderLeftWidth: 1, flex: 1, gap: 6, paddingLeft: 14 },
  premiumInvoiceMetaCompact: { borderLeftWidth: 0, borderTopColor: "#DCE4EF", borderTopWidth: 1, paddingLeft: 0, paddingTop: 12 },
  premiumCardGrid: { flexDirection: "row", gap: 8 },
  premiumDetailCard: { backgroundColor: "#FFFFFF", borderColor: "#DCE4EF", borderRadius: 12, borderWidth: 1, flex: 1, gap: 6, minWidth: 0, padding: 11 },
  premiumSectionEyebrow: { color: "#1E3A8A", fontSize: 8, fontWeight: "700", letterSpacing: 0.4 },
  premiumCustomerTitleRow: { alignItems: "center", flexDirection: "row", gap: 8, marginBottom: 3 },
  premiumAvatar: { alignItems: "center", backgroundColor: "#EAF2FF", borderRadius: 17, height: 34, justifyContent: "center", width: 34 },
  premiumAvatarText: { color: "#2563EB", fontSize: 13, fontWeight: "700" },
  premiumCustomerName: { color: "#0F172A", fontSize: 10, fontWeight: "700" },
  premiumCustomerType: { color: "#64748B", fontSize: 8, marginTop: 2 },
  premiumInfoRow: { alignItems: "flex-start", flexDirection: "row", gap: 6, justifyContent: "space-between" },
  premiumInfoLabel: { color: "#64748B", flex: 0.8, fontSize: 8, lineHeight: 11 },
  premiumInfoValue: { color: "#0F172A", flex: 1.2, fontSize: 8, fontWeight: "700", lineHeight: 11, textAlign: "right" },
  premiumInfoStrong: { color: "#1D4ED8", fontSize: 11, fontWeight: "700" },
  premiumValueSuccess: { color: "#16A34A", fontWeight: "700" },
  premiumValueDanger: { color: "#DC2626", fontWeight: "700" },
  premiumItemsScroll: { borderColor: "#DCE4EF", borderRadius: 10, borderWidth: 1 },
  premiumItemsTable: { minWidth: 1040 },
  premiumItemsHead: { backgroundColor: "#EFF6FF", flexDirection: "row" },
  premiumItemRow: { borderTopColor: "#DCE4EF", borderTopWidth: 1, flexDirection: "row", minHeight: 50 },
  premiumItemRowAlternate: { backgroundColor: "#F8FAFC" },
  premiumItemCell: { borderRightColor: "#DCE4EF", borderRightWidth: 1, color: "#334155", fontSize: 8, justifyContent: "center", paddingHorizontal: 5, paddingVertical: 8, textAlign: "center" },
  premiumItemHeadText: { color: "#1D4ED8", fontSize: 7, fontWeight: "700" },
  premiumItemDescription: { width: 190 },
  premiumItemNarrow: { width: 77 },
  premiumItemName: { color: "#0F172A", fontSize: 9, fontWeight: "700", textAlign: "left" },
  premiumItemSub: { color: "#64748B", fontSize: 7, lineHeight: 10, marginTop: 3, textAlign: "left" },
  premiumItemTotal: { color: "#0F172A", fontWeight: "700" },
  premiumEmptyItems: { alignItems: "center", justifyContent: "center", minHeight: 60 },
  premiumSummaryGrid: { alignItems: "stretch", flexDirection: "row", gap: 10 },
  premiumSummaryLeft: { flex: 1.35, gap: 10 },
  premiumSummaryRight: { flex: 0.9, gap: 8 },
  premiumWordsBox: { borderColor: "#DCE4EF", borderRadius: 10, borderWidth: 1, gap: 6, padding: 11 },
  premiumWords: { color: "#0F172A", fontSize: 10, fontWeight: "700", lineHeight: 14 },
  premiumLowerGrid: { flexDirection: "row", gap: 8 },
  premiumTotalsCard: { borderColor: "#DCE4EF", borderRadius: 10, borderWidth: 1, gap: 6, overflow: "hidden", padding: 11 },
  premiumPaymentCard: { borderColor: "#DCE4EF", borderRadius: 10, borderWidth: 1, gap: 7, padding: 11 },
  premiumQrPlaceholder: { alignItems: "center", alignSelf: "center", backgroundColor: "#EFF6FF", borderColor: "#BFDBFE", borderRadius: 8, borderWidth: 1, height: 58, justifyContent: "center", width: 58 },
  premiumQrMark: { color: "#1D4ED8", fontSize: 13, fontWeight: "700" },
  premiumQrTitle: { color: "#0F172A", fontSize: 8, fontWeight: "700", textAlign: "center" },
  premiumQrHint: { color: "#64748B", fontSize: 7, lineHeight: 10, textAlign: "center" },
  premiumTerms: { backgroundColor: "#F8FAFC", borderColor: "#DCE4EF", borderRadius: 10, borderWidth: 1, gap: 4, padding: 11 },
  premiumTerm: { color: "#475569", fontSize: 8, lineHeight: 12 },
  premiumFooter: { alignItems: "flex-end", backgroundColor: "#EFF6FF", borderRadius: 9, flexDirection: "row", justifyContent: "space-between", padding: 10 },
  premiumFooterCenter: { alignItems: "center" },
  premiumFooterLabel: { color: "#64748B", fontSize: 7, fontWeight: "700", marginTop: 2 },
  premiumFooterValue: { color: "#0F172A", fontSize: 8, fontWeight: "700", marginTop: 3 },
  premiumFooterStrong: { color: "#1D4ED8", fontSize: 8, fontWeight: "700" },
  premiumSignature: { alignItems: "flex-end" },
  notificationPanel: { backgroundColor: "#F8FAFC", borderColor: "#DCE4EF", borderRadius: 12, borderWidth: 1, gap: 10, marginBottom: 14, padding: 14 },
  notificationTitle: { color: "#0F172A", fontSize: 14, fontWeight: "700" },
  notificationHint: { color: "#64748B", fontSize: 11, marginTop: 3 },
  notificationRow: { alignItems: "center", borderTopColor: "#E2E8F0", borderTopWidth: 1, flexDirection: "row", justifyContent: "space-between", paddingTop: 10 },
  notificationChannel: { color: "#334155", fontSize: 12, fontWeight: "700" },
  notificationMeta: { color: "#64748B", fontSize: 10, marginTop: 2, maxWidth: 220 },
  notificationActions: { alignItems: "center", flexDirection: "row", gap: 8 },
  notificationBadge: { borderRadius: 99, fontSize: 10, fontWeight: "700", overflow: "hidden", paddingHorizontal: 8, paddingVertical: 4, textTransform: "capitalize" },
  notificationSent: { backgroundColor: "#DCFCE7", color: "#166534" },
  notificationFailed: { backgroundColor: "#FEE2E2", color: "#B91C1C" },
  notificationPending: { backgroundColor: "#FEF3C7", color: "#92400E" },
  notificationResend: { borderColor: "#BFDBFE", borderRadius: 7, borderWidth: 1, paddingHorizontal: 8, paddingVertical: 5 },
  notificationResendText: { color: "#1D4ED8", fontSize: 10, fontWeight: "700" },
  notificationAudit: { borderTopColor: "#E2E8F0", borderTopWidth: 1, gap: 4, paddingTop: 10 },
  notificationAuditTitle: { color: "#334155", fontSize: 11, fontWeight: "700" },
  notificationAuditEntry: { color: "#64748B", fontSize: 10, lineHeight: 15 },
});
