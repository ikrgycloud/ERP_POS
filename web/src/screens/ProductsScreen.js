import React, { useEffect, useMemo, useRef, useState } from "react";
import { Image, Linking, Modal, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from "react-native";
import { AppButton } from "../components/AppButton";
import { FilterChips } from "../components/FilterChips";
import { FormField } from "../components/FormField";
import { PaginationControls } from "../components/PaginationControls";
import { SearchablePicker } from "../components/SearchablePicker";
import { SearchInput } from "../components/SearchInput";
import { ScreenHeader } from "../components/ScreenHeader";
import { useModal } from "../components/ModalProvider";
import { api } from "../services/api";
import { colors, radii, responsiveCardBasis, spacing } from "../constants/theme";
import { getProductMetrics } from "../utils/erpCalculations";
import { formatCurrency, formatDate, formatNumber, formatPercent } from "../utils/formatters";
import { isNonNegativeNumber, isPositiveNumber } from "../utils/validation";

const emptyProductForm = {
  buyPrice: "",
  category: "",
  categoryId: null,
  gstRate: "18",
  mrp: "",
  name: "",
  packagePrice: "",
  packageSize: "1",
  packageSizeUnit: "Unit",
  qtyBought: "0",
  qtySold: "0",
  quantityOptions: "",
  reorderLevel: "0",
  sellPrice: "",
  supplier: "",
  supplierId: null,
  unitLabel: "Pieces",
  unitType: "pieces",
};

const PAGE_SIZE = 12;

function createProductRequestKey() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `product-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const productFormats = [
  { label: "Tons", unitType: "tons", unitLabel: "Tons", packageSizeUnit: "Ton", options: "1,2,4,10,20" },
  { label: "Kg", unitType: "kg", unitLabel: "Kg", packageSizeUnit: "Kg", options: "1,5,10,25,50" },
  { label: "Litres", unitType: "litres", unitLabel: "Litres", packageSizeUnit: "Litre", options: "1,5,10,20,50" },
  { label: "Packets", unitType: "packets", unitLabel: "Packets", packageSizeUnit: "Units", options: "1,5,10,25,50" },
  { label: "Bags", unitType: "bags", unitLabel: "Bags", packageSizeUnit: "Kg", options: "1,2,5,10,20" },
  { label: "Carton Boxes", unitType: "carton_boxes", unitLabel: "Carton Boxes", packageSizeUnit: "Pieces", options: "1,2,5,10,20" },
  { label: "Raw", unitType: "raw", unitLabel: "Raw", packageSizeUnit: "Raw", options: "" },
  { label: "Loose", unitType: "loose", unitLabel: "Loose", packageSizeUnit: "Loose", options: "" },
];

const packagedTypes = new Set(["packets", "bags", "carton_boxes"]);
const quickOptionExamples = {
  tons: ["1", "2", "4", "10", "20"],
  kg: ["1", "5", "10", "25", "50"],
  litres: ["1", "5", "10", "20", "50"],
  packets: ["1", "5", "10", "25", "50"],
  bags: ["1", "2", "5", "10", "20"],
  carton_boxes: ["1", "2", "5", "10", "20"],
  raw: ["Small", "Medium", "Large", "Loose"],
  loose: ["250g", "500g", "1kg", "Custom"],
};

function getFormatByUnitType(unitType) {
  return productFormats.find((format) => format.unitType === unitType) || productFormats[3];
}

function parseQuickOptions(value) {
  return String(value || "")
    .split(",")
    .map((option) => option.trim())
    .filter(Boolean);
}

function uniqueOptions(options) {
  return Array.from(new Set(options.map((option) => String(option || "").trim()).filter(Boolean)));
}

function optionsToFormPatch(options) {
  const selectedOptions = uniqueOptions(options);
  const numericTotal = selectedOptions.reduce((total, option) => {
    const number = Number(option);
    return Number.isFinite(number) ? total + number : total;
  }, 0);
  return {
    qtyBought: String(numericTotal || selectedOptions.length),
    quantityOptions: selectedOptions.join(","),
  };
}

function latestStockRecord(product) {
  return stockHistory(product)[0] || null;
}

function stockHistory(product) {
  const history = product.quantityHistory || product.quantity_history || [];
  if (!Array.isArray(history) || !history.length) {
    return [];
  }
  return [...history].sort((left, right) => {
    const rightDate = new Date(right.createdAt || right.created_at || 0).getTime() || 0;
    const leftDate = new Date(left.createdAt || left.created_at || 0).getTime() || 0;
    return rightDate - leftDate || Number(right.id || 0) - Number(left.id || 0);
  });
}

const OPERATIONAL_ADJUSTMENT_TYPES = new Set([
  "adjustment",
  "damage",
  "damaged",
  "expired",
  "expiry",
  "lost",
  "manual_adjustment",
  "return_damaged",
  "sale_reversed",
  "scrap",
  "stock_count",
  "supplier_credit",
  "supplier_reject",
  "supplier_replacement",
  "supplier_return",
  "transfer",
]);

function operationalStockAdjustment(product) {
  return stockHistory(product).reduce((total, movement) => {
    const type = String(movement.transactionType || movement.transaction_type || "").toLowerCase();
    if (!OPERATIONAL_ADJUSTMENT_TYPES.has(type)) {
      return total;
    }
    return total + Number(movement.quantityChange ?? movement.quantity_change ?? 0);
  }, 0);
}

function latestPriceChange(product) {
  const history = product.priceHistory || product.price_history || [];
  if (!Array.isArray(history) || history.length < 2) {
    return null;
  }
  const [latest, previous] = history;
  return {
    buyDiff: Number(latest.buyPrice || latest.buy_price || 0) - Number(previous.buyPrice || previous.buy_price || 0),
    mrpDiff: Number(latest.mrp || 0) - Number(previous.mrp || 0),
    sellDiff: Number(latest.sellPrice || latest.sell_price || 0) - Number(previous.sellPrice || previous.sell_price || 0),
  };
}

function formatOtherStockChange(value) {
  const numberValue = Number(value || 0);
  if (numberValue > 0) {
    return `+${formatNumber(numberValue)}`;
  }
  return formatNumber(numberValue);
}

function otherStockChangeMeaning(value) {
  const numberValue = Number(value || 0);
  if (numberValue > 0) {
    return "";
  }
  if (numberValue < 0) {
    return "Extra stock removed";
  }
  return "";
}

function readableStockMovementType(value) {
  const normalized = String(value || "").toLowerCase();
  const labels = {
    manual_adjustment: "Manual stock correction",
    opening_stock: "Opening stock",
    purchase_received: "Purchase received",
    purchase_reversed: "Purchase reversed",
    sale_delivered: "Sale delivered",
    sale_reversed: "Sale reversed",
    supplier_return: "Supplier return",
    supplier_replacement: "Supplier replacement",
    damage: "Damaged stock",
    expired: "Expired stock",
    lost: "Lost stock",
    transfer: "Stock transfer",
    stock_count: "Physical stock count",
    inventory_cache_sync: "System stock correction",
    inventory_repair: "System stock repair",
    legacy_backfill_reconciliation: "Previous stock-data correction",
  };
  return labels[normalized] || normalized.replace(/_/g, " ") || "Stock movement";
}

function movementDateText(record) {
  const value = record?.createdAt || record?.created_at || record?.effectiveDate || record?.effective_date;
  return formatDate(value);
}

function movementQuantityText(record) {
  const quantity = Number(record?.quantityChange ?? record?.quantity_change ?? 0);
  return `${quantity > 0 ? "+" : ""}${formatNumber(quantity)}`;
}

function movementDirectionLabel(quantity) {
  if (quantity > 0) return "Stock added";
  if (quantity < 0) return "Stock removed";
  return "Stock checked";
}

export function ProductsScreen({
  isBusy,
  navigationIntent,
  products,
  onCreateProduct,
  onDeleteProduct,
  onNavigationIntentHandled,
  onUpdateProduct,
}) {
  const modal = useModal();
  const { width } = useWindowDimensions();
  const productCardBasis = responsiveCardBasis(width, 3);
  const scrollRef = useRef(null);
  const hasMountedRef = useRef(false);
  const handledNavigationKeyRef = useRef(null);
  const submissionRef = useRef(false);
  const [category, setCategory] = useState("All");
  const [productFocus, setProductFocus] = useState("All Products");
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [expandedProductId, setExpandedProductId] = useState(null);
  const [editingProduct, setEditingProduct] = useState(null);
  const [restockMode, setRestockMode] = useState(false);
  const [restockQuantity, setRestockQuantity] = useState("");
  const [form, setForm] = useState(emptyProductForm);
  const [currentPage, setCurrentPage] = useState(1);
  const [masterCategories, setMasterCategories] = useState([]);
  const [masterSuppliers, setMasterSuppliers] = useState([]);
  const [formError, setFormError] = useState("");

  const loadMasters = async () => {
    try {
      const [categoriesResult, suppliersResult] = await Promise.all([
        api.getCategories(),
        api.getSuppliers(),
      ]);
      setMasterCategories(categoriesResult || []);
      setMasterSuppliers(suppliersResult || []);
    } catch {
      setMasterCategories([]);
      setMasterSuppliers([]);
    }
  };

  useEffect(() => {
    loadMasters();
  }, []);

  const categoryValues = useMemo(
    () =>
      Array.from(
        new Set([...masterCategories.map((categoryItem) => categoryItem.name), ...products.map((product) => product.category)].filter(Boolean))
      ).sort((left, right) => left.localeCompare(right)),
    [masterCategories, products]
  );

  const categories = useMemo(() => ["All", ...categoryValues], [categoryValues]);

  const productFocusOptions = useMemo(() => {
    const countByFocus = (focus) =>
      products.filter((product) => {
        const metrics = getProductMetrics(product);
        if (focus === "Available") return metrics.remaining > product.reorderLevel;
        if (focus === "Low Stock") return metrics.remaining > 0 && metrics.remaining <= product.reorderLevel;
        if (focus === "Out of Stock") return metrics.remaining <= 0;
        if (focus === "High Margin") return metrics.margin >= 25;
        if (focus === "Low Margin") return metrics.margin < 25;
        return true;
      }).length;

    return [
      { label: "All Products", tone: "neutral", count: products.length },
      { label: "Available", tone: "success", count: countByFocus("Available") },
      { label: "Low Stock", tone: "warning", count: countByFocus("Low Stock") },
      { label: "Out of Stock", tone: "danger", count: countByFocus("Out of Stock") },
      { label: "High Margin", tone: "primary", count: countByFocus("High Margin") },
      { label: "Low Margin", tone: "muted", count: countByFocus("Low Margin") },
    ];
  }, [products]);

  const categoryOptions = useMemo(
    () => masterCategories.map((categoryItem) => ({ label: categoryItem.name, value: String(categoryItem.id) })),
    [masterCategories]
  );

  const supplierOptions = useMemo(
    () =>
      masterSuppliers.map((supplierItem) => ({ label: supplierItem.name, value: String(supplierItem.id) })),
    [masterSuppliers]
  );

  const filteredProducts = useMemo(() => {
    return products.filter((product) => {
      const metrics = getProductMetrics(product);
      const matchesCategory = category === "All" || product.category === category;
      const matchesFocus =
        productFocus === "All Products" ||
        (productFocus === "Available" && metrics.remaining > product.reorderLevel) ||
        (productFocus === "Low Stock" && metrics.remaining > 0 && metrics.remaining <= product.reorderLevel) ||
        (productFocus === "Out of Stock" && metrics.remaining <= 0) ||
        (productFocus === "High Margin" && metrics.margin >= 25) ||
        (productFocus === "Low Margin" && metrics.margin < 25);
      const matchesSearch = [
        product.name,
        product.sku,
        product.barcode,
        product.category,
        product.supplier,
        product.unitType,
        product.unitLabel,
        product.packageSizeUnit,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search.toLowerCase());

      return matchesCategory && matchesFocus && matchesSearch;
    });
  }, [category, productFocus, products, search]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [category, productFocus, search]);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    scrollRef.current?.scrollTo({ animated: true, y: 0 });
  }, [currentPage]);

  const visibleProducts = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    return filteredProducts.slice(startIndex, startIndex + PAGE_SIZE);
  }, [currentPage, filteredProducts]);

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === expandedProductId) || null,
    [expandedProductId, products]
  );

  const clearFilters = () => {
    setCategory("All");
    setProductFocus("All Products");
    setSearch("");
    setCurrentPage(1);
  };

  const handlePageChange = (page) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  const activeFilterCount = [
    search,
    category !== "All",
    productFocus !== "All Products",
  ].filter(Boolean).length;

  const emptyState = useMemo(() => {
    if (!products.length) {
      return {
        title: "No products yet",
        message: "Add your first product to start tracking inventory.",
      };
    }

    if (productFocus !== "All Products") {
      return {
        title: `No ${productFocus.toLowerCase()} products`,
        message: "Choose another product status or reset the filters to view products.",
      };
    }

    if (category !== "All") {
      return {
        title: `No products in ${category}`,
        message: "Choose another category or reset the filters to view products.",
      };
    }

    return {
      title: "No matching products",
      message: "Try a different search term or reset the filters.",
    };
  }, [category, productFocus, products.length]);

  const updateForm = (key, value) => {
    setFormError("");
    setForm((current) => ({ ...current, [key]: value }));
  };

  const updateQuantityOptions = (value) => {
    setForm((current) => ({
      ...current,
      ...optionsToFormPatch(parseQuickOptions(value)),
    }));
  };

  const selectCategory = (categoryId) => {
    const selectedCategory = masterCategories.find((categoryItem) => String(categoryItem.id) === String(categoryId));
    setForm((current) => ({
      ...current,
      category: selectedCategory?.name || current.category,
      categoryId: selectedCategory?.id || null,
    }));
  };

  const typeCategory = (value) => {
    setForm((current) => ({ ...current, category: value, categoryId: null }));
  };

  const selectSupplier = (supplierId) => {
    const selectedSupplier = masterSuppliers.find((supplierItem) => String(supplierItem.id) === String(supplierId));
    setForm((current) => ({
      ...current,
      supplier: selectedSupplier?.name || current.supplier,
      supplierId: selectedSupplier?.id || null,
    }));
  };

  const typeSupplier = (value) => {
    setForm((current) => ({ ...current, supplier: value, supplierId: null }));
  };

  const updateProductFormat = (label) => {
    const selectedFormat = productFormats.find((format) => format.label === label) || productFormats[3];
    setForm((current) => ({
      ...current,
      packageSize: packagedTypes.has(selectedFormat.unitType) ? current.packageSize || "1" : "1",
      packageSizeUnit: selectedFormat.packageSizeUnit,
      qtyBought: "0",
      quantityOptions: "",
      unitLabel: selectedFormat.unitLabel,
      unitType: selectedFormat.unitType,
    }));
  };

  const toggleQuickOption = (option) => {
    setForm((current) => {
      const options = parseQuickOptions(current.quantityOptions);
      const nextOptions = options.includes(option)
        ? options.filter((item) => item !== option)
        : [...options, option];
      return { ...current, ...optionsToFormPatch(nextOptions) };
    });
  };

  const applyQuickExampleSet = (options) => {
    setForm((current) => ({ ...current, ...optionsToFormPatch(options) }));
  };

  const openCreateForm = () => {
    setFormError("");
    setEditingProduct(null);
    setRestockMode(false);
    setRestockQuantity("");
    setForm(emptyProductForm);
    setShowForm(true);
  };

  const closeProductForm = () => {
    setShowForm(false);
    setEditingProduct(null);
    setRestockMode(false);
    setRestockQuantity("");
    setFormError("");
    setForm(emptyProductForm);
  };

  const openEditForm = (product, options = {}) => {
    const metrics = getProductMetrics(product);
    const minimumRestock = Math.max(
      1,
      Math.ceil(Number(product.reorderLevel || 0) - Number(metrics.remaining || 0) + 1)
    );
    setFormError("");
    setEditingProduct(product);
    setRestockMode(options.mode === "restock");
    setRestockQuantity(options.mode === "restock" ? String(minimumRestock) : "");
    setForm({
      buyPrice: String(product.buyPrice),
      category: product.category,
      categoryId: product.categoryId || null,
      gstRate: String(product.gstRate),
      mrp: String(product.mrp),
      name: product.name,
      packagePrice: String(product.packagePrice || ""),
      packageSize: String(product.packageSize || "1"),
      packageSizeUnit: product.packageSizeUnit || "Unit",
      qtyBought: String(product.qtyBought),
      qtySold: String(product.qtySold),
      quantityOptions: product.quantityOptions || "",
      reorderLevel: String(product.reorderLevel ?? "0"),
      sellPrice: String(product.sellPrice),
      supplier: product.supplier,
      supplierId: product.supplierId || null,
      unitLabel: product.unitLabel || "Pieces",
      unitType: product.unitType || "pieces",
    });
    setShowForm(true);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ animated: true, y: 0 });
    });
  };

  useEffect(() => {
    if (!navigationIntent?.key || handledNavigationKeyRef.current === navigationIntent.key) {
      return;
    }

    handledNavigationKeyRef.current = navigationIntent.key;
    if (navigationIntent.openCreateForm) {
      openCreateForm();
    } else if (navigationIntent.productId) {
      const product = products.find((item) => String(item.id) === String(navigationIntent.productId));
      if (product) {
        openEditForm(product, { mode: navigationIntent.mode });
      }
    }
    onNavigationIntentHandled?.(navigationIntent.key);
  }, [navigationIntent?.key, navigationIntent?.openCreateForm, navigationIntent?.productId, onNavigationIntentHandled, products]);

  const submitProduct = async () => {
    if (!form.name.trim()) {
      setFormError("Product name is required");
      return;
    }
    if (!form.category.trim()) {
      setFormError("Category is required");
      return;
    }
    if (!form.supplier.trim()) {
      setFormError("Supplier is required");
      return;
    }
    if (!isNonNegativeNumber(form.qtyBought) || !isNonNegativeNumber(form.qtySold)) {
      setFormError("Bought and sold quantities must be valid numbers");
      return;
    }
    if (Number(form.qtySold || 0) > Number(form.qtyBought || 0)) {
      setFormError("Sold quantity cannot be more than bought quantity");
      return;
    }
    if (!isPositiveNumber(form.mrp) || !isPositiveNumber(form.buyPrice) || !isPositiveNumber(form.sellPrice)) {
      setFormError("MRP, buy price, and sell price must be greater than 0");
      return;
    }
    if (!isNonNegativeNumber(form.gstRate)) {
      setFormError("GST percentage must be a valid number");
      return;
    }
    if (!isNonNegativeNumber(form.reorderLevel)) {
      setFormError("Reorder level must be a valid number");
      return;
    }
    if (restockMode && (!isPositiveNumber(restockQuantity) || Number(restockQuantity) <= 0)) {
      setFormError("Restock quantity must be greater than 0");
      return;
    }
    if (submissionRef.current || isBusy) {
      return;
    }
    submissionRef.current = true;
    try {
    let categoryId = form.categoryId;
    let supplierId = form.supplierId;
    if (!categoryId && form.category.trim()) {
      const categoryRecord = await api.createCategory({ name: form.category.trim() });
      categoryId = categoryRecord.id;
    }
    if (!supplierId && form.supplier.trim()) {
      const supplierRecord = await api.createSupplier({ name: form.supplier.trim() });
      supplierId = supplierRecord.id;
    }
    const restockAddition = restockMode ? Number(restockQuantity || 0) : 0;
    const payload = {
      ...form,
      buyPrice: Number(form.buyPrice || 0),
      categoryId,
      gstRate: Number(form.gstRate || 0),
      mrp: Number(form.mrp || 0),
      packagePrice: form.packagePrice ? Number(form.packagePrice || 0) : null,
      packageSize: form.packageSize ? Number(form.packageSize || 0) : null,
      qtyBought: Number(form.qtyBought || 0) + restockAddition,
      qtySold: Number(form.qtySold || 0),
      reorderLevel: Math.max(0, Number(form.reorderLevel || 0)),
      sellPrice: Number(form.sellPrice || 0),
      supplierId,
    };
    if (!editingProduct) {
      delete payload.sku;
    }
    const savedProduct = editingProduct
      ? await onUpdateProduct(editingProduct.id, payload)
      : await onCreateProduct(payload, createProductRequestKey());
    setShowForm(false);
    setEditingProduct(null);
    setRestockMode(false);
    setRestockQuantity("");
    setFormError("");
    setForm(emptyProductForm);
    // Refresh picker data without awaiting it so it cannot delay the success
    // feedback or freeze the product screen.
    void loadMasters();
    await modal.success(
      restockMode ? "Stock updated successfully" : editingProduct ? "Product updated successfully" : "Product created successfully",
      savedProduct?.name || payload.name
    );
    } catch (error) {
      setFormError(error?.message || "Unable to save product");
    } finally {
      submissionRef.current = false;
    }
  };

  const confirmDelete = async (product) => {
    const confirmed = await modal.confirm({
      cancelLabel: "Keep product",
      confirmLabel: "Delete",
      message: product.name,
      title: "Delete product?",
      tone: "danger",
    });
    if (confirmed) {
      await onDeleteProduct(product.id);
      await modal.success("Product deleted successfully", product.name);
    }
  };

  const selectedQuantityOptions = parseQuickOptions(form.quantityOptions);

  return (
    <>
      <ScrollView
        ref={scrollRef}
        style={styles.screen}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
      >
      <ScreenHeader
        eyebrow="Inventory"
        iconLabel="P"
        iconTone="warning"
        title="Products"
        subtitle="Track bought quantity, sold quantity, remaining stock, MRP, buy price, sale price, and profit."
      />

      <View style={styles.filterPanel}>
        <View style={styles.productToolbar}>
          <View>
            <Text style={styles.toolbarTitle}>{formatNumber(filteredProducts.length)} products</Text>
            <Text style={styles.toolbarSubtitle}>{formatNumber(products.length)} total products tracked</Text>
          </View>
          <AppButton label="Add Product" disabled={isBusy} onPress={openCreateForm} />
        </View>
        {showForm && (
          <Modal animationType="fade" transparent visible={showForm} onRequestClose={closeProductForm}>
            <View style={styles.formModalOverlay}>
              <View style={styles.productFormModal}>
                <View style={styles.formModalHeader}>
                  <View style={styles.modalTitleWrap}>
                    <Text style={styles.formTitle}>{restockMode ? "Restock product" : editingProduct ? "Edit product" : "Add product"}</Text>
                    <Text style={styles.modalSubtitle}>
                      {restockMode
                        ? `Add stock to ${editingProduct?.sku || "selected product"}`
                        : editingProduct
                          ? `Product code: ${editingProduct.sku}`
                          : "Create a new inventory product"}
                    </Text>
                  </View>
                  <TouchableOpacity activeOpacity={0.85} onPress={closeProductForm} style={styles.modalCloseButton}>
                    <Text style={styles.modalCloseText}>Close</Text>
                  </TouchableOpacity>
                </View>
                <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.formModalBody}>
                  <View style={styles.formSection}>
                    <Text style={styles.formSectionTitle}>Identity</Text>
                    <Text style={styles.formSectionHint}>Start with a name, then select an existing category and supplier or type a new one.</Text>
                    <FormField label="Product name" value={form.name} onChangeText={(value) => updateForm("name", value)} placeholder="e.g. Basmati Rice 5 kg" />
                    <View style={styles.twoColumn}>
                      <SearchablePicker activeValue={form.categoryId ? String(form.categoryId) : ""} allowCustomValue disabled={isBusy} dropdownTitle="Saved categories" emptyText="No saved categories yet. Type a new category above to create it when saving." helperText="Search saved categories or type a new one." inputValue={form.category} label="Category" onChange={selectCategory} onInputChange={typeCategory} options={categoryOptions} overlayDropdown showDropdownIndicator placeholder="Search or create category" />
                      <SearchablePicker activeValue={form.supplierId ? String(form.supplierId) : ""} allowCustomValue disabled={isBusy} dropdownTitle="Saved suppliers" emptyText="No saved suppliers yet. Type a new supplier above to create it when saving." helperText="Search saved suppliers or type a new one." inputValue={form.supplier} label="Supplier" onChange={selectSupplier} onInputChange={typeSupplier} options={supplierOptions} overlayDropdown showDropdownIndicator placeholder="Search or create supplier" />
                    </View>
                  </View>
                  <View style={styles.formSection}>
                    <Text style={styles.formSectionTitle}>Packaging</Text>
                    <Text style={styles.formSectionHint}>Choose how this product is stocked and sold. Pack options are optional.</Text>
                    <Text style={styles.fieldGroupLabel}>Product format</Text>
                    <FilterChips activeValue={getFormatByUnitType(form.unitType).label} disabled={isBusy} onChange={updateProductFormat} options={productFormats.map((format) => format.label)} />
                    <View style={styles.optionInlineCard}>
                      <View style={styles.optionInlineTop}>
                        <View style={styles.flexItem}><FormField label="Unit label" value={form.unitLabel} onChangeText={(value) => updateForm("unitLabel", value)} placeholder="Kg / Litres / Bags" /></View>
                        <View style={styles.flexItem}><FormField label="Quantity options" value={form.quantityOptions} onChangeText={updateQuantityOptions} placeholder="Type 1,2,5,10" /></View>
                      </View>
                      {packagedTypes.has(form.unitType) && (
                        <View style={styles.twoColumn}>
                          <FormField keyboardType="numeric" label={`Content per ${form.unitLabel || "pack"} (${form.packageSizeUnit || "units"})`} value={form.packageSize} onChangeText={(value) => updateForm("packageSize", value)} placeholder="0" />
                          <FormField keyboardType="numeric" label="One pack price" value={form.packagePrice} onChangeText={(value) => updateForm("packagePrice", value)} placeholder="0" />
                        </View>
                      )}
                      <View style={styles.quantityOptionsSubSection}>
                        <View style={styles.selectedOptionsSummary}>
                          <Text style={styles.selectedOptionsTitle}>Selected total: {form.qtyBought}</Text>
                          <Text style={styles.selectedOptionsHint}>Bought qty auto updates from selected option values.</Text>
                        </View>
                        <View style={styles.quickOptionsGrid}>
                          {(quickOptionExamples[form.unitType] || []).map((option) => {
                            const selected = parseQuickOptions(form.quantityOptions).includes(option);
                            return <TouchableOpacity activeOpacity={0.85} disabled={isBusy} key={option} onPress={() => toggleQuickOption(option)} style={[styles.quickOptionBox, selected && styles.quickOptionBoxActive]}><Text style={[styles.quickOptionText, selected && styles.quickOptionTextActive]}>{option}</Text></TouchableOpacity>;
                          })}
                          <TouchableOpacity activeOpacity={0.85} disabled={isBusy} onPress={() => applyQuickExampleSet(quickOptionExamples[form.unitType] || [])} style={styles.quickOptionAction}><Text style={styles.quickOptionActionText}>All</Text></TouchableOpacity>
                          <TouchableOpacity activeOpacity={0.85} disabled={isBusy} onPress={() => setForm((current) => ({ ...current, ...optionsToFormPatch([]) }))} style={[styles.quickOptionAction, styles.quickOptionClear]}><Text style={[styles.quickOptionActionText, styles.quickOptionClearText]}>Clear</Text></TouchableOpacity>
                        </View>
                      </View>
                    </View>
                  </View>
                  <View style={styles.formSection}>
                    <Text style={styles.formSectionTitle}>Stock</Text>
                    <Text style={styles.formSectionHint}>{restockMode ? "Add only the quantity received." : "Set the opening quantity and the level at which this item needs reordering."}</Text>
                    {restockMode ? (
                      <View style={styles.restockNotice}>
                        <Text style={styles.restockNoticeTitle}>Additive restock</Text>
                        <Text style={styles.restockNoticeText}>
                          Current bought quantity stays as the baseline. Enter only the new quantity received.
                        </Text>
                      </View>
                    ) : null}
                    <View style={styles.twoColumn}>
                      <FormField keyboardType="numeric" label={editingProduct ? "Bought qty" : "Opening quantity"} value={form.qtyBought} onChangeText={(value) => updateForm("qtyBought", value)} placeholder="0" />
                      {editingProduct && !restockMode ? <FormField keyboardType="numeric" label="Sold qty" value={form.qtySold} onChangeText={(value) => updateForm("qtySold", value)} placeholder="0" /> : null}
                      <FormField keyboardType="numeric" label="Reorder level" value={form.reorderLevel} onChangeText={(value) => updateForm("reorderLevel", value)} placeholder="0" />
                    </View>
                    {restockMode ? (
                      <View style={styles.twoColumn}>
                        <FormField
                          keyboardType="numeric"
                          label="Restock quantity"
                          value={restockQuantity}
                          onChangeText={(value) => setRestockQuantity(value.replace(/[^\d.]/g, ""))}
                          placeholder="0"
                        />
                        <View style={styles.restockTotalCard}>
                          <Text style={styles.restockTotalLabel}>New bought qty</Text>
                          <Text style={styles.restockTotalValue}>
                            {formatNumber(Number(form.qtyBought || 0) + Number(restockQuantity || 0))}
                          </Text>
                        </View>
                      </View>
                    ) : null}
                  </View>
                  <View style={styles.formSection}>
                    <Text style={styles.formSectionTitle}>Pricing</Text>
                    <Text style={styles.formSectionHint}>Enter the product’s cost, selling price, and applicable tax.</Text>
                    <View style={styles.twoColumn}>
                      <FormField keyboardType="numeric" label="MRP" value={form.mrp} onChangeText={(value) => updateForm("mrp", value)} placeholder="0" />
                      <FormField keyboardType="numeric" label="Buy price" value={form.buyPrice} onChangeText={(value) => updateForm("buyPrice", value)} placeholder="0" />
                      <FormField keyboardType="numeric" label="Sell price" value={form.sellPrice} onChangeText={(value) => updateForm("sellPrice", value)} placeholder="0" />
                      <FormField keyboardType="numeric" label="GST %" value={form.gstRate} onChangeText={(value) => updateForm("gstRate", value)} placeholder="18" />
                    </View>
                  </View>
                  {!!formError && <Text style={styles.formErrorText}>{formError}</Text>}
                  <View style={styles.formModalActions}>
                    <TouchableOpacity activeOpacity={0.85} disabled={isBusy} onPress={closeProductForm} style={styles.cancelFormButton}>
                      <Text style={styles.cancelFormText}>Cancel</Text>
                    </TouchableOpacity>
                    <View style={styles.submitFormWrap}>
                      <AppButton
                        disabled={isBusy}
                        label={restockMode ? "Update Stock" : editingProduct ? "Update Product" : "Save Product"}
                        onPress={submitProduct}
                      />
                    </View>
                  </View>
                </ScrollView>
              </View>
            </View>
          </Modal>
        )}

        <View style={styles.productControlCard}>
          <View style={styles.productControlTop}>
            <View style={styles.productSearchWrap}>
              <Text style={styles.controlLabel}>Find product</Text>
              <SearchInput
                disabled={isBusy}
                placeholder="Search name, SKU, category, supplier or unit"
                value={search}
                onChangeText={setSearch}
              />
            </View>
            {activeFilterCount > 0 && (
              <TouchableOpacity activeOpacity={0.85} onPress={clearFilters} style={styles.resetFiltersButton}>
                <Text style={styles.resetFiltersText}>Reset</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={styles.productFocusGrid}>
            {productFocusOptions.map((option) => (
              <ProductFocusButton
                count={option.count}
                disabled={isBusy}
                isActive={productFocus === option.label}
                key={option.label}
                label={option.label}
                onPress={() => setProductFocus(option.label)}
                tone={option.tone}
              />
            ))}
          </View>
          <View style={styles.categoryFilterBlock}>
            <View style={styles.categoryFilterHeader}>
              <Text style={styles.controlLabel}>Category</Text>
              <Text style={styles.filterResultText}>
                Showing {formatNumber(filteredProducts.length)} of {formatNumber(products.length)}
              </Text>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.categoryRail}>
              {categories.map((categoryOption) => {
                const isActive = category === categoryOption;
                const count = categoryOption === "All"
                  ? products.length
                  : products.filter((product) => product.category === categoryOption).length;
                return (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    disabled={isBusy}
                    key={categoryOption}
                    onPress={() => setCategory(categoryOption)}
                    style={[styles.categoryButton, isActive && styles.categoryButtonActive]}
                  >
                    <Text style={[styles.categoryButtonText, isActive && styles.categoryButtonTextActive]}>{categoryOption}</Text>
                    <Text style={[styles.categoryButtonCount, isActive && styles.categoryButtonCountActive]}>{formatNumber(count)}</Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </View>
        </View>
      </View>

      <View style={styles.list}>
        {!visibleProducts.length ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyStateTitle}>{emptyState.title}</Text>
            <Text style={styles.emptyStateText}>{emptyState.message}</Text>
            {products.length === 0 ? (
              <View style={styles.emptyStateAction}>
                <AppButton label="Add Product" disabled={isBusy} onPress={openCreateForm} />
              </View>
            ) : activeFilterCount > 0 ? (
              <TouchableOpacity activeOpacity={0.85} onPress={clearFilters} style={styles.emptyStateResetButton}>
                <Text style={styles.emptyStateResetText}>Reset filters</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        ) : visibleProducts.map((product) => {
          const metrics = getProductMetrics(product);
          const stockAdjustment = operationalStockAdjustment(product);
          const isOutOfStock = metrics.remaining <= 0;
          const isLowStock = metrics.remaining <= product.reorderLevel;
          const stockLabel = isOutOfStock ? "Out of Stock" : isLowStock ? "Low" : "OK";

          return (
            <View key={product.id} style={[styles.card, { flexBasis: productCardBasis }]}>
              <View style={styles.cardHeader}>
                <View style={styles.titleWrap}>
                  <Text style={styles.name}>{product.name}</Text>
                  <Text style={styles.sku}>{product.sku} · {product.category}</Text>
                  <Text style={styles.sku}>
                    Format: {product.unitLabel || getFormatByUnitType(product.unitType).unitLabel}
                    {packagedTypes.has(product.unitType) && product.packageSize
                      ? ` · ${product.packageSize} ${product.packageSizeUnit || "units"} per pack`
                      : ""}
                  </Text>
                </View>
                <Text style={[styles.stockBadge, isLowStock && styles.lowStockBadge, isOutOfStock && styles.outOfStockBadge]}>
                  {stockLabel}
                </Text>
              </View>

              <View style={styles.quantityRow}>
                <Quantity label="Stock in" value={formatNumber(product.qtyBought)} />
                <Quantity label="Sold" value={formatNumber(product.qtySold)} />
                <Quantity
                  label="Adjustments"
                  hint={otherStockChangeMeaning(stockAdjustment)}
                  value={formatOtherStockChange(stockAdjustment)}
                  onInfo={() => modal.info(
                    "What are stock adjustments?",
                    "This number includes only real stock changes such as damage, expiry, returns, replacements, transfers, stock counts, and manual corrections. System sync and old-data repair entries are not included. A positive number adds stock; a negative number removes stock."
                  )}
                />
                <Quantity label="Available" value={formatNumber(metrics.remaining)} />
              </View>

              <View style={styles.priceGrid}>
                <Price label="MRP" value={formatCurrency(product.mrp)} />
                <Price label="Bought at" value={formatCurrency(product.buyPrice)} />
                <Price label="Sold at" value={formatCurrency(product.sellPrice)} />
                <Price label="GST" value={`${product.gstRate}%`} />
              </View>

              <View style={styles.actionRow}>
                <TouchableOpacity
                  activeOpacity={0.85}
                  disabled={isBusy}
                  onPress={() => setExpandedProductId(product.id)}
                  style={styles.detailsToggleButton}
                >
                  <Text style={styles.detailsToggleText}>View details</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={isBusy} style={styles.editButton} onPress={() => openEditForm(product)}>
                  <Text style={styles.editText}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity disabled={isBusy} style={styles.deleteButton} onPress={() => confirmDelete(product)}>
                  <Text style={styles.deleteText}>Delete</Text>
                </TouchableOpacity>
              </View>
            </View>
          );
        })}
      </View>

      <View style={styles.pagination}>
        <PaginationControls
          currentPage={currentPage}
          label="products"
          onPageChange={handlePageChange}
          pageSize={PAGE_SIZE}
          totalCount={filteredProducts.length}
          totalPages={totalPages}
        />
      </View>
      </ScrollView>
      <ProductDetailsOverlay
        onClose={() => setExpandedProductId(null)}
        product={selectedProduct}
        visible={!!selectedProduct}
      />
    </>
  );
}

function Quantity({ hint, label, onInfo, value }) {
  return (
    <View style={styles.quantityItem}>
      <Text style={styles.quantityValue}>{value}</Text>
      {onInfo ? (
        <TouchableOpacity
          accessibilityHint="Explains which inventory movements are included"
          accessibilityLabel="About other stock changes"
          accessibilityRole="button"
          activeOpacity={0.7}
          onPress={onInfo}
          style={styles.quantityInfoButton}
        >
          <Text style={styles.quantityLabel}>{label} ⓘ</Text>
          {!!hint && <Text style={styles.quantityHint}>{hint}</Text>}
        </TouchableOpacity>
      ) : (
        <Text style={styles.quantityLabel}>{label}</Text>
      )}
    </View>
  );
}

function Price({ label, value }) {
  return (
    <View style={styles.priceItem}>
      <Text style={styles.priceLabel}>{label}</Text>
      <Text style={styles.priceValue}>{value}</Text>
    </View>
  );
}

function ProductDetailsOverlay({ onClose, product, visible }) {
  if (!product) {
    return null;
  }

  const metrics = getProductMetrics(product);
  const movements = stockHistory(product);
  const stockRecord = latestStockRecord(product);
  const priceChange = latestPriceChange(product);
  const isOutOfStock = metrics.remaining <= 0;
  const isLowStock = metrics.remaining <= product.reorderLevel;
  const stockLabel = isOutOfStock ? "Out of Stock" : isLowStock ? "Low Stock" : "Available";
  const stockAdjustment = operationalStockAdjustment(product);
  const stockIn = Number(product.qtyBought || 0);
  const stockSold = Number(product.qtySold || 0);
  const calculatedAvailable = stockIn - stockSold + stockAdjustment;
  const isReconciledBalance = Math.abs(calculatedAvailable - Number(metrics.remaining || 0)) < 0.001;
  const stockFormula = `${formatNumber(stockIn)} received − ${formatNumber(stockSold)} sold ${stockAdjustment >= 0 ? "+" : "−"} ${formatNumber(Math.abs(stockAdjustment))} adjustments = ${formatNumber(metrics.remaining)} available`;
  const priceIncreaseText = priceChange
    ? [
        priceChange.mrpDiff ? `MRP ${priceChange.mrpDiff > 0 ? "+" : ""}${formatCurrency(priceChange.mrpDiff)}` : null,
        priceChange.buyDiff ? `Buy ${priceChange.buyDiff > 0 ? "+" : ""}${formatCurrency(priceChange.buyDiff)}` : null,
        priceChange.sellDiff ? `Sell ${priceChange.sellDiff > 0 ? "+" : ""}${formatCurrency(priceChange.sellDiff)}` : null,
      ].filter(Boolean).join(" · ")
    : "";

  return (
    <Modal animationType="fade" transparent visible={visible} onRequestClose={onClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.productDetailModal}>
          <View style={styles.modalHeader}>
            <View style={styles.modalTitleWrap}>
              <Text style={styles.modalTitle}>{product.name}</Text>
              <Text style={styles.modalSubtitle}>{product.sku} · {product.category}</Text>
            </View>
            <View style={styles.modalHeaderActions}>
              <Text style={[styles.stockBadge, isLowStock && styles.lowStockBadge, isOutOfStock && styles.outOfStockBadge]}>
                {stockLabel}
              </Text>
              <TouchableOpacity activeOpacity={0.85} onPress={onClose} style={styles.modalCloseButton}>
                <Text style={styles.modalCloseText}>Close</Text>
              </TouchableOpacity>
            </View>
          </View>

          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.modalBody}>
            <View style={styles.detailHero}>
              <View style={styles.detailHeroMain}>
                <Text style={styles.detailEyebrow}>Available now</Text>
                <Text style={styles.detailHeroValue}>{formatNumber(metrics.remaining)}</Text>
                <Text style={styles.detailHeroSubtext}>
                  {product.unitLabel || "Units"} ready to sell · Reorder at {formatNumber(product.reorderLevel)}
                </Text>
              </View>
              <View style={styles.detailScanPanel}>
                <View style={styles.qrBox}>
                  <Image source={{ uri: api.productQrUrl(product.id) }} style={styles.qrImage} resizeMode="contain" />
                  <TouchableOpacity
                    activeOpacity={0.85}
                    onPress={() => {
                      const url = api.productScanUrl(product.id);
                      if (Platform.OS === "web") {
                        window.open(url, "_blank");
                      } else {
                        Linking.openURL(url);
                      }
                    }}
                    style={styles.qrButton}
                  >
                    <Text style={styles.qrButtonText}>Open QR Details</Text>
                  </TouchableOpacity>
                </View>
                <View style={styles.barcodeBox}>
                  <Image source={{ uri: api.productBarcodeUrl(product.id) }} style={styles.barcodeImage} resizeMode="contain" />
                  <Text style={styles.barcodeText}>POS Barcode: {product.barcode || product.sku}</Text>
                </View>
              </View>
            </View>

            <View style={styles.detailSection}>
              <Text style={styles.detailSectionTitle}>Pricing and profit</Text>
              <View style={styles.detailMetricGrid}>
                <DetailMetric label="MRP" value={formatCurrency(product.mrp)} />
                <DetailMetric label="Buy price" value={formatCurrency(product.buyPrice)} />
                <DetailMetric label="Sell price" value={formatCurrency(product.sellPrice)} />
                <DetailMetric label="GST" value={`${product.gstRate}%`} />
                <DetailMetric label="Revenue" value={formatCurrency(metrics.revenue)} />
                <DetailMetric label="Profit" value={formatCurrency(metrics.profit)} />
                <DetailMetric label="Margin" value={formatPercent(metrics.margin)} />
              </View>
            </View>

            <View style={styles.detailTwinSections}>
              <View style={styles.detailSectionHalf}>
                <Text style={styles.detailSectionTitle}>How this stock was calculated</Text>
                <Text style={styles.detailSectionHint}>
                  {isReconciledBalance
                    ? stockFormula
                    : `Ledger balance: ${formatNumber(metrics.remaining)} available. The movement history below explains the reconciled count.`}
                </Text>
                <View style={styles.detailRows}>
                  <DetailRow label="Stock in" value={formatNumber(product.qtyBought)} />
                  <DetailRow label="Sold" value={formatNumber(product.qtySold)} />
                  <DetailRow
                    label="Adjustments"
                    value={
                      stockAdjustment && otherStockChangeMeaning(stockAdjustment)
                        ? `${formatOtherStockChange(stockAdjustment)} (${otherStockChangeMeaning(stockAdjustment)})`
                        : formatOtherStockChange(stockAdjustment)
                    }
                  />
                  <DetailRow label="Available stock" value={formatNumber(metrics.remaining)} accent />
                  <DetailRow label="Latest stock movement" value={stockRecord ? `${readableStockMovementType(stockRecord.transactionType || stockRecord.transaction_type)} · ${movementDateText(stockRecord)} · ${formatNumber(stockRecord.remainingQuantity ?? stockRecord.remaining_quantity ?? stockRecord.newStock ?? metrics.remaining)} balance` : "No movement recorded yet"} />
                  <DetailRow label="Latest price movement" value={priceIncreaseText || "No price change recorded yet"} accent={!!priceIncreaseText} />
                </View>
                <View style={styles.stockHistoryPanel}>
                  <View style={styles.stockHistoryHeader}>
                    <View style={styles.stockHistoryTitleWrap}>
                      <Text style={styles.stockHistoryTitle}>Where every unit went</Text>
                      <Text style={styles.stockHistoryHint}>
                        Latest 4 visible · scroll to view all {formatNumber(movements.length)} recorded changes.
                      </Text>
                    </View>
                  </View>
                  {movements.length ? (
                    <ScrollView
                      nestedScrollEnabled
                      showsVerticalScrollIndicator={movements.length > 4}
                      style={styles.stockHistoryScroll}
                      contentContainerStyle={styles.stockHistoryScrollContent}
                    >
                    {movements.map((movement) => {
                      const quantity = Number(movement.quantityChange ?? movement.quantity_change ?? 0);
                      const balance = movement.remainingQuantity ?? movement.remaining_quantity ?? movement.newStock ?? movement.new_stock;
                      return (
                        <View key={movement.id || `${movement.transactionType}-${movement.createdAt}`} style={styles.stockHistoryRow}>
                          <View style={styles.stockHistoryMain}>
                            <Text style={styles.stockHistoryType}>
                              {readableStockMovementType(movement.transactionType || movement.transaction_type)}
                            </Text>
                            <Text style={[styles.stockHistoryDirection, quantity < 0 ? styles.stockHistoryDirectionOut : styles.stockHistoryDirectionIn]}>
                              {movementDirectionLabel(quantity)}
                            </Text>
                            <Text style={styles.stockHistoryMeta}>
                              {movementDateText(movement)}
                              {movement.referenceOrderId || movement.reference_order_id
                                ? ` · Order #${movement.referenceOrderId || movement.reference_order_id}`
                                : ""}
                            </Text>
                            {!!movement.note && <Text style={styles.stockHistoryNote}>{movement.note}</Text>}
                          </View>
                          <View style={styles.stockHistoryNumbers}>
                            <Text style={[styles.stockHistoryQty, quantity < 0 && styles.stockHistoryQtyNegative]}>
                              {movementQuantityText(movement)}
                            </Text>
                            <Text style={styles.stockHistoryBalance}>
                              {formatNumber(balance)} balance
                            </Text>
                          </View>
                        </View>
                      );
                    })}
                    </ScrollView>
                  ) : (
                    <Text style={styles.stockHistoryEmpty}>
                      No dated stock movement is available for this product yet.
                    </Text>
                  )}
                </View>
              </View>

              <View style={styles.detailSectionHalf}>
                <Text style={styles.detailSectionTitle}>Product information</Text>
                <View style={styles.detailRows}>
                  <DetailRow label="Supplier" value={product.supplier || "Not assigned"} />
                  <DetailRow label="Format" value={product.unitLabel || getFormatByUnitType(product.unitType).unitLabel} />
                  <DetailRow label="Package" value={packagedTypes.has(product.unitType) && product.packageSize ? `${product.packageSize} ${product.packageSizeUnit || "units"} per pack` : "Standard unit"} />
                </View>
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

