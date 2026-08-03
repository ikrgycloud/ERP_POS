import React, { useEffect, useMemo, useRef, useState } from "react";
import { Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { AppButton } from "../components/AppButton";
import { AdvancedFilterPanel } from "../components/AdvancedFilterPanel";
import { FilterBar } from "../components/FilterBar";
import { FilterChips } from "../components/FilterChips";
import { FilterSection } from "../components/FilterSection";
import { FormField } from "../components/FormField";
import { PaginationControls } from "../components/PaginationControls";
import { SearchInput } from "../components/SearchInput";
import { ScreenHeader } from "../components/ScreenHeader";
import { useModal } from "../components/ModalProvider";
import { colors, radii, spacing } from "../constants/theme";
import { formatCurrency, formatDate, formatNumber } from "../utils/formatters";

const PAGE_SIZE = 10;
const packagedTypes = new Set(["packets", "bags", "carton_boxes"]);
const statusFilters = ["All", "Active", "Expiring Soon", "Expired", "Missing Details"];
const dateFilters = ["All", "Today", "Last 7 Days", "Last 30 Days"];

function formatItemUnit(item) {
  if (!item?.unitType) {
    return `${item?.quantity || 0} units`;
  }
  if (packagedTypes.has(item.unitType)) {
    return `${item.packageCount || 0} ${item.unitLabel || "packs"} x ${item.packageSize || 1} ${item.packageSizeUnit || "units"}`;
  }
  return `${item.quantity || 0} ${item.unitLabel || "units"}`;
}

const emptyForm = {
  fromName: "",
  toName: "",
  transportMode: "Unspecified",
  vehicleNumber: "",
};

function safeNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function formatDisplayDate(value) {
  if (!value) {
    return "-";
  }
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return "-";
  }
  return formatDate(value);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function htmlText(value, fallback = "-") {
  const text = value === null || value === undefined ? fallback : String(value);
  return escapeHtml(text.trim() || fallback);
}

function getWaybillPdfFileName(waybill) {
  const baseName = waybill?.waybillNumber || `Waybill-${waybill?.id || "document"}`;
  const safeName = String(baseName)
    .trim()
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-");
  return `${safeName || "Waybill"}.pdf`;
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDatePresetStart(preset) {
  const now = new Date();
  if (preset === "Today") {
    return toDateKey(now);
  }
  if (preset === "Last 7 Days") {
    const start = new Date(now);
    start.setDate(start.getDate() - 6);
    return toDateKey(start);
  }
  if (preset === "Last 30 Days") {
    const start = new Date(now);
    start.setDate(start.getDate() - 29);
    return toDateKey(start);
  }
  return "";
}

function getGeneratedDateKey(waybill) {
  return waybill?.generatedAt ? String(waybill.generatedAt).slice(0, 10) : "";
}

function getWaybillViewState(waybill, nowTick) {
  const parsedValidUntilMs = waybill?.validUntil ? new Date(waybill.validUntil).getTime() : 0;
  const validUntilMs = Number.isFinite(parsedValidUntilMs) ? parsedValidUntilMs : 0;
  const remainingHours = validUntilMs ? Math.max(0, Math.ceil((validUntilMs - nowTick) / 3_600_000)) : 0;
  const expired = Boolean(waybill?.isExpired || waybill?.status === "Expired" || (validUntilMs && validUntilMs <= nowTick));
  const missingDetails = !String(waybill?.fromName || "").trim()
    || !String(waybill?.toName || "").trim()
    || !String(waybill?.vehicleNumber || "").trim()
    || !String(waybill?.transportMode || "").trim()
    || waybill?.transportMode === "Unspecified";
  const expiringSoon = !expired && remainingHours > 0 && remainingHours <= 4;
  const status = expired ? "Expired" : missingDetails ? "Missing Details" : expiringSoon ? "Expiring Soon" : "Active";
  const tone = expired ? "danger" : missingDetails ? "warning" : expiringSoon ? "warning" : "success";
  const validityText = expired ? "Expired" : remainingHours ? `${remainingHours} hrs left` : "Valid";

  return {
    expired,
    expiringSoon,
    missingDetails,
    remainingHours,
    status,
    tone,
    validityText,
  };
}

export function WaybillsScreen({ businessProfile, isBusy, waybills, onDeleteWaybill, onUpdateWaybill }) {
  const modal = useModal();
  const scrollRef = useRef(null);
  const hasMountedRef = useRef(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("All");
  const [dateFilter, setDateFilter] = useState("All");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [previewWaybill, setPreviewWaybill] = useState(null);
  const [editingWaybill, setEditingWaybill] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [nowTick, setNowTick] = useState(Date.now());
  const [busyAction, setBusyAction] = useState("");
  const [formError, setFormError] = useState("");

  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const normalizedWaybills = useMemo(
    () => (waybills || []).map((waybill) => ({
      ...waybill,
      viewState: getWaybillViewState(waybill, nowTick),
    })),
    [nowTick, waybills]
  );

  const waybillSummary = useMemo(() => normalizedWaybills.reduce(
    (summary, waybill) => ({
      active: summary.active + (waybill.viewState.status === "Active" ? 1 : 0),
      expired: summary.expired + (waybill.viewState.expired ? 1 : 0),
      expiringSoon: summary.expiringSoon + (waybill.viewState.expiringSoon ? 1 : 0),
      missingDetails: summary.missingDetails + (waybill.viewState.missingDetails ? 1 : 0),
      total: summary.total + 1,
    }),
    { active: 0, expired: 0, expiringSoon: 0, missingDetails: 0, total: 0 }
  ), [normalizedWaybills]);

  const filteredWaybills = useMemo(() => {
    const lowerSearch = search.trim().toLowerCase();
    const presetStartDate = getDatePresetStart(dateFilter);
    return normalizedWaybills.filter((waybill) => {
      const haystack = [
        waybill.waybillNumber,
        waybill.invoiceNumber,
        waybill.orderNumber,
        waybill.orderId,
        waybill.orderPartyName,
        waybill.partyName,
        waybill.invoiceDirection,
        waybill.transportMode,
        waybill.vehicleNumber,
        waybill.fromName,
        waybill.toName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      const matchesSearch = !lowerSearch || haystack.includes(lowerSearch);
      const matchesStatus = statusFilter === "All" || waybill.viewState.status === statusFilter;
      const generatedAt = getGeneratedDateKey(waybill);
      const effectiveStartDate = startDate || presetStartDate;
      const matchesStart = !effectiveStartDate || generatedAt >= effectiveStartDate;
      const matchesEnd = !endDate || generatedAt <= endDate;
      return matchesSearch && matchesStatus && matchesStart && matchesEnd;
    });
  }, [dateFilter, endDate, normalizedWaybills, search, startDate, statusFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredWaybills.length / PAGE_SIZE));

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [dateFilter, endDate, search, startDate, statusFilter]);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    scrollRef.current?.scrollTo({ animated: true, y: 0 });
  }, [currentPage]);

  const visibleWaybills = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    return filteredWaybills.slice(startIndex, startIndex + PAGE_SIZE);
  }, [currentPage, filteredWaybills]);

  const activeFilterCount = [search.trim(), startDate, endDate, statusFilter !== "All", dateFilter !== "All"].filter(Boolean).length;

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("All");
    setDateFilter("All");
    setStartDate("");
    setEndDate("");
    setCurrentPage(1);
  };

  const handlePageChange = (page) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  const openEdit = (waybill) => {
    setFormError("");
    setEditingWaybill(waybill);
    setForm({
      fromName: waybill.fromName || "",
      toName: waybill.toName || "",
      transportMode: waybill.transportMode || "Unspecified",
      vehicleNumber: waybill.vehicleNumber || "",
    });
  };

  const closeEdit = () => {
    setEditingWaybill(null);
    setForm(emptyForm);
    setFormError("");
  };

  const saveEdit = async () => {
    if (!editingWaybill) {
      return;
    }
    if (!form.fromName.trim() || !form.toName.trim() || !form.transportMode.trim() || !form.vehicleNumber.trim()) {
      setFormError("From, To, transport mode, and vehicle number are required");
      return;
    }
    setBusyAction("save");
    try {
      await onUpdateWaybill?.(editingWaybill.id, {
        fromName: form.fromName,
        toName: form.toName,
        transportMode: form.transportMode,
        vehicleNumber: form.vehicleNumber,
        validUntil: editingWaybill.validUntil,
        status: editingWaybill.status,
      });
      const waybillNumber = editingWaybill.waybillNumber || String(editingWaybill.id);
      closeEdit();
      await modal.success("Waybill updated successfully", waybillNumber);
    } catch (error) {
      await modal.error("Waybill update failed", error?.message || "Please try again.");
    } finally {
      setBusyAction("");
    }
  };

  const confirmDelete = async (waybill) => {
    const confirmed = await modal.confirm({
      cancelLabel: "Keep waybill",
      confirmLabel: "Delete",
      message: waybill.waybillNumber || String(waybill.id),
      title: "Delete waybill?",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }
    setBusyAction("delete");
    try {
      await onDeleteWaybill?.(waybill.id);
      await modal.success("Waybill deleted successfully", waybill.waybillNumber || String(waybill.id));
    } catch (error) {
      await modal.error("Waybill delete failed", error?.message || "Please try again.");
    } finally {
      setBusyAction("");
    }
  };

  const createWaybillPdf = async (waybill) => {
    const html = buildWaybillHtml({ businessProfile, waybill, nowTick });
    const file = await Print.printToFileAsync({ html, base64: false });
    return file.uri;
  };

  const openPrintableWaybill = (waybill) => {
    if (Platform.OS !== "web") {
      return false;
    }
    const printWindow = window.open("", "_blank");
    if (!printWindow) {
      modal.warning("Popup blocked", "Allow popups and try again to print or save this waybill.");
      return true;
    }
    printWindow.document.open();
    printWindow.document.write(buildWaybillHtml({ businessProfile, waybill, nowTick }));
    printWindow.document.close();
    setTimeout(() => {
      printWindow.focus();
      printWindow.print();
    }, 300);
    return true;
  };

  const downloadWaybillPdf = async (waybill) => {
    setBusyAction(`download-${waybill.id}`);
    try {
      if (Platform.OS === "web") {
        const html = buildWaybillHtml({ businessProfile, waybill, nowTick });
        if (window.erpDesktop?.savePdf) {
          const result = await window.erpDesktop.savePdf({
            defaultFileName: getWaybillPdfFileName(waybill),
            html,
            showInFolder: true,
            title: "Save waybill PDF",
          });
          if (result?.error) {
            await modal.error("PDF save failed", result.error);
          }
          return;
        }
        openPrintableWaybill(waybill);
        return;
      }
      const uri = await createWaybillPdf(waybill);
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, {
          dialogTitle: waybill.waybillNumber || "Download waybill PDF",
          mimeType: "application/pdf",
          UTI: "com.adobe.pdf",
        });
        return;
      }
      await modal.success("PDF created", uri);
    } catch (error) {
      await modal.error("Waybill download failed", error?.message || "Please try again.");
    } finally {
      setBusyAction("");
    }
  };

  const remainingHours = (waybill) => {
    return getWaybillViewState(waybill, nowTick).remainingHours;
  };

  if (previewWaybill) {
    return (
      <View style={styles.previewOverlay}>
        <ScrollView contentContainerStyle={styles.previewModal} showsVerticalScrollIndicator={false}>
          <WaybillPreview
            businessProfile={businessProfile}
            waybill={previewWaybill}
            remainingHours={remainingHours(previewWaybill)}
            isBusy={isBusy || !!busyAction}
            onClose={() => setPreviewWaybill(null)}
            onDownload={() => downloadWaybillPdf(previewWaybill)}
          />
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView ref={scrollRef} style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <ScreenHeader
        eyebrow="Admin transport"
        iconLabel="W"
        iconTone="warning"
        title="Waybills"
        subtitle="Waybills are created from invoices, expire after 24 hours, and can be updated with transport details."
      />

      <View style={styles.summaryGrid}>
        <SummaryTile label="Total waybills" value={waybillSummary.total} tone="primary" />
        <SummaryTile label="Active" value={waybillSummary.active} tone="success" />
        <SummaryTile label="Expiring soon" value={waybillSummary.expiringSoon} tone="warning" />
        <SummaryTile label="Expired" value={waybillSummary.expired} tone="danger" />
        <SummaryTile label="Missing details" value={waybillSummary.missingDetails} tone="warning" />
      </View>

      <View style={styles.filterPanel}>
        <View style={styles.quickFilterCard}>
          <SearchInput disabled={isBusy || !!busyAction} placeholder="Search waybill, invoice, party, route, vehicle" value={search} onChangeText={setSearch} />
          <FilterSection title="Status" hint="Filter by operational state.">
            <FilterChips disabled={isBusy || !!busyAction} activeValue={statusFilter} onChange={setStatusFilter} options={statusFilters} />
          </FilterSection>
          <FilterSection title="Generated" hint="Use a preset or open advanced dates.">
            <FilterChips disabled={isBusy || !!busyAction} activeValue={dateFilter} onChange={(value) => { setDateFilter(value); setStartDate(""); setEndDate(""); }} options={dateFilters} />
          </FilterSection>
        </View>
        <AdvancedFilterPanel
          activeCount={activeFilterCount}
          clearLabel="Reset"
          isOpen={showAdvancedFilters}
          onClear={clearFilters}
          onToggle={() => setShowAdvancedFilters((value) => !value)}
          title="Advanced Filters"
        >
          <FilterSection title="Date Range" hint="Filter by waybill generation date.">
            <View style={styles.twoColumn}>
              <View style={styles.flexItem}>
                <FormField label="From date" value={startDate} onChangeText={(value) => { setStartDate(value); setDateFilter("All"); }} placeholder="YYYY-MM-DD" />
              </View>
              <View style={styles.flexItem}>
                <FormField label="To date" value={endDate} onChangeText={(value) => { setEndDate(value); setDateFilter("All"); }} placeholder="YYYY-MM-DD" />
              </View>
            </View>
          </FilterSection>
        </AdvancedFilterPanel>
        <FilterBar count={filteredWaybills.length} label="waybills" onClear={clearFilters} />
      </View>

      <View style={styles.list}>
        {visibleWaybills.map((waybill) => {
          const viewState = waybill.viewState || getWaybillViewState(waybill, nowTick);
          const rowBusy = isBusy || !!busyAction;
          return (
            <View key={waybill.id} style={[styles.registerRow, styles[`${viewState.tone}Row`]]}>
              <View style={styles.rowMain}>
                <View style={styles.rowIdentity}>
                  <Text style={styles.waybillId}>{waybill.waybillNumber}</Text>
                  <Text style={styles.party} numberOfLines={1}>{waybill.partyName || waybill.orderPartyName || "No party linked"}</Text>
                  <Text style={styles.subtleLine} numberOfLines={1}>Invoice {waybill.invoiceNumber || waybill.invoiceId} · Order {waybill.orderNumber || waybill.orderId || "-"}</Text>
                </View>
                <View style={styles.routeBlock}>
                  <Text style={styles.routeText} numberOfLines={1}>{waybill.fromName || "From not set"} -> {waybill.toName || "To not set"}</Text>
                  <Text style={styles.subtleLine} numberOfLines={1}>{waybill.transportMode || "Transport not set"} · {waybill.vehicleNumber || "Vehicle not set"}</Text>
                </View>
                <View style={styles.validityBlock}>
                  <Text style={[styles.statusBadge, styles[`${viewState.tone}Badge`]]}>{viewState.status}</Text>
                  <Text style={styles.validityText}>{viewState.validityText}</Text>
                  <Text style={styles.subtleLine}>{formatDisplayDate(waybill.validUntil)}</Text>
                </View>
              </View>
              <View style={styles.rowActions}>
                <TouchableOpacity disabled={rowBusy} activeOpacity={0.85} onPress={() => setPreviewWaybill(waybill)} style={styles.primaryActionButton}>
                  <Text style={styles.primaryActionText}>Preview</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={rowBusy} activeOpacity={0.85} onPress={() => downloadWaybillPdf(waybill)} style={styles.secondaryActionButton}>
                  <Text style={styles.secondaryActionText}>Download</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={rowBusy} activeOpacity={0.85} onPress={() => openEdit(waybill)} style={styles.secondaryActionButton}>
                  <Text style={styles.secondaryActionText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={rowBusy} activeOpacity={0.85} onPress={() => confirmDelete(waybill)} style={styles.dangerActionButton}>
                  <Text style={styles.dangerActionText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
        {!visibleWaybills.length && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No waybills found</Text>
            <Text style={styles.emptyText}>Adjust the search, status, or date filters to view transport documents.</Text>
          </View>
        )}
      </View>

      <View style={styles.pagination}>
        <PaginationControls
          currentPage={currentPage}
          label="waybills"
          onPageChange={handlePageChange}
          pageSize={PAGE_SIZE}
          totalCount={filteredWaybills.length}
          totalPages={totalPages}
        />
      </View>
      </ScrollView>

      {!!editingWaybill && (
        <View style={styles.previewOverlay}>
          <ScrollView contentContainerStyle={styles.editModalScroll} showsVerticalScrollIndicator={false}>
            <View style={styles.editModalWrap}>
              <View style={styles.formCard}>
                <View style={styles.formHeader}>
                  <View style={styles.previewHeadingWrap}>
                    <Text style={styles.formTitle}>Edit waybill</Text>
                    <Text style={styles.formSubtitle}>{editingWaybill.waybillNumber || "Transport document"}</Text>
                  </View>
                  <TouchableOpacity disabled={isBusy || !!busyAction} activeOpacity={0.85} onPress={closeEdit} style={styles.closeLightButton}>
                    <Text style={styles.closeLightText}>Close</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.formSection}>
                  <Text style={styles.formSectionTitle}>Route</Text>
                  <FormField label="From" value={form.fromName} onChangeText={(value) => { setFormError(""); setForm((current) => ({ ...current, fromName: value })); }} placeholder="Source name" />
                  <FormField label="To" value={form.toName} onChangeText={(value) => { setFormError(""); setForm((current) => ({ ...current, toName: value })); }} placeholder="Destination name" />
                </View>
                <View style={styles.formSection}>
                  <Text style={styles.formSectionTitle}>Transport</Text>
                  <FormField label="Transport mode" value={form.transportMode} onChangeText={(value) => { setFormError(""); setForm((current) => ({ ...current, transportMode: value })); }} placeholder="Bus / Lorry / Other" />
                  <FormField label="Vehicle number" value={form.vehicleNumber} onChangeText={(value) => { setFormError(""); setForm((current) => ({ ...current, vehicleNumber: value })); }} placeholder="Vehicle number" />
                </View>
                {!!formError && <Text style={styles.formErrorText}>{formError}</Text>}
                <View style={styles.modalActionRow}>
                  <AppButton disabled={isBusy || !!busyAction} label="Save Changes" onPress={saveEdit} />
                  <AppButton disabled={isBusy || !!busyAction} label="Cancel" onPress={closeEdit} variant="ghost" />
                </View>
              </View>
            </View>
          </ScrollView>
        </View>
      )}
    </View>
  );
}

function WaybillPreview({ businessProfile, waybill, remainingHours, isBusy, onClose, onDownload }) {
  const viewState = getWaybillViewState(waybill, Date.now());
  const sellerLines = [
    businessProfile?.tradeName,
    businessProfile?.legalName,
    businessProfile?.billingAddress,
    businessProfile?.shippingAddress,
    businessProfile?.city,
    businessProfile?.state,
    businessProfile?.pincode,
    businessProfile?.gstin ? `GSTIN: ${businessProfile.gstin}` : null,
    businessProfile?.pan ? `PAN: ${businessProfile.pan}` : null,
    businessProfile?.email ? `Email: ${businessProfile.email}` : null,
    businessProfile?.mobile ? `Mobile: ${businessProfile.mobile}` : null,
  ].filter(Boolean);
  const orderItems = waybill.orderItems || [];
  const totalQuantity = orderItems.reduce((total, item) => total + safeNumber(item.quantity), 0);

  return (
    <View style={styles.previewCard}>
      <View style={styles.documentHeader}>
        <View style={styles.previewHeadingWrap}>
          <Text style={styles.documentEyebrow}>Transport document</Text>
          <Text style={styles.previewTitle}>Waybill</Text>
          <Text style={styles.previewSubtitle}>{waybill.waybillNumber} · Invoice {waybill.invoiceNumber || waybill.invoiceId}</Text>
        </View>
        <View style={styles.previewActionRow}>
          <TouchableOpacity activeOpacity={0.85} disabled={isBusy} onPress={onDownload} style={[styles.downloadPreviewButton, isBusy && styles.disabledButton]}>
            <Text style={styles.downloadPreviewText}>{isBusy ? "Please wait..." : "Download"}</Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.85} disabled={isBusy} onPress={onClose} style={[styles.closeButton, isBusy && styles.disabledButton]}>
            <Text style={styles.closeText}>Close</Text>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.documentSummary}>
        <PreviewMetric label="Status" value={viewState.status} tone={viewState.tone} />
        <PreviewMetric label="Valid until" value={formatDisplayDate(waybill.validUntil)} />
        <PreviewMetric label="Remaining" value={viewState.expired ? "Expired" : `${remainingHours} hrs`} />
        <PreviewMetric label="Grand total" value={formatCurrency(waybill.orderGrandTotal)} />
      </View>

      <View style={styles.routePreviewCard}>
        <View style={styles.routePoint}>
          <Text style={styles.routePointLabel}>From</Text>
          <Text style={styles.routePointValue}>{waybill.fromName || "Source not set"}</Text>
        </View>
        <Text style={styles.routeArrow}>-></Text>
        <View style={styles.routePoint}>
          <Text style={styles.routePointLabel}>To</Text>
          <Text style={styles.routePointValue}>{waybill.toName || "Destination not set"}</Text>
        </View>
      </View>

      <View style={styles.previewGrid}>
        <View style={styles.previewSection}>
          <Text style={styles.previewSectionTitle}>Business</Text>
          {sellerLines.map((line, index) => (
            <Text key={`seller-${index}`} style={styles.previewLine}>{line}</Text>
          ))}
        </View>
        <View style={styles.previewSection}>
          <Text style={styles.previewSectionTitle}>Transport</Text>
          <PreviewMeta label="Mode" value={waybill.transportMode || "Unspecified"} />
          <PreviewMeta label="Vehicle" value={waybill.vehicleNumber || "Not set"} />
          <PreviewMeta label="Generated" value={formatDisplayDate(waybill.generatedAt)} />
          <PreviewMeta label="Direction" value={waybill.invoiceDirection || "-"} />
        </View>
      </View>

      <View style={styles.previewSection}>
        <View style={styles.sectionHeaderRow}>
          <Text style={styles.previewSectionTitle}>Order items</Text>
          <Text style={styles.sectionHeaderMeta}>{formatNumber(orderItems.length)} lines · {formatNumber(totalQuantity)} qty</Text>
        </View>
        {orderItems.length > 0 ? (
          <View style={styles.previewTable}>
            <View style={styles.previewTableHeader}>
              <Text style={[styles.previewTableHead, styles.itemProductCol]}>Product</Text>
              <Text style={styles.previewTableHead}>Qty</Text>
              <Text style={styles.previewTableHead}>Rate</Text>
              <Text style={styles.previewTableHead}>GST</Text>
            </View>
            {orderItems.map((item, index) => (
              <View key={`item-${item.id || index}`} style={styles.previewTableRow}>
                <View style={styles.itemProductCol}>
                  <Text style={styles.orderItemTitle}>{index + 1}. {item.productName || item.sku || `Product ${item.productId}`}</Text>
                  <Text style={styles.orderItemLine}>SKU {item.sku || "-"} · Product {item.productId}</Text>
                </View>
                <Text style={styles.previewTableCell}>{formatItemUnit(item)}</Text>
                <Text style={styles.previewTableCell}>{formatCurrency(item.rate)}</Text>
                <Text style={styles.previewTableCell}>{item.gstRate}%</Text>
              </View>
            ))}
          </View>
        ) : (
          <Text style={styles.previewLine}>No order items linked.</Text>
        )}
      </View>

      <View style={styles.previewGrid}>
        <View style={styles.previewSection}>
          <Text style={styles.previewSectionTitle}>Order</Text>
          <PreviewMeta label="Order" value={waybill.orderNumber || waybill.orderId || "-"} />
          <PreviewMeta label="Party" value={waybill.orderPartyName || waybill.partyName || "-"} />
          <PreviewMeta label="Order date" value={formatDisplayDate(waybill.orderDate)} />
          <PreviewMeta label="Payment" value={waybill.orderPaymentStatus || "-"} />
        </View>
        <View style={styles.totalsPreviewCard}>
          <Text style={styles.previewSectionTitle}>Value summary</Text>
          <TotalLine label="Taxable" value={formatCurrency(waybill.orderTaxableValue)} />
          <TotalLine label="Tax" value={formatCurrency(waybill.orderTaxValue)} />
          <View style={styles.grandTotalLine}>
            <Text style={styles.grandTotalLabel}>Grand total</Text>
            <Text style={styles.grandTotalValue}>{formatCurrency(waybill.orderGrandTotal)}</Text>
          </View>
        </View>
      </View>

      <View style={styles.termsBox}>
        <Text style={styles.termsTitle}>Terms & Conditions</Text>
        <Text style={styles.termsText}>1. This waybill is valid for 24 hours from generation unless updated by admin.</Text>
        <Text style={styles.termsText}>2. Vehicle number and transport mode must match the dispatched goods.</Text>
        <Text style={styles.termsText}>3. This is a computer generated transport document.</Text>
      </View>
    </View>
  );
}


function PreviewMeta({ label, value }) {
  return (
    <View style={styles.previewMeta}>
      <Text style={styles.previewMetaLabel}>{label}</Text>
      <Text style={styles.previewMetaValue}>{value || "-"}</Text>
    </View>
  );
}

function PreviewMetric({ label, tone = "primary", value }) {
  return (
    <View style={styles.previewMetric}>
      <Text style={styles.previewMetricLabel}>{label}</Text>
      <Text style={[styles.previewMetricValue, styles[`${tone}SummaryText`]]}>{value || "-"}</Text>
    </View>
  );
}

function TotalLine({ label, value }) {
  return (
    <View style={styles.totalLinePreview}>
      <Text style={styles.totalLineLabel}>{label}</Text>
      <Text style={styles.totalLineValue}>{value}</Text>
    </View>
  );
}

function SummaryTile({ label, tone = "primary", value }) {
  return (
    <View style={[styles.summaryTile, styles[`${tone}SummaryTile`]]}>
      <Text style={styles.summaryTileLabel}>{label}</Text>
      <Text style={[styles.summaryTileValue, styles[`${tone}SummaryText`]]}>{formatNumber(value)}</Text>
    </View>
  );
}

export function buildWaybillHtml({ businessProfile, waybill, nowTick }) {
  const viewState = getWaybillViewState(waybill, nowTick);
  const remainingText = viewState.expired ? "Expired" : viewState.remainingHours ? `${viewState.remainingHours} hrs left` : "Valid";
  const sellerLines = [
    businessProfile?.tradeName,
    businessProfile?.legalName,
    businessProfile?.billingAddress,
    businessProfile?.shippingAddress,
    businessProfile?.city,
    businessProfile?.state,
    businessProfile?.pincode,
    businessProfile?.gstin ? `GSTIN: ${businessProfile.gstin}` : null,
    businessProfile?.pan ? `PAN: ${businessProfile.pan}` : null,
    businessProfile?.email ? `Email: ${businessProfile.email}` : null,
    businessProfile?.mobile ? `Mobile: ${businessProfile.mobile}` : null,
  ].filter(Boolean);
  const companyName = businessProfile?.tradeName || "Company";
  const orderItems = waybill.orderItems || [];
  const totalQuantity = orderItems.reduce((total, item) => total + safeNumber(item.quantity), 0);
  const orderRows = orderItems
    .map((item, index) => `
      <tr>
        <td class="center">${index + 1}</td>
        <td>
          <strong>${htmlText(item.productName || item.sku || `Product ${item.productId}`)}</strong>
          <span>SKU ${htmlText(item.sku)} · Product ${htmlText(item.productId)}</span>
        </td>
        <td>${htmlText(formatItemUnit(item))}</td>
        <td class="right">${htmlText(formatCurrency(item.rate))}</td>
        <td class="center">${htmlText(`${safeNumber(item.gstRate)}%`)}</td>
      </tr>
    `)
    .join('');

  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          @page { size: A4 portrait; margin: 10mm; }
          * { box-sizing: border-box; }
          html, body { margin: 0; padding: 0; }
          body { color: #17212b; font-family: Arial, Helvetica, sans-serif; font-size: 10px; }
          .page { width: 100%; }
          .top { align-items: flex-start; border-bottom: 2px solid #17212b; display: flex; justify-content: space-between; padding-bottom: 10px; }
          .eyebrow { color: #5d6b78; font-size: 8px; font-weight: 800; letter-spacing: 1.1px; text-transform: uppercase; }
          .title { color: #17212b; font-size: 24px; font-weight: 900; line-height: 26px; margin-top: 3px; text-transform: uppercase; }
          .docNo { color: #2f6f62; font-size: 12px; font-weight: 900; margin-top: 4px; }
          .statusBox { border: 1px solid #d8e0e7; border-radius: 6px; min-width: 150px; padding: 8px; text-align: right; }
          .status { color: #2f6f62; font-size: 13px; font-weight: 900; }
          .status.danger { color: #c0392b; }
          .status.warning { color: #c47b17; }
          .grid { display: grid; gap: 8px; }
          .two { grid-template-columns: 1fr 1fr; }
          .three { grid-template-columns: 1fr 1fr 1fr; }
          .section { margin-top: 10px; }
          .panel { border: 1px solid #d8e0e7; border-radius: 6px; overflow: hidden; }
          .panelTitle { background: #f4f7f6; border-bottom: 1px solid #d8e0e7; color: #17212b; font-size: 9px; font-weight: 900; letter-spacing: .5px; padding: 6px 8px; text-transform: uppercase; }
          .panelBody { padding: 8px; }
          .company { color: #2f6f62; font-size: 13px; font-weight: 900; margin: 0 0 4px; }
          .line { color: #344250; font-size: 9px; line-height: 13px; margin: 0; }
          .route { align-items: stretch; display: grid; grid-template-columns: 1fr 44px 1fr; margin-top: 10px; }
          .routePoint { border: 1px solid #d8e0e7; border-radius: 6px; padding: 9px; }
          .arrow { align-items: center; color: #2f6f62; display: flex; font-size: 14px; font-weight: 900; justify-content: center; }
          .label { color: #5d6b78; display: block; font-size: 8px; font-weight: 800; letter-spacing: .4px; text-transform: uppercase; }
          .value { color: #17212b; display: block; font-size: 11px; font-weight: 900; margin-top: 3px; }
          .metaGrid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
          .meta { background: #fbfcfd; border: 1px solid #e5ebef; border-radius: 5px; min-height: 38px; padding: 6px; }
          table { border-collapse: collapse; margin-top: 8px; width: 100%; }
          th { background: #17212b; color: #fff; font-size: 8px; letter-spacing: .5px; padding: 7px 6px; text-transform: uppercase; }
          td { border-bottom: 1px solid #e5ebef; color: #17212b; font-size: 9px; line-height: 12px; padding: 7px 6px; vertical-align: top; }
          td span { color: #5d6b78; display: block; font-size: 8px; margin-top: 2px; }
          .center { text-align: center; }
          .right { text-align: right; }
          .totals { margin-left: auto; width: 260px; }
          .totalLine { align-items: center; border-bottom: 1px solid #e5ebef; display: flex; justify-content: space-between; padding: 6px 0; }
          .totalLine span { color: #5d6b78; font-size: 9px; font-weight: 800; }
          .totalLine strong { color: #17212b; font-size: 10px; font-weight: 900; }
          .grand { background: #17212b; border-radius: 5px; color: white; margin-top: 6px; padding: 8px; }
          .grand span, .grand strong { color: white; }
          .terms p { color: #344250; font-size: 8px; line-height: 12px; margin: 0 0 3px; }
          .footer { display: grid; grid-template-columns: 1.2fr 1fr; gap: 10px; margin-top: 12px; }
          .signature { min-height: 56px; text-align: right; }
          .muted { color: #5d6b78; }
        </style>
      </head>
      <body>
        <div class="page">
          <div class="top">
            <div>
              <div class="eyebrow">Transport document</div>
              <div class="title">Waybill</div>
              <div class="docNo">${htmlText(waybill.waybillNumber, "Waybill")}</div>
            </div>
            <div class="statusBox">
              <span class="label">Status</span>
              <div class="status ${viewState.tone === "danger" ? "danger" : viewState.tone === "warning" ? "warning" : ""}">${htmlText(viewState.status)}</div>
              <p class="line">Invoice ${htmlText(waybill.invoiceNumber || waybill.invoiceId)}</p>
              <p class="line">${htmlText(remainingText)}</p>
            </div>
          </div>

          <div class="route">
            <div class="routePoint"><span class="label">From</span><span class="value">${htmlText(waybill.fromName, "Source not set")}</span></div>
            <div class="arrow">→</div>
            <div class="routePoint"><span class="label">To</span><span class="value">${htmlText(waybill.toName, "Destination not set")}</span></div>
          </div>

          <div class="grid two section">
            <div class="panel">
              <div class="panelTitle">Business details</div>
              <div class="panelBody">
                <p class="company">${htmlText(companyName)}</p>
                ${sellerLines.map((line) => `<p class="line">${htmlText(line)}</p>`).join('')}
              </div>
            </div>
            <div class="panel">
              <div class="panelTitle">Transport details</div>
              <div class="panelBody metaGrid">
                <div class="meta"><span class="label">Generated</span><span class="value">${htmlText(formatDisplayDate(waybill.generatedAt))}</span></div>
                <div class="meta"><span class="label">Valid until</span><span class="value">${htmlText(formatDisplayDate(waybill.validUntil))}</span></div>
                <div class="meta"><span class="label">Mode</span><span class="value">${htmlText(waybill.transportMode, "Unspecified")}</span></div>
                <div class="meta"><span class="label">Vehicle</span><span class="value">${htmlText(waybill.vehicleNumber, "Not set")}</span></div>
              </div>
            </div>
          </div>

          <div class="panel section">
            <div class="panelTitle">Order and invoice details</div>
            <div class="panelBody metaGrid">
              <div class="meta"><span class="label">Order</span><span class="value">${htmlText(waybill.orderNumber || waybill.orderId)}</span></div>
              <div class="meta"><span class="label">Order date</span><span class="value">${htmlText(formatDisplayDate(waybill.orderDate))}</span></div>
              <div class="meta"><span class="label">Party</span><span class="value">${htmlText(waybill.orderPartyName || waybill.partyName)}</span></div>
              <div class="meta"><span class="label">Payment</span><span class="value">${htmlText(waybill.orderPaymentStatus)}</span></div>
              <div class="meta"><span class="label">Order status</span><span class="value">${htmlText(waybill.orderStatus)}</span></div>
              <div class="meta"><span class="label">Invoice direction</span><span class="value">${htmlText(waybill.invoiceDirection)}</span></div>
            </div>
          </div>

          <div class="panel section">
            <div class="panelTitle">Goods carried · ${htmlText(formatNumber(orderItems.length))} lines · ${htmlText(formatNumber(totalQuantity))} qty</div>
            <div class="panelBody">
              <table>
                <thead>
                  <tr>
                    <th class="center">Sl</th>
                    <th>Product</th>
                    <th>Quantity</th>
                    <th class="right">Rate</th>
                    <th class="center">GST</th>
                  </tr>
                </thead>
                <tbody>
                  ${orderRows || '<tr><td colspan="5">No order items linked</td></tr>'}
                </tbody>
              </table>
            </div>
          </div>

          <div class="grid two section">
            <div class="panel terms">
              <div class="panelTitle">Terms & Conditions</div>
              <div class="panelBody">
                <p>1. This waybill is valid for 24 hours from the generation time unless updated by admin.</p>
                <p>2. Vehicle number and transport mode must match the dispatched goods.</p>
                <p>3. This is a computer generated transport document.</p>
              </div>
            </div>
            <div class="panel">
              <div class="panelTitle">Value summary</div>
              <div class="panelBody">
                <div class="totals">
                  <div class="totalLine"><span>Taxable</span><strong>${htmlText(formatCurrency(waybill.orderTaxableValue))}</strong></div>
                  <div class="totalLine"><span>Tax</span><strong>${htmlText(formatCurrency(waybill.orderTaxValue))}</strong></div>
                  <div class="totalLine grand"><span>Grand total</span><strong>${htmlText(formatCurrency(waybill.orderGrandTotal))}</strong></div>
                </div>
              </div>
            </div>
          </div>

          <div class="footer">
            <div class="panel"><div class="panelBody muted">This is a computer generated waybill for transport tracking.</div></div>
            <div class="panel signature"><div class="panelBody">For ${htmlText(companyName)}<br/><br/><br/>Authorised signatory</div></div>
          </div>
        </div>
      </body>
    </html>
  `;
}


const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingBottom: spacing.xl },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
  },
  summaryTile: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexBasis: 170,
    flexGrow: 1,
    minHeight: 84,
    padding: spacing.md,
  },
  summaryTileLabel: { color: colors.muted, fontSize: 11, fontWeight: "700" },
  summaryTileValue: { fontSize: 24, fontWeight: "800", marginTop: spacing.sm },
  primarySummaryTile: { borderLeftColor: colors.primary, borderLeftWidth: 3 },
  successSummaryTile: { borderLeftColor: colors.success, borderLeftWidth: 3 },
  warningSummaryTile: { borderLeftColor: colors.warning, borderLeftWidth: 3 },
  dangerSummaryTile: { borderLeftColor: colors.danger, borderLeftWidth: 3 },
  primarySummaryText: { color: colors.primaryDark },
  successSummaryText: { color: colors.success },
  warningSummaryText: { color: colors.warning },
  dangerSummaryText: { color: colors.danger },
  filterPanel: { gap: spacing.md, paddingHorizontal: spacing.md },
  quickFilterCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  formCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  editModalScroll: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing.md,
  },
  editModalWrap: {
    marginHorizontal: "auto",
    maxWidth: 620,
    width: "100%",
  },
  formHeader: { alignItems: "flex-start", flexDirection: "row", gap: spacing.md, justifyContent: "space-between" },
  formTitle: { color: colors.ink, fontSize: 18, fontWeight: "800" },
  formSubtitle: { color: colors.muted, fontSize: 12, fontWeight: "700", marginTop: 3 },
  formSection: { backgroundColor: colors.background, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  formSectionTitle: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  formErrorText: { color: colors.danger, fontSize: 12, fontWeight: "700" },
  closeLightButton: { backgroundColor: colors.background, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  closeLightText: { color: colors.muted, fontSize: 12, fontWeight: "700" },
  modalActionRow: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, justifyContent: "flex-end", marginTop: spacing.xs },
  twoColumn: { flexDirection: "row", gap: spacing.sm },
  flexItem: { flex: 1 },
  list: { gap: spacing.sm, padding: spacing.md },
  registerRow: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderLeftWidth: 3,
    borderRadius: radii.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  successRow: { borderLeftColor: colors.success },
  warningRow: { borderLeftColor: colors.warning },
  dangerRow: { borderLeftColor: colors.danger },
  primaryRow: { borderLeftColor: colors.primary },
  rowMain: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  rowIdentity: { flexBasis: 230, flexGrow: 1, minWidth: 0 },
  routeBlock: { flexBasis: 260, flexGrow: 1, minWidth: 0 },
  validityBlock: { alignItems: "flex-end", flexBasis: 132, flexGrow: 0 },
  waybillId: { color: colors.ink, fontSize: 16, fontWeight: "800" },
  party: { color: colors.ink, fontSize: 12, fontWeight: "700", marginTop: spacing.xs },
  subtleLine: { color: colors.muted, fontSize: 11, fontWeight: "600", marginTop: 4 },
  routeText: { color: colors.ink, fontSize: 13, fontWeight: "800" },
  validityText: { color: colors.ink, fontSize: 12, fontWeight: "800", marginTop: spacing.xs },
  statusBadge: { borderRadius: 99, fontSize: 11, fontWeight: "800", overflow: "hidden", paddingHorizontal: spacing.sm, paddingVertical: spacing.xs },
  successBadge: { backgroundColor: colors.successSoft, color: colors.success },
  warningBadge: { backgroundColor: colors.warningSoft, color: colors.warning },
  dangerBadge: { backgroundColor: colors.dangerSoft, color: colors.danger },
  primaryBadge: { backgroundColor: colors.primarySoft, color: colors.primary },
  rowActions: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, justifyContent: "flex-end", marginTop: spacing.md },
  actionRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md, flexWrap: "wrap" },
  primaryActionButton: { backgroundColor: colors.primary, borderRadius: radii.md, minWidth: 92, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  secondaryActionButton: { backgroundColor: colors.background, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, minWidth: 92, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  dangerActionButton: { backgroundColor: colors.dangerSoft, borderRadius: radii.md, minWidth: 80, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  primaryActionText: { color: colors.white, fontSize: 12, fontWeight: "800", textAlign: "center" },
  secondaryActionText: { color: colors.ink, fontSize: 12, fontWeight: "700", textAlign: "center" },
  dangerActionText: { color: colors.danger, fontSize: 12, fontWeight: "800", textAlign: "center" },
  emptyCard: { backgroundColor: colors.surface, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, padding: spacing.lg },
  emptyTitle: { color: colors.ink, fontSize: 16, fontWeight: "800", textAlign: "center" },
  emptyText: { color: colors.muted, fontSize: 12, fontWeight: "600", marginTop: spacing.xs, textAlign: "center" },
  pagination: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  previewOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(15,23,42,0.55)", padding: spacing.md, zIndex: 40 },
  previewModal: { flexGrow: 1, justifyContent: "center" },
  previewCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
    width: "100%",
  },
  previewTopBar: { alignItems: "flex-start", flexDirection: "row", justifyContent: "space-between", gap: spacing.md },
  previewHeadingWrap: { flex: 1 },
  previewTitle: { color: colors.ink, fontSize: 22, fontWeight: "700" },
  previewSubtitle: { color: colors.muted, fontSize: 12, fontWeight: "700", marginTop: 2 },
  documentHeader: {
    alignItems: "flex-start",
    borderBottomColor: colors.ink,
    borderBottomWidth: 2,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "space-between",
    paddingBottom: spacing.md,
  },
  documentEyebrow: { color: colors.primary, fontSize: 10, fontWeight: "800", letterSpacing: 0.8, textTransform: "uppercase" },
  documentSummary: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    padding: spacing.sm,
  },
  previewMetric: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    flexBasis: 150,
    flexGrow: 1,
    minHeight: 58,
    padding: spacing.sm,
  },
  previewMetricLabel: { color: colors.muted, fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  previewMetricValue: { color: colors.ink, fontSize: 15, fontWeight: "900", marginTop: 5 },
  previewActionRow: { flexDirection: "row", gap: spacing.sm, flexWrap: "wrap", justifyContent: "flex-end" },
  downloadPreviewButton: { backgroundColor: colors.primary, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  sharePreviewButton: { backgroundColor: colors.success, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  closeButton: { backgroundColor: colors.danger, borderRadius: radii.md, paddingHorizontal: spacing.md, paddingVertical: spacing.sm },
  disabledButton: { opacity: 0.55 },
  downloadPreviewText: { color: colors.white, fontSize: 12, fontWeight: "700", textAlign: "center" },
  sharePreviewText: { color: colors.white, fontSize: 12, fontWeight: "700", textAlign: "center" },
  closeText: { color: colors.white, fontSize: 12, fontWeight: "700", textAlign: "center" },
  routePreviewCard: {
    alignItems: "stretch",
    flexDirection: "row",
    gap: spacing.sm,
  },
  routePoint: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    minWidth: 0,
    padding: spacing.md,
  },
  routePointLabel: { color: colors.muted, fontSize: 10, fontWeight: "800", textTransform: "uppercase" },
  routePointValue: { color: colors.ink, fontSize: 15, fontWeight: "900", marginTop: spacing.xs },
  routeArrow: { alignSelf: "center", color: colors.primary, fontSize: 16, fontWeight: "900" },
  previewGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.md },
  previewSection: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexBasis: 280,
    flexGrow: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  previewSectionTitle: { color: colors.ink, fontSize: 14, fontWeight: "900" },
  previewLine: { color: colors.ink, fontSize: 11, fontWeight: "700", lineHeight: 16 },
  sectionHeaderRow: { alignItems: "center", flexDirection: "row", flexWrap: "wrap", gap: spacing.sm, justifyContent: "space-between" },
  sectionHeaderMeta: { color: colors.muted, fontSize: 11, fontWeight: "800" },
  previewTable: {
    borderColor: colors.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    overflow: "hidden",
  },
  previewTableHeader: {
    backgroundColor: colors.ink,
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  previewTableHead: { color: colors.white, flex: 1, fontSize: 10, fontWeight: "900", textTransform: "uppercase" },
  itemProductCol: { flex: 2.2, minWidth: 0 },
  previewTableRow: {
    backgroundColor: colors.surface,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
  previewTableCell: { color: colors.ink, flex: 1, fontSize: 11, fontWeight: "700", minWidth: 0 },
  orderItemCard: { backgroundColor: colors.background, borderRadius: radii.md, gap: 2, padding: spacing.sm },
  orderItemTitle: { color: colors.ink, fontSize: 12, fontWeight: "700" },
  orderItemLine: { color: colors.muted, fontSize: 11, fontWeight: "700", lineHeight: 15 },
  previewMetaGrid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  previewMeta: { backgroundColor: colors.background, borderRadius: radii.md, minWidth: "47%", padding: spacing.sm },
  previewMetaLabel: { color: colors.muted, fontSize: 10, fontWeight: "600" },
  previewMetaValue: { color: colors.ink, fontSize: 12, fontWeight: "700", marginTop: 3 },
  totalsPreviewCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexBasis: 280,
    flexGrow: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  totalLinePreview: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: spacing.sm,
  },
  totalLineLabel: { color: colors.muted, fontSize: 12, fontWeight: "800" },
  totalLineValue: { color: colors.ink, fontSize: 13, fontWeight: "900" },
  grandTotalLine: {
    alignItems: "center",
    backgroundColor: colors.ink,
    borderRadius: radii.sm,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.xs,
    padding: spacing.md,
  },
  grandTotalLabel: { color: colors.white, fontSize: 12, fontWeight: "900", textTransform: "uppercase" },
  grandTotalValue: { color: colors.white, fontSize: 16, fontWeight: "900" },
  termsBox: { backgroundColor: colors.background, borderColor: colors.border, borderRadius: radii.md, borderWidth: 1, gap: 4, padding: spacing.md },
  termsTitle: { color: colors.ink, fontSize: 13, fontWeight: "700" },
  termsText: { color: colors.muted, fontSize: 11, lineHeight: 16 },
});
