import React, { useEffect, useMemo, useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { AppButton } from "../components/AppButton";
import { FormField } from "../components/FormField";
import { useModal } from "../components/ModalProvider";
import { SearchablePicker } from "../components/SearchablePicker";
import { ScreenHeader } from "../components/ScreenHeader";
import { api } from "../services/api";
import { colors, radii, spacing, typography } from "../constants/theme";
import { formatCurrency, formatDate } from "../utils/formatters";

const emptyDiscountForm = {
  productId: null,
  discountType: "percentage",
  discountValue: "",
  minQuantity: "1",
  startDate: "",
  endDate: "",
  isActive: true,
  description: "",
};

const timelineFilters = ["All", "Active now", "Upcoming", "Expired", "Inactive"];

function getDiscountProductId(discount) {
  return discount.productId ?? discount.product_id ?? null;
}

function getDiscountType(discount) {
  return discount.discountType || discount.discount_type || "percentage";
}

function getDiscountValue(discount) {
  return discount.discountValue ?? discount.discount_value ?? 0;
}

function getDiscountStartDate(discount) {
  return discount.startDate || discount.start_date || "";
}

function getDiscountEndDate(discount) {
  return discount.endDate || discount.end_date || "";
}

function isDiscountActive(discount) {
  return discount.isActive ?? discount.is_active ?? true;
}

function toDateInputValue(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function discountStatus(discount) {
  if (!isDiscountActive(discount)) return { label: "Inactive", tone: "muted" };
  const today = toDateInputValue();
  const startDate = getDiscountStartDate(discount);
  const endDate = getDiscountEndDate(discount);
  if (startDate && startDate > today) return { label: "Upcoming", tone: "warning" };
  if (endDate && endDate < today) return { label: "Expired", tone: "muted" };
  return { label: "Active now", tone: "success" };
}

function discountLabel(discount) {
  const value = getDiscountValue(discount);
  return getDiscountType(discount) === "fixed"
    ? `${formatCurrency(value)} off`
    : `${value}% off`;
}

function durationLabel(startDate, endDate) {
  if (!startDate || !endDate) return "Duration not set";
  const start = new Date(startDate);
  const end = new Date(endDate);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return "Duration not set";
  const days = Math.max(1, Math.round((end - start) / 86_400_000) + 1);
  return `Runs for ${days} ${days === 1 ? "day" : "days"}`;
}

function quantityRuleLabel(discount) {
  const minQuantity = Number(discount.minQuantity ?? discount.min_quantity ?? 0);
  return minQuantity > 0 ? `Applies from quantity ${minQuantity}` : "Applies from first unit";
}

function statusRank(discount) {
  const status = discountStatus(discount).label;
  if (status === "Active now") return 0;
  if (status === "Upcoming") return 1;
  if (status === "Expired") return 2;
  return 3;
}

function safeNumber(value) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function productStockLabel(product) {
  const remaining = safeNumber(product?.remaining ?? product?.stockCached ?? product?.stock_cached ?? product?.qtyBought ?? product?.qty_bought);
  const reorderLevel = safeNumber(product?.reorderLevel ?? product?.reorder_level);
  if (remaining <= 0) return "Out of stock";
  if (reorderLevel > 0 && remaining <= reorderLevel) return "Low stock";
  return `${remaining} available`;
}

function uniqueProductCount(discounts) {
  return new Set(discounts.map(getDiscountProductId).filter(Boolean)).size;
}

function activeDiscountCountForProduct(discounts, productId) {
  if (!productId) return 0;
  return discounts.filter(
    (discount) => getDiscountProductId(discount) === productId && discountStatus(discount).label === "Active now"
  ).length;
}

export function DiscountsScreen({ products = [], isBusy }) {
  const modal = useModal();
  const [selectedProductId, setSelectedProductId] = useState(null);
  const [discounts, setDiscounts] = useState([]);
  const [form, setForm] = useState(emptyDiscountForm);
  const [editingDiscount, setEditingDiscount] = useState(null);
  const [error, setError] = useState("");
  const [timelineFilter, setTimelineFilter] = useState("All");
  const [isLoading, setIsLoading] = useState(false);

  const productOptions = useMemo(
    () =>
      products
        .map((product) => ({
          label: `${product.name} (${product.sku || "SKU"})`,
          value: product.id,
          hint: product.category || "",
        }))
        .sort((a, b) => String(a.label).localeCompare(String(b.label))),
    [products]
  );
  const productById = useMemo(() => new Map(products.map((product) => [product.id, product])), [products]);

  const loadDiscounts = async () => {
    setIsLoading(true);
    try {
      const result = await api.getAllProductDiscounts({}, { bypassCache: true });
      setDiscounts(result || []);
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDiscounts();
    const id = setInterval(loadDiscounts, 10000);
    return () => clearInterval(id);
  }, []);

  const updateForm = (key, value) => setForm((current) => ({ ...current, [key]: value }));

  const activeDiscounts = useMemo(
    () => discounts.filter((discount) => discountStatus(discount).label === "Active now"),
    [discounts]
  );
  const productsWithOffersCount = useMemo(() => uniqueProductCount(discounts), [discounts]);
  const productsActiveNowCount = useMemo(() => uniqueProductCount(activeDiscounts), [activeDiscounts]);
  const duplicateActiveOfferCount = Math.max(0, activeDiscounts.length - productsActiveNowCount);
  const upcomingDiscounts = useMemo(
    () => discounts.filter((discount) => discountStatus(discount).label === "Upcoming"),
    [discounts]
  );
  const upcomingProductsCount = useMemo(() => uniqueProductCount(upcomingDiscounts), [upcomingDiscounts]);
  const filteredDiscounts = useMemo(
    () =>
      discounts
        .filter((discount) => timelineFilter === "All" || discountStatus(discount).label === timelineFilter)
        .sort((left, right) => {
          const rankDiff = statusRank(left) - statusRank(right);
          if (rankDiff) return rankDiff;
          return String(getDiscountStartDate(left)).localeCompare(String(getDiscountStartDate(right)));
        }),
    [discounts, timelineFilter]
  );
  const selectedProductDiscounts = useMemo(
    () => discounts.filter((discount) => getDiscountProductId(discount) === form.productId),
    [discounts, form.productId]
  );
  const selectedProduct = productById.get(form.productId || selectedProductId);
  const selectedProductActiveOfferCount = activeDiscountCountForProduct(discounts, selectedProduct?.id);
  const salePrice = Number(selectedProduct?.sellPrice || selectedProduct?.sell_price || 0);
  const discountValue = Number(form.discountValue || 0);
  const previewDiscountAmount =
    form.discountType === "percentage" ? (salePrice * Math.min(discountValue, 100)) / 100 : discountValue;
  const finalPreviewPrice = Math.max(0, salePrice - (Number.isFinite(previewDiscountAmount) ? previewDiscountAmount : 0));
  const selectedActiveDiscount = selectedProductDiscounts.find((discount) => discountStatus(discount).label === "Active now");
  const selectedUpcomingDiscountCount = selectedProductDiscounts.filter((discount) => discountStatus(discount).label === "Upcoming").length;
  const selectedProductCode = selectedProduct?.sku || selectedProduct?.barcode || selectedProduct?.id || "-";
  const hasOverlapWarning = useMemo(
    () =>
      Boolean(form.startDate && form.endDate) &&
      selectedProductDiscounts.some((discount) => {
        if (editingDiscount && discount.id === editingDiscount.id) return false;
        if (!isDiscountActive(discount)) return false;
        return getDiscountStartDate(discount) <= form.endDate && getDiscountEndDate(discount) >= form.startDate;
      }),
    [selectedProductDiscounts, editingDiscount, form.endDate, form.startDate]
  );

  const resetForm = (productId = form.productId) => {
    setEditingDiscount(null);
    setForm({ ...emptyDiscountForm, productId });
    setError("");
  };

  const editDiscount = (discount) => {
    const productId = getDiscountProductId(discount) || selectedProductId;
    setEditingDiscount(discount);
    setError("");
    setSelectedProductId(productId);
    setForm({
      productId,
      discountType: discount.discountType || discount.discount_type || "percentage",
      discountValue: String(discount.discountValue ?? discount.discount_value ?? ""),
      minQuantity: String(discount.minQuantity ?? discount.min_quantity ?? "0"),
      startDate: discount.startDate || discount.start_date || "",
      endDate: discount.endDate || discount.end_date || "",
      isActive: discount.isActive ?? discount.is_active ?? true,
      description: discount.description || "",
    });
  };

  const handleSaveDiscount = async () => {
    if (!form.productId) {
      setError("Select a product before creating a discount.");
      return;
    }
    const discountValue = Number(form.discountValue || 0);
    const minQuantity = Number(form.minQuantity || 0);
    if (!["percentage", "fixed"].includes(form.discountType)) {
      setError("Choose percentage or fixed discount.");
      return;
    }
    if (!Number.isFinite(discountValue) || discountValue <= 0) {
      setError("Discount value must be greater than 0.");
      return;
    }
    if (form.discountType === "percentage" && discountValue > 100) {
      setError("Percentage discount cannot exceed 100%.");
      return;
    }
    if (!Number.isFinite(minQuantity) || minQuantity < 0) {
      setError("Minimum quantity must be 0 or more.");
      return;
    }
    if (!form.startDate || !form.endDate) {
      setError("Start date and end date are required so the discount only applies during that duration.");
      return;
    }
    if (form.endDate < form.startDate) {
      setError("End date must be on or after start date.");
      return;
    }
    if (hasOverlapWarning) {
      setError("Another active discount already overlaps this date range for this product.");
      return;
    }
    setError("");
    setIsLoading(true);
    try {
      const payload = {
        productId: form.productId,
        discountType: form.discountType,
        discountValue,
        minQuantity,
        startDate: form.startDate,
        endDate: form.endDate,
        isActive: form.isActive,
        description: form.description,
      };
      if (editingDiscount) {
        await api.updateProductDiscount(form.productId, editingDiscount.id, payload);
      } else {
        await api.createProductDiscount(form.productId, payload);
      }
      resetForm(form.productId);
      await loadDiscounts();
      setError("");
      await modal.success(editingDiscount ? "Discount updated successfully" : "Discount created successfully", selectedProduct?.name || "The product discount is ready.");
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const deactivateDiscount = async (discount) => {
    const confirmed = await modal.confirm({
      title: "Deactivate discount?",
      message: "This offer will stop applying to future sale orders.",
      confirmLabel: "Deactivate",
      cancelLabel: "Keep active",
    });
    if (!confirmed) return;
    setIsLoading(true);
    try {
      const productId = getDiscountProductId(discount);
      await api.deactivateProductDiscount(productId, discount.id);
      await loadDiscounts();
      if (editingDiscount?.id === discount.id) resetForm(productId || selectedProductId);
      await modal.success("Discount deactivated", discountLabel(discount));
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const activateDiscount = async (discount) => {
    const productId = getDiscountProductId(discount);
    if (!productId) {
      setError("Product is missing for this discount.");
      return;
    }
    const confirmed = await modal.confirm({
      title: "Activate discount?",
      message: "This offer will start applying in POS when its date range and minimum quantity match.",
      confirmLabel: "Activate",
      cancelLabel: "Keep inactive",
    });
    if (!confirmed) return;
    setIsLoading(true);
    try {
      await api.updateProductDiscount(productId, discount.id, { isActive: true });
      await loadDiscounts();
      await modal.success("Discount activated", discountLabel(discount));
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const deleteDiscount = async (discount) => {
    const productId = getDiscountProductId(discount);
    if (!productId) {
      setError("Product is missing for this discount.");
      return;
    }
    const confirmed = await modal.confirm({
      title: "Delete discount?",
      message: "This will permanently remove the discount from the product.",
      confirmLabel: "Delete",
      cancelLabel: "Keep discount",
      tone: "danger",
    });
    if (!confirmed) return;
    setIsLoading(true);
    try {
      await api.deleteProductDiscount(productId, discount.id);
      await loadDiscounts();
      if (editingDiscount?.id === discount.id) resetForm(productId || selectedProductId);
      await modal.success("Discount deleted", discountLabel(discount));
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const renderDiscountForm = ({ inModal = false } = {}) => (
    <View style={inModal ? styles.modalFormCard : styles.card}>
      {!inModal ? (
        <View style={styles.cardHeader}>
          <View style={styles.modalTitleWrap}>
            <Text style={styles.cardTitle}>New date-bound discount</Text>
            <Text style={styles.cardSubtitle}>Discounts require a start and end date and are applied automatically during that window.</Text>
          </View>
        </View>
      ) : null}
      {!!error && <Text style={styles.errorText}>{error}</Text>}
      {hasOverlapWarning ? <Text style={styles.warningText}>This range overlaps another active discount.</Text> : null}
      <SearchablePicker
        label="Product"
        options={productOptions}
        activeValue={selectedProductId}
        onChange={(value) => {
          setSelectedProductId(value);
          setForm((current) => ({ ...current, productId: value }));
        }}
        placeholder="Select a product"
        searchKeys={["label", "hint"]}
      />
      <View style={styles.formGrid}>
        <View style={styles.segmentGroup}>
          <Text style={styles.fieldLabel}>Discount type</Text>
          <View style={styles.segmentRow}>
            {["percentage", "fixed"].map((type) => (
              <Text
                key={type}
                onPress={() => updateForm("discountType", type)}
                style={[styles.segmentOption, form.discountType === type && styles.segmentOptionActive]}
              >
                {type === "percentage" ? "Percentage" : "Fixed amount"}
              </Text>
            ))}
          </View>
        </View>
        <View style={styles.segmentGroup}>
          <Text style={styles.fieldLabel}>Offer status</Text>
          <View style={styles.segmentRow}>
            {[
              { label: "Active", value: true },
              { label: "Inactive", value: false },
            ].map((option) => (
              <Text
                key={option.label}
                onPress={() => updateForm("isActive", option.value)}
                style={[styles.segmentOption, form.isActive === option.value && styles.segmentOptionActive]}
              >
                {option.label}
              </Text>
            ))}
          </View>
        </View>
        <FormField
          label={form.discountType === "fixed" ? "Discount amount" : "Discount percentage"}
          value={form.discountValue}
          onChangeText={(value) => updateForm("discountValue", value)}
          placeholder={form.discountType === "fixed" ? "Amount off" : "Percent off"}
        />
      </View>
      <View style={styles.formGrid}>
        <FormField
          label="Apply from quantity"
          value={form.minQuantity}
          onChangeText={(value) => updateForm("minQuantity", value)}
          placeholder="1"
        />
      </View>
      <View style={styles.dateRangePanel}>
        <View style={styles.dateRangeHeader}>
          <View>
            <Text style={styles.fieldLabel}>Offer duration</Text>
            <Text style={styles.cardSubtitle}>Pick the start and end dates from the calendar.</Text>
          </View>
          <Text style={styles.durationPill}>{durationLabel(form.startDate, form.endDate)}</Text>
        </View>
        <View style={styles.formGrid}>
          <FormField
            label="Start date"
            value={form.startDate}
            onChangeText={(value) => updateForm("startDate", value)}
            placeholder="YYYY-MM-DD"
            type="date"
          />
          <FormField
            label="End date"
            value={form.endDate}
            onChangeText={(value) => updateForm("endDate", value)}
            placeholder="YYYY-MM-DD"
            type="date"
          />
        </View>
      </View>
      <View style={styles.formGrid}>
        <FormField
          label="Description"
          value={form.description}
          onChangeText={(value) => updateForm("description", value)}
          placeholder="Optional description"
        />
      </View>
      <AppButton disabled={isBusy || isLoading} label={editingDiscount ? "Update discount" : "Save discount"} onPress={handleSaveDiscount} />
    </View>
  );

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <ScreenHeader
        eyebrow="Discounts"
        title="Manage product offers"
        subtitle="Attach date-bound discounts to products. Sale orders apply them only while the offer is active."
        iconLabel="%"
        iconTone="danger"
      />

      <View style={styles.overviewStrip}>
        <View style={styles.summaryTile}>
          <Text style={styles.summaryLabel}>Products with offers</Text>
          <Text style={styles.summaryValue}>{productsWithOffersCount}</Text>
          <Text style={styles.summaryHint}>{discounts.length} total discount record{discounts.length === 1 ? "" : "s"}</Text>
        </View>
        <View style={styles.summaryTile}>
          <Text style={styles.summaryLabel}>Products active now</Text>
          <Text style={styles.summaryValue}>{productsActiveNowCount}</Text>
          <Text style={styles.summaryHint}>
            {activeDiscounts.length} active offer record{activeDiscounts.length === 1 ? "" : "s"}
          </Text>
        </View>
        <View style={styles.summaryTile}>
          <Text style={styles.summaryLabel}>Products upcoming</Text>
          <Text style={styles.summaryValue}>{upcomingProductsCount}</Text>
          <Text style={styles.summaryHint}>
            {upcomingDiscounts.length} scheduled offer record{upcomingDiscounts.length === 1 ? "" : "s"}
          </Text>
        </View>
      </View>
      {duplicateActiveOfferCount > 0 ? (
        <View style={styles.dataWarning}>
          <Text style={styles.dataWarningTitle}>Duplicate active offers found</Text>
          <Text style={styles.dataWarningText}>
            {duplicateActiveOfferCount} extra active discount record{duplicateActiveOfferCount === 1 ? "" : "s"} overlap existing products. New saves are blocked from creating overlaps; edit or deactivate the older record to keep one active offer per product window.
          </Text>
        </View>
      ) : null}

      <View style={styles.productSummary}>
        {selectedProduct ? (
          <>
            <View style={styles.productSummaryMain}>
              <Text style={styles.summaryLabel}>Selected product</Text>
              <Text style={styles.productSummaryTitle}>{selectedProduct.name}</Text>
              <Text style={styles.cardSubtitle}>
                {selectedProduct.category || "Uncategorised"} · {selectedProduct.supplier || "Supplier not assigned"} · {selectedProductCode}
              </Text>
              <View style={styles.productMetricRow}>
                <ProductMetric label="Sale price" value={formatCurrency(salePrice)} />
                <ProductMetric label="Stock" value={productStockLabel(selectedProduct)} />
                <ProductMetric label="Offers" value={`${selectedProductDiscounts.length} total`} />
                <ProductMetric label="Active now" value={`${selectedProductActiveOfferCount} active`} />
              </View>
            </View>
            <View style={styles.pricePreview}>
              <Text style={styles.summaryLabel}>Current preview</Text>
              <PriceLine label="Original price" value={formatCurrency(salePrice)} />
              <PriceLine label="New discount" value={`-${formatCurrency(Math.min(previewDiscountAmount || 0, salePrice))}`} tone="success" />
              <View style={styles.previewDivider} />
              <PriceLine label="Final price" value={formatCurrency(finalPreviewPrice)} strong />
              <Text style={styles.previewHint}>
                {selectedActiveDiscount ? `Active offer: ${discountLabel(selectedActiveDiscount)}` : selectedUpcomingDiscountCount ? `${selectedUpcomingDiscountCount} upcoming offer${selectedUpcomingDiscountCount === 1 ? "" : "s"}` : "No active offer for this product"}
              </Text>
            </View>
          </>
        ) : (
          <View style={styles.productEmptyState}>
            <Text style={styles.summaryLabel}>Product context</Text>
            <Text style={styles.productSummaryTitle}>Select a product to preview pricing</Text>
            <Text style={styles.cardSubtitle}>The panel updates with sale price, stock, existing offers, and the final price before you save.</Text>
          </View>
        )}
      </View>

      {!editingDiscount ? renderDiscountForm() : null}

      <Modal
        animationType="fade"
        onRequestClose={() => resetForm(selectedProductId)}
        transparent
        visible={Boolean(editingDiscount)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHeader}>
              <View style={styles.modalTitleWrap}>
                <Text style={styles.cardTitle}>Edit product discount</Text>
                <Text style={styles.cardSubtitle}>{selectedProduct?.name || "Selected product"}</Text>
              </View>
              <TouchableOpacity
                accessibilityLabel="Close discount editor"
                activeOpacity={0.85}
                onPress={() => resetForm(selectedProductId)}
                style={styles.modalCloseButton}
              >
                <Text style={styles.modalCloseText}>×</Text>
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={styles.modalScroll} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
              {renderDiscountForm({ inModal: true })}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <View>
            <Text style={styles.cardTitle}>All product discounts</Text>
            <Text style={styles.cardSubtitle}>Every product offer from the database, grouped by duration and status.</Text>
          </View>
        </View>
        <View style={styles.ruleNote}>
          <Text style={styles.ruleNoteTitle}>Application rule</Text>
          <Text style={styles.ruleNoteText}>
            Only one active discount can overlap a product date range. Sale orders apply the active discount only when the order quantity meets the minimum quantity.
          </Text>
        </View>
        <View style={styles.timelineFilters}>
          {timelineFilters.map((filter) => (
            <TouchableOpacity
              key={filter}
              activeOpacity={0.85}
              onPress={() => setTimelineFilter(filter)}
              style={[styles.timelineFilter, timelineFilter === filter && styles.timelineFilterActive]}
            >
              <Text style={[styles.timelineFilterText, timelineFilter === filter && styles.timelineFilterTextActive]}>{filter}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {filteredDiscounts.length === 0 ? (
          <Text style={styles.emptyText}>No discounts match the current timeline filter.</Text>
        ) : (
          filteredDiscounts.map((discount) => {
            const status = discountStatus(discount);
            const discountProduct = productById.get(getDiscountProductId(discount));
            const startDate = getDiscountStartDate(discount);
            const endDate = getDiscountEndDate(discount);
            return (
            <View key={discount.id} style={styles.discountRow}>
              <View style={styles.discountInfo}>
                <View style={styles.discountTitleRow}>
                  <Text style={styles.discountTitle}>{discountLabel(discount)}</Text>
                  <Text style={[styles.statusBadge, styles[`${status.tone}StatusBadge`]]}>{status.label}</Text>
                </View>
                <Text style={styles.discountProductName} numberOfLines={1}>
                  {discountProduct?.name || `Product #${getDiscountProductId(discount) || "-"}`} · {discountProduct?.sku || "SKU not available"}
                </Text>
                <Text style={styles.discountSubtitle} numberOfLines={1}>
                  {quantityRuleLabel(discount)} · {discount.description || "No description provided."}
                </Text>
              </View>
              <View style={styles.discountMeta}>
                <Text style={styles.discountValue}>{getDiscountType(discount) === "fixed" ? "Fixed" : "Percentage"}</Text>
                <Text style={styles.discountDates}>
                  {startDate ? formatDate(startDate) : "No start"} - {endDate ? formatDate(endDate) : "No end"}
                </Text>
                <Text style={styles.durationText}>{durationLabel(startDate, endDate)}</Text>
                <View style={styles.discountActions}>
                  <TouchableOpacity activeOpacity={0.85} onPress={() => editDiscount(discount)} style={styles.textButton}>
                    <Text style={styles.textButtonLabel}>Edit</Text>
                  </TouchableOpacity>
                  {isDiscountActive(discount) ? (
                    <TouchableOpacity activeOpacity={0.85} onPress={() => deactivateDiscount(discount)} style={styles.textButtonDanger}>
                      <Text style={styles.textButtonDangerLabel}>Deactivate</Text>
                    </TouchableOpacity>
                  ) : (
                    <TouchableOpacity activeOpacity={0.85} onPress={() => activateDiscount(discount)} style={styles.textButtonSuccess}>
                      <Text style={styles.textButtonSuccessLabel}>Activate</Text>
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity activeOpacity={0.85} onPress={() => deleteDiscount(discount)} style={styles.textButtonDelete}>
                    <Text style={styles.textButtonDeleteLabel}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          )})
        )}
      </View>
    </ScrollView>
  );
}

function ProductMetric({ label, value }) {
  return (
    <View style={styles.productMetric}>
      <Text style={styles.productMetricLabel}>{label}</Text>
      <Text style={styles.productMetricValue} numberOfLines={1}>{value}</Text>
    </View>
  );
}

function PriceLine({ label, value, strong = false, tone }) {
  return (
    <View style={styles.priceLine}>
      <Text style={styles.priceLineLabel}>{label}</Text>
      <Text style={[styles.priceLineValue, strong && styles.priceLineStrong, tone === "success" && styles.priceLineSuccess]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    gap: spacing.lg,
    paddingBottom: spacing.lg,
  },
  overviewStrip: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  summaryTile: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexBasis: 220,
    flexGrow: 1,
    gap: spacing.xs,
    padding: spacing.lg,
  },
  summaryLabel: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  summaryValue: {
    color: colors.ink,
    fontFamily: typography.headingFont,
    fontSize: 20,
    fontWeight: "700",
  },
  summaryHint: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 12,
  },
  dataWarning: {
    backgroundColor: "#FFF7ED",
    borderColor: "#FED7AA",
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  dataWarningTitle: {
    color: "#9A3412",
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  dataWarningText: {
    color: "#9A3412",
    fontFamily: typography.baseFont,
    fontSize: 13,
    lineHeight: 19,
  },
  productSummary: {
    alignItems: "stretch",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.lg,
    justifyContent: "space-between",
    padding: spacing.lg,
  },
  productSummaryMain: {
    flex: 2,
    gap: spacing.sm,
    minWidth: 260,
  },
  productEmptyState: {
    gap: spacing.xs,
    paddingVertical: spacing.sm,
  },
  productSummaryTitle: {
    color: colors.ink,
    fontFamily: typography.headingFont,
    fontSize: 20,
    fontWeight: "700",
  },
  productMetricRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  productMetric: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    flexBasis: 130,
    flexGrow: 1,
    gap: 3,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  productMetricLabel: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  productMetricValue: {
    color: colors.ink,
    fontFamily: typography.headingFont,
    fontSize: 14,
    fontWeight: "700",
  },
  pricePreview: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    gap: spacing.xs,
    flex: 1,
    minWidth: 260,
    padding: spacing.md,
  },
  priceLine: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  priceLineLabel: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 12,
  },
  priceLineValue: {
    color: colors.ink,
    fontFamily: typography.headingFont,
    fontSize: 13,
    fontWeight: "700",
  },
  priceLineSuccess: {
    color: colors.success,
  },
  priceLineStrong: {
    color: colors.primaryDark,
    fontFamily: typography.headingFont,
    fontSize: 18,
    fontWeight: "700",
  },
  previewDivider: {
    backgroundColor: colors.border,
    height: 1,
    marginVertical: spacing.xs,
  },
  previewHint: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 12,
    lineHeight: 17,
    marginTop: spacing.xs,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    padding: spacing.lg,
    gap: spacing.md,
  },
  cardHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  cardTitle: {
    color: colors.ink,
    fontFamily: typography.headingFont,
    fontSize: 18,
    fontWeight: "700",
  },
  cardSubtitle: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.xs,
  },
  modalOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(20, 31, 38, 0.62)",
    flex: 1,
    justifyContent: "center",
    padding: spacing.md,
  },
  modalCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    maxHeight: "92%",
    maxWidth: 820,
    overflow: "hidden",
    width: "100%",
  },
  modalHeader: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
    padding: spacing.lg,
  },
  modalTitleWrap: {
    flex: 1,
  },
  modalCloseButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 99,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  modalCloseText: {
    color: colors.ink,
    fontFamily: typography.headingFont,
    fontSize: 24,
    lineHeight: 28,
  },
  modalScroll: {
    padding: spacing.lg,
  },
  modalFormCard: {
    gap: spacing.md,
  },
  formRow: {
    gap: spacing.md,
    marginBottom: spacing.md,
  },
  formGrid: {
    flexDirection: "row",
    gap: spacing.md,
    flexWrap: "wrap",
  },
  segmentGroup: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 220,
  },
  fieldLabel: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  segmentRow: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    padding: 4,
  },
  segmentOption: {
    borderRadius: radii.sm,
    color: colors.muted,
    flex: 1,
    fontFamily: typography.baseFont,
    fontSize: 13,
    fontWeight: "700",
    overflow: "hidden",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    textAlign: "center",
  },
  segmentOptionActive: {
    backgroundColor: colors.primary,
    color: colors.white,
  },
  dateRangePanel: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  dateRangeHeader: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  durationPill: {
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
  secondaryAction: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 99,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  secondaryActionText: {
    color: colors.primary,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: "700",
  },
  timelineFilters: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  ruleNote: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.md,
  },
  ruleNoteTitle: {
    color: colors.primaryDark,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  ruleNoteText: {
    color: colors.primaryDark,
    fontFamily: typography.baseFont,
    fontSize: 13,
    lineHeight: 19,
  },
  timelineFilter: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 99,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  timelineFilterActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  timelineFilterText: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: "700",
  },
  timelineFilterTextActive: {
    color: colors.white,
  },
  discountRow: {
    alignItems: "center",
    backgroundColor: "#FAFCFB",
    borderRadius: radii.sm,
    borderWidth: 1,
    borderColor: "#ECE4DA",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "space-between",
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  discountInfo: {
    flex: 1,
    minWidth: 220,
  },
  discountTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  discountTitle: {
    color: colors.ink,
    fontFamily: typography.headingFont,
    fontSize: 15,
    fontWeight: "700",
  },
  discountSubtitle: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 13,
    marginTop: spacing.xs,
  },
  discountProductName: {
    color: colors.ink,
    fontFamily: typography.baseFont,
    fontSize: 13,
    fontWeight: "700",
    marginTop: spacing.xs,
  },
  discountMeta: {
    alignItems: "flex-end",
    minWidth: 180,
  },
  discountActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "flex-end",
    marginTop: spacing.sm,
  },
  textButton: {
    backgroundColor: colors.primarySoft,
    borderRadius: 99,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  textButtonLabel: {
    color: colors.primary,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: "700",
  },
  textButtonDanger: {
    backgroundColor: colors.dangerSoft,
    borderRadius: 99,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  textButtonDangerLabel: {
    color: colors.danger,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: "700",
  },
  textButtonDelete: {
    backgroundColor: colors.surface,
    borderColor: colors.danger,
    borderRadius: 99,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  textButtonDeleteLabel: {
    color: colors.danger,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: "700",
  },
  textButtonSuccess: {
    backgroundColor: colors.successSoft,
    borderRadius: 99,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  textButtonSuccessLabel: {
    color: colors.success,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: "700",
  },
  discountValue: {
    color: colors.primary,
    fontFamily: typography.headingFont,
    fontSize: 16,
    fontWeight: "700",
  },
  discountDates: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 12,
    marginTop: spacing.xs,
  },
  durationText: {
    color: colors.primaryDark,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: "700",
    marginTop: spacing.xs,
  },
  statusBadge: {
    borderRadius: 99,
    fontFamily: typography.baseFont,
    fontSize: 10,
    fontWeight: "700",
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    textTransform: "uppercase",
  },
  successStatusBadge: {
    backgroundColor: colors.successSoft,
    color: colors.success,
  },
  warningStatusBadge: {
    backgroundColor: colors.warningSoft,
    color: colors.warning,
  },
  mutedStatusBadge: {
    backgroundColor: colors.background,
    color: colors.muted,
  },
  emptyText: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 14,
  },
  errorText: {
    color: colors.danger,
    fontFamily: typography.baseFont,
    fontSize: 13,
    marginBottom: spacing.sm,
  },
  warningText: {
    backgroundColor: colors.warningSoft,
    borderRadius: radii.sm,
    color: colors.warning,
    fontFamily: typography.baseFont,
    fontSize: 13,
    fontWeight: "700",
    padding: spacing.sm,
  },
});