function DetailMetric({ label, value }) {
  return (
    <View style={styles.detailMetric}>
      <Text style={styles.detailMetricLabel}>{label}</Text>
      <Text style={styles.detailMetricValue}>{value}</Text>
    </View>
  );
}

function DetailRow({ accent = false, label, value }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailRowLabel}>{label}</Text>
      <Text style={[styles.detailRowValue, accent && styles.detailRowValueAccent]}>{value}</Text>
    </View>
  );
}

function ProductFocusButton({ count, disabled, isActive, label, onPress, tone }) {
  return (
    <TouchableOpacity
      activeOpacity={0.85}
      disabled={disabled}
      onPress={onPress}
      style={[
        styles.productFocusButton,
        styles[`productFocus_${tone}`],
        isActive && styles.productFocusButtonActive,
        disabled && styles.disabledControl,
      ]}
    >
      <Text style={[styles.productFocusLabel, isActive && styles.productFocusLabelActive]}>{label}</Text>
      <Text style={[styles.productFocusCount, isActive && styles.productFocusCountActive]}>{formatNumber(count)}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
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
  productToolbar: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  toolbarTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "700",
  },
  toolbarSubtitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 2,
  },
  productControlCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.lg,
    padding: spacing.md,
  },
  productControlTop: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: spacing.sm,
  },
  productSearchWrap: {
    flex: 1,
    gap: spacing.xs,
  },
  controlLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  resetFiltersButton: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  resetFiltersText: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "700",
  },
  productFocusGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  productFocusButton: {
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    minWidth: 142,
    padding: spacing.md,
  },
  productFocus_neutral: {
    backgroundColor: colors.background,
  },
  productFocus_success: {
    backgroundColor: colors.successSoft,
  },
  productFocus_warning: {
    backgroundColor: colors.warningSoft,
  },
  productFocus_danger: {
    backgroundColor: colors.dangerSoft,
  },
  productFocus_primary: {
    backgroundColor: colors.primarySoft,
  },
  productFocus_muted: {
    backgroundColor: colors.background,
  },
  productFocusButtonActive: {
    backgroundColor: colors.ink,
    borderColor: colors.ink,
  },
  productFocusLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  productFocusLabelActive: {
    color: colors.white,
  },
  productFocusCount: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: "700",
    marginTop: spacing.xs,
  },
  productFocusCountActive: {
    color: colors.white,
  },
  categoryFilterBlock: {
    gap: spacing.sm,
  },
  categoryFilterHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  filterResultText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  categoryRail: {
    gap: spacing.sm,
    paddingRight: spacing.md,
  },
  categoryButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  categoryButtonActive: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
  },
  categoryButtonText: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "700",
  },
  categoryButtonTextActive: {
    color: colors.primary,
  },
  categoryButtonCount: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
  },
  categoryButtonCountActive: {
    color: colors.primary,
  },
  disabledControl: {
    opacity: 0.55,
  },
  formModalOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(34, 48, 58, 0.42)",
    flex: 1,
    justifyContent: "center",
    padding: spacing.md,
  },
  productFormModal: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    maxHeight: "92%",
    maxWidth: 940,
    overflow: "hidden",
    width: "100%",
  },
  formModalHeader: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
    padding: spacing.md,
  },
  formModalBody: {
    backgroundColor: colors.background,
    gap: spacing.md,
    padding: spacing.md,
  },
  formModalActions: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "flex-end",
  },
  cancelFormButton: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    minWidth: 100,
    padding: spacing.sm,
  },
  cancelFormText: {
    color: colors.ink,
    fontWeight: "700",
    textAlign: "center",
  },
  submitFormWrap: {
    minWidth: 180,
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
  formHeading: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  formSection: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  formSectionTitle: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "700",
  },
  formSectionHint: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
    marginTop: -2,
  },
  fieldGroupLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    letterSpacing: 0.3,
    textTransform: "uppercase",
  },
  restockNotice: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.sm,
  },
  restockNoticeTitle: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "700",
  },
  restockNoticeText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 17,
  },
  restockTotalCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    justifyContent: "center",
    minWidth: 220,
    padding: spacing.md,
  },
  restockTotalLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  restockTotalValue: {
    color: colors.primaryDark,
    fontSize: 20,
    fontWeight: "700",
    marginTop: 4,
  },
  generatedCode: {
    backgroundColor: colors.primarySoft,
    borderRadius: radii.md,
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
    padding: spacing.sm,
  },
  formErrorText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: "700",
  },
  optionInlineCard: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  optionInlineTop: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  flexItem: {
    flex: 1,
  },
  quickOptionsGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  selectedOptionsSummary: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    padding: spacing.sm,
  },
  selectedOptionsTitle: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "700",
  },
  selectedOptionsHint: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  selectedOptionsWrap: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  selectedOptionPill: {
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  selectedOptionText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
  },
  quickOptionBox: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    minWidth: 52,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  quickOptionBoxActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  quickOptionText: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  quickOptionTextActive: {
    color: colors.white,
  },
  quickOptionAction: {
    backgroundColor: colors.primarySoft,
    borderRadius: radii.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  quickOptionClear: {
    backgroundColor: colors.dangerSoft,
  },
  quickOptionActionText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
  },
  quickOptionClearText: {
    color: colors.danger,
  },
  twoColumn: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  list: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "flex-start",
    gap: spacing.md,
    paddingHorizontal: spacing.md,
  },
  emptyState: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderStyle: "dashed",
    borderWidth: 1,
    gap: spacing.sm,
    justifyContent: "center",
    minHeight: 220,
    padding: spacing.xl,
    width: "100%",
  },
  emptyStateTitle: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "700",
    textAlign: "center",
  },
  emptyStateText: {
    color: colors.muted,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 19,
    maxWidth: 400,
    textAlign: "center",
  },
  emptyStateAction: {
    marginTop: spacing.xs,
    minWidth: 150,
  },
  emptyStateResetButton: {
    backgroundColor: colors.primarySoft,
    borderRadius: radii.md,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  emptyStateResetText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    flexGrow: 0,
    minWidth: 0,
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
  name: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: "700",
  },
  sku: {
    color: colors.muted,
    fontSize: 12,
    marginTop: spacing.xs,
  },
  stockBadge: {
    backgroundColor: colors.successSoft,
    borderRadius: 99,
    color: colors.success,
    fontSize: 11,
    fontWeight: "700",
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  lowStockBadge: {
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
  },
  outOfStockBadge: {
    backgroundColor: colors.danger,
    color: colors.white,
  },
  quantityRow: {
    backgroundColor: colors.background,
    borderRadius: radii.md,
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: spacing.md,
    padding: spacing.md,
  },
  quantityItem: {
    alignItems: "center",
    flex: 1,
  },
  quantityValue: {
    color: colors.ink,
    fontSize: 18,
    fontWeight: "700",
  },
  quantityLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    marginTop: spacing.xs,
  },
  quantityHint: {
    color: colors.muted,
    fontSize: 10,
    fontWeight: "600",
    marginTop: 2,
    textAlign: "center",
  },
  quantityInfoButton: {
    alignItems: "center",
    minHeight: 24,
    justifyContent: "center",
  },
  priceGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  priceItem: {
    backgroundColor: colors.background,
    borderRadius: radii.md,
    minWidth: "47%",
    padding: spacing.sm,
  },
  priceLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
  },
  priceValue: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "700",
    marginTop: 3,
  },
  qrBox: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.xs,
    padding: spacing.sm,
  },
  qrImage: {
    height: 96,
    width: 96,
  },
  qrButton: {
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  qrButtonText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "700",
  },
  barcodeBox: {
    alignItems: "center",
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    marginTop: spacing.sm,
    padding: spacing.sm,
  },
  barcodeImage: {
    height: 70,
    width: "100%",
  },
  barcodeText: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "600",
    marginTop: spacing.xs,
  },
  profitBox: {
    backgroundColor: colors.primaryDark,
    borderRadius: radii.md,
    flexDirection: "row",
    justifyContent: "space-between",
    padding: spacing.md,
  },
  profitLabel: {
    color: "#CBD5E1",
    fontSize: 11,
    fontWeight: "700",
  },
  profitValue: {
    color: colors.white,
    fontSize: 14,
    fontWeight: "700",
    marginTop: spacing.xs,
  },
  historyBox: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.xs,
    marginTop: spacing.md,
    padding: spacing.sm,
  },
  historyTitle: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "700",
  },
  historyText: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    lineHeight: 17,
  },
  priceChangedText: {
    color: colors.primary,
  },
  supplier: {
    color: colors.muted,
    fontSize: 12,
  },
  actionRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  detailsToggleButton: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    padding: spacing.sm,
  },
  detailsToggleText: {
    color: colors.ink,
    fontWeight: "700",
    textAlign: "center",
  },
  pagination: {
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
  },
  editButton: {
    backgroundColor: colors.primarySoft,
    borderRadius: radii.md,
    flex: 1,
    padding: spacing.sm,
  },
  deleteButton: {
    backgroundColor: colors.dangerSoft,
    borderRadius: radii.md,
    flex: 1,
    padding: spacing.sm,
  },
  editText: {
    color: colors.primary,
    fontWeight: "700",
    textAlign: "center",
  },
  deleteText: {
    color: colors.danger,
    fontWeight: "700",
    textAlign: "center",
  },
  modalOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(34, 48, 58, 0.42)",
    flex: 1,
    justifyContent: "center",
    padding: spacing.md,
  },
  productDetailModal: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    maxHeight: "90%",
    maxWidth: 860,
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
    padding: spacing.md,
  },
  modalTitleWrap: {
    flex: 1,
    minWidth: 0,
  },
  modalTitle: {
    color: colors.ink,
    fontSize: 19,
    fontWeight: "700",
  },
  modalSubtitle: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
    marginTop: spacing.xs,
  },
  modalHeaderActions: {
    alignItems: "flex-end",
    flexDirection: "row",
    gap: spacing.sm,
  },
  modalCloseButton: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    minWidth: 72,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  modalCloseText: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "700",
  },
  modalBody: {
    backgroundColor: colors.background,
    gap: spacing.sm,
    padding: spacing.md,
  },
  detailHero: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    overflow: "hidden",
    padding: spacing.md,
  },
  detailHeroMain: {
    backgroundColor: colors.primaryDark,
    borderRadius: radii.md,
    flex: 1.35,
    justifyContent: "center",
    minHeight: 214,
    minWidth: 260,
    padding: spacing.lg,
  },
  detailEyebrow: {
    color: "#CBD5E1",
    fontSize: 12,
    fontWeight: "700",
  },
  detailHeroValue: {
    color: colors.white,
    fontSize: 46,
    fontWeight: "700",
    marginTop: spacing.xs,
  },
  detailHeroSubtext: {
    color: "#E2E8F0",
    fontSize: 13,
    fontWeight: "700",
    lineHeight: 19,
    marginTop: spacing.sm,
  },
  detailScanPanel: {
    flex: 1,
    gap: spacing.sm,
    minWidth: 240,
  },
  detailSection: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  detailSectionTitle: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "700",
  },
  detailSectionHint: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
  },
  detailTwinSections: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  detailSectionHalf: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flex: 1,
    gap: spacing.sm,
    minWidth: 280,
    padding: spacing.md,
  },
  detailMetricGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  detailMetric: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: 132,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  detailMetricLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
  },
  detailMetricValue: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "700",
    marginTop: spacing.xs,
  },
  detailRows: {
    borderColor: colors.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    overflow: "hidden",
  },
  stockHistoryPanel: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.sm,
  },
  stockHistoryHeader: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  stockHistoryTitleWrap: { flex: 1, minWidth: 200 },
  stockHistoryTitle: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "700",
  },
  stockHistoryHint: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 15,
    marginTop: 2,
  },
  stockHistoryScroll: { maxHeight: 316 },
  stockHistoryScrollContent: { gap: spacing.xs, paddingRight: 3 },
  stockHistoryRow: {
    alignItems: "flex-start",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "space-between",
    padding: spacing.sm,
  },
  stockHistoryMain: {
    flex: 1,
    minWidth: 180,
  },
  stockHistoryType: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "700",
  },
  stockHistoryDirection: {
    alignSelf: "flex-start",
    borderRadius: 99,
    fontSize: 10,
    fontWeight: "700",
    marginTop: 4,
    overflow: "hidden",
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  stockHistoryDirectionIn: {
    backgroundColor: colors.successSoft,
    color: colors.success,
  },
  stockHistoryDirectionOut: {
    backgroundColor: colors.dangerSoft,
    color: colors.danger,
  },
  stockHistoryMeta: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "600",
    marginTop: 3,
  },
  stockHistoryNote: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "600",
    lineHeight: 16,
    marginTop: 3,
  },
  stockHistoryNumbers: {
    alignItems: "flex-end",
    minWidth: 110,
  },
  stockHistoryQty: {
    color: colors.success,
    fontSize: 13,
    fontWeight: "700",
  },
  stockHistoryQtyNegative: {
    color: colors.danger,
  },
  stockHistoryBalance: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "600",
    marginTop: 3,
  },
  stockHistoryEmpty: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
  },
  detailRow: {
    backgroundColor: colors.background,
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  detailRowLabel: {
    color: colors.muted,
    flex: 1,
    fontSize: 12,
    fontWeight: "700",
  },
  detailRowValue: {
    color: colors.ink,
    flex: 1.4,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "right",
  },
  detailRowValueAccent: {
    color: colors.primary,
  },
});
