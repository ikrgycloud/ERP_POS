import React, { useEffect, useMemo, useRef, useState } from "react";
import { Modal, ScrollView, StyleSheet, Text, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { AppButton } from "../components/AppButton";
import { FilterChips } from "../components/FilterChips";
import { FormField } from "../components/FormField";
import { PaginationControls } from "../components/PaginationControls";
import { SearchablePicker } from "../components/SearchablePicker";
import { SearchInput } from "../components/SearchInput";
import { ScreenHeader } from "../components/ScreenHeader";
import { useModal } from "../components/ModalProvider";
import { useOrderQuote } from "../hooks/useOrderQuote";
import { api, createRequestKey } from "../services/api";
import { colors, radii, spacing } from "../constants/theme";
import { formatCurrency, formatDate } from "../utils/formatters";
import { isNonNegativeNumber, isPositiveNumber, isValidEmail, isValidPhone } from "../utils/validation";

function toDateInputValue(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeOrderDate(value, fallback = toDateInputValue()) {
  const text = String(value ?? "").trim();
  if (!text) {
    return fallback;
  }
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  if (!match) {
    return "";
  }
  const [, yearText, monthText, dayText] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const candidate = new Date(year, month - 1, day);
  if (
    candidate.getFullYear() !== year ||
    candidate.getMonth() !== month - 1 ||
    candidate.getDate() !== day
  ) {
    return "";
  }
  return `${yearText}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

const today = toDateInputValue();

const emptyOrderForm = {
  date: today,
  partyName: "",
  partyType: "B2B",
  supplierEmail: "",
  supplierPhone: "",
  supplierId: null,
  outletId: null,
  customerId: null,
  paymentStatus: "Unpaid",
  status: "Draft",
  type: "purchase",
};

function createEmptyOrderForm() {
  return {
    ...emptyOrderForm,
    date: toDateInputValue(),
  };
}

const emptyItem = {
  gstRate: "18",
  packageCount: "",
  packageSize: "1",
  packageSizeUnit: "Unit",
  productId: "",
  quantity: "1",
  rate: "",
  unitLabel: "Pieces",
  unitType: "pieces",
};

const PAGE_SIZE = 10;

const packagedTypes = new Set(["packets", "bags", "carton_boxes"]);

function getQuantityOptions(product) {
  return String(product?.quantityOptions || "")
    .split(",")
    .map((option) => option.trim())
    .filter(Boolean);
}

function formatUnitSummary(item) {
  if (!item?.unitType) {
    return "";
  }
  if (packagedTypes.has(item.unitType)) {
    return `${item.packageCount || 0} ${item.unitLabel || "packs"} x ${item.packageSize || 1} ${item.packageSizeUnit || "units"}`;
  }
  return `${item.quantity || 0} ${item.unitLabel || "units"}`;
}

function activeDiscountForProduct(product, quantity = 1) {
  const today = new Date().toISOString().slice(0, 10);
  const discounts = Array.isArray(product?.discounts) ? product.discounts : [];
  return [...discounts]
    .filter((discount) => {
      if (!discount.isActive && !discount.is_active) {
        return false;
      }
      if (discount.startDate && discount.startDate > today) {
        return false;
      }
      if (discount.endDate && discount.endDate < today) {
        return false;
      }
      if (Number(quantity || 0) < Number(discount.minQuantity ?? discount.min_quantity ?? 0)) {
        return false;
      }
      return true;
    })
    .sort((left, right) => String(right.startDate || "").localeCompare(String(left.startDate || "")) || Number(right.id || 0) - Number(left.id || 0))[0];
}

function discountAmountForProduct(product, quantity = 1, rate = null) {
  const sellPrice = Number(rate ?? product?.sellPrice ?? 0);
  const discount = activeDiscountForProduct(product, quantity);
  const qty = Number(quantity || 0);
  if (!discount || !qty || !sellPrice) {
    return 0;
  }
  const value = Number(discount.discountValue ?? discount.discount_value ?? 0);
  if ((discount.discountType || discount.discount_type) === "percentage") {
    return Math.max(0, (sellPrice * qty * value) / 100);
  }
  return Math.min(sellPrice * qty, value * qty);
}

function discountLabel(product, quantity = 1) {
  const discount = activeDiscountForProduct(product, quantity);
  if (!discount) {
    return "";
  }
  const value = Number(discount.discountValue ?? discount.discount_value ?? 0);
  return (discount.discountType || discount.discount_type) === "percentage" ? `${formatPercentOffer(value)}` : `${formatCurrency(value)} off`;
}

function formatPercentOffer(value) {
  const number = Number(value || 0);
  if (!Number.isFinite(number)) {
    return "";
  }
  return `${Number(number.toFixed(2))}%`;
}

function compactDiscountOffer(label) {
  const text = String(label || "").trim();
  if (!text) {
    return "";
  }
  const percentage = /^(\d+(?:\.\d+)?)%\s*(?:off|discount applied)?$/i.exec(text);
  if (percentage) {
    return formatPercentOffer(percentage[1]);
  }
  return text.replace(/\s*discount applied$/i, "").trim();
}

function itemDiscountOffer(item) {
  const explicitPct = Number(item?.discountPct ?? item?.discount_pct ?? 0);
  if (explicitPct > 0) {
    return formatPercentOffer(explicitPct);
  }
  const label = compactDiscountOffer(item?.discountLabel || item?.discount_label);
  if (label.endsWith("%")) {
    return label;
  }
  const discountAmount = Number(item?.discountAmount ?? item?.discount_amount ?? 0);
  const subtotal = Number(item?.lineSubtotal ?? item?.line_subtotal ?? 0) || Number(item?.quantity || 0) * Number(item?.rate || 0);
  if (!discountAmount || !subtotal) {
    return "";
  }
  return formatPercentOffer((discountAmount / subtotal) * 100);
}

function itemAvailableOffer(item, product = null) {
  const explicitPct = Number(item?.availableDiscountPct ?? item?.available_discount_pct ?? 0);
  if (explicitPct > 0) {
    return formatPercentOffer(explicitPct);
  }
  const label = compactDiscountOffer(item?.availableDiscountLabel || item?.available_discount_label);
  if (label) {
    return label;
  }
  return product ? discountLabel(product, item?.quantity || 1) : "";
}

function orderDiscountOfferSummary(order, productLookup = {}) {
  const offers = Array.from(
    new Set(
      (order?.items || [])
        .map((item) => {
          const appliedOffer = itemDiscountOffer(item);
          if (appliedOffer) {
            return appliedOffer;
          }
          return itemAvailableOffer(item, productLookup[String(item.productId ?? item.product_id)]);
        })
        .filter(Boolean)
    )
  );
  if (!offers.length) {
    return "0%";
  }
  return offers.length <= 2 ? offers.join(", ") : `${offers.slice(0, 2).join(", ")} +${offers.length - 2}`;
}

export function OrdersScreen({
  activeOutlet,
  businessProfile,
  isBusy,
  navigationIntent,
  orders,
  products,
  suppliers = [],
  onCreateSupplier,
  onCreateOrder,
  onDeleteOrder,
  onGenerateInvoice,
  onUpdateSupplier,
  onUpdateOrder,
  outlets = [],
  sessionRole = "admin",
}) {
  const modal = useModal();
  const { width: windowWidth } = useWindowDimensions();
  const scrollRef = useRef(null);
  const hasMountedRef = useRef(false);
  const pendingOrderRequestKeyRef = useRef(null);
  const [typeFilter, setTypeFilter] = useState("All");
  const [partyFilter, setPartyFilter] = useState("All Parties");
  const [paymentFilter, setPaymentFilter] = useState("All Payments");
  const [statusFilter, setStatusFilter] = useState("All Status");
  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);
  const [editingOrder, setEditingOrder] = useState(null);
  const [editingOrderId, setEditingOrderId] = useState(null);
  const [orderForm, setOrderForm] = useState(emptyOrderForm);
  const [items, setItems] = useState([emptyItem]);
  const [invoiceDueDate, setInvoiceDueDate] = useState(today);
  const [invoiceOrder, setInvoiceOrder] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [customers, setCustomers] = useState([]);
  const [selectedPartyId, setSelectedPartyId] = useState("");
  const [showManualParty, setShowManualParty] = useState(false);
  const [formError, setFormError] = useState("");
  const [orderSubmitting, setOrderSubmitting] = useState(false);
  const [deletingOrderId, setDeletingOrderId] = useState(null);
  const isSubmitLocked = isBusy || orderSubmitting;
  const isDesktopOrders = windowWidth >= 980;

  const productLookup = useMemo(
    () => Object.fromEntries(products.map((product) => [String(product.id), product])),
    [products]
  );

  const productOptions = useMemo(
    () =>
      products.map((product) => ({
        hint: `${product.sku} - ${product.unitLabel || "Units"}`,
        label: product.name,
        value: String(product.id),
      })),
    [products]
  );

  useEffect(() => {
    const loadCustomers = async () => {
      if (!businessProfile?.id) {
        setCustomers([]);
        return;
      }

      if (sessionRole === "outlet" && !activeOutlet?.id) {
        setCustomers([]);
        return;
      }

      try {
        if (sessionRole === "outlet") {
          const customerList = await api.getCustomers(businessProfile.id, activeOutlet.id);
          setCustomers(customerList || []);
          return;
        }

        const customerLists = await Promise.all(
          outlets.map(async (outlet) => {
            const customerList = await api.getCustomers(businessProfile.id, outlet.id);
            return (customerList || []).map((customer) => ({
              ...customer,
              outletLabel: outlet.tradeName || outlet.name || outlet.outletCode || `Outlet ${outlet.id}`,
            }));
          })
        );
        setCustomers(customerLists.flat());
      } catch (error) {
        setCustomers([]);
      }
    };

    loadCustomers();
  }, [activeOutlet?.id, businessProfile?.id, outlets, sessionRole]);

  useEffect(() => {
    if (sessionRole === "outlet" && orderForm.type === "purchase") {
      setOrderForm((current) => ({
        ...current,
        customerId: null,
        outletId: activeOutlet?.id || null,
        partyName: businessProfile?.tradeName || "Admin",
        partyType: "B2B",
      }));
      setSelectedPartyId("ADMIN");
    }
  }, [activeOutlet?.id, businessProfile?.tradeName, orderForm.type, sessionRole]);

  const statuses = useMemo(
    () => ["All Status", ...Array.from(new Set(orders.map((order) => order.status).filter(Boolean))).sort()],
    [orders]
  );
  const paymentStatuses = useMemo(
    () => ["All Payments", ...Array.from(new Set(orders.map((order) => order.paymentStatus).filter(Boolean))).sort()],
    [orders]
  );

  const filteredOrders = useMemo(() => {
    return orders.filter((order) => {
      const matchesType =
        typeFilter === "All" ||
        (typeFilter === "Purchase Orders" && order.type === "purchase") ||
        (typeFilter === "Sales Orders" && order.type === "sale");
      const matchesParty = partyFilter === "All Parties" || order.partyType === partyFilter;
      const matchesStatus = statusFilter === "All Status" || order.status === statusFilter;
      const matchesPayment = paymentFilter === "All Payments" || order.paymentStatus === paymentFilter;
      const matchesStart = !startDate || order.date >= startDate;
      const matchesEnd = !endDate || order.date <= endDate;
      const itemSearchBlob =
        order.items
          ?.map((item) => {
            const product = productLookup[String(item.productId)] || {};
            return [item.productName, product.name, product.sku, item.productId].filter(Boolean).join(" ");
          })
          .join(" ") || "";
      const matchesSearch = [
        order.orderNumber,
        order.id,
        order.partyName,
        order.partyType,
        order.status,
        order.paymentStatus,
        order.type,
        itemSearchBlob,
      ]
        .join(" ")
        .toLowerCase()
        .includes(search.trim().toLowerCase());

      return (
        matchesType &&
        matchesParty &&
        matchesStatus &&
        matchesPayment &&
        matchesStart &&
        matchesEnd &&
        matchesSearch
      );
    });
  }, [endDate, orders, partyFilter, paymentFilter, productLookup, search, startDate, statusFilter, typeFilter]);

  const totalPages = Math.max(1, Math.ceil(filteredOrders.length / PAGE_SIZE));

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [endDate, partyFilter, paymentFilter, search, startDate, statusFilter, typeFilter]);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    scrollRef.current?.scrollTo({ animated: true, y: 0 });
  }, [currentPage]);

  const visibleOrders = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    return filteredOrders.slice(startIndex, startIndex + PAGE_SIZE);
  }, [currentPage, filteredOrders]);

  const formTotals = useMemo(() => {
    return items.reduce(
      (totals, item) => {
        const quantity = Number(item.quantity || 0);
        const rate = Number(item.rate || 0);
        const gstRate = Number(item.gstRate || 0);
        const product = productLookup[String(item.productId)];
        const lineSubtotal = quantity * rate;
        const discountAmount = orderForm.type === "sale" && product ? discountAmountForProduct(product, quantity, rate) : 0;
        const taxable = Math.max(0, lineSubtotal - discountAmount);
        const tax = (taxable * gstRate) / 100;
        return {
          grandTotal: totals.grandTotal + taxable + tax,
          subtotalValue: totals.subtotalValue + lineSubtotal,
          discountValue: totals.discountValue + discountAmount,
          taxableValue: totals.taxableValue + taxable,
          taxValue: totals.taxValue + tax,
        };
      },
      { grandTotal: 0, subtotalValue: 0, discountValue: 0, taxableValue: 0, taxValue: 0 }
    );
  }, [items, orderForm.type, productLookup]);

  const {
    quote,
    quoteError,
    quoteLoading,
    quotedItemsByProduct,
  } = useOrderQuote({
    enabled: showForm,
    items,
    orderType: orderForm.type,
  });
  const displayedTotals = quote || formTotals;

  const clearFilters = () => {
    setTypeFilter("All");
    setPartyFilter("All Parties");
    setPaymentFilter("All Payments");
    setStatusFilter("All Status");
    setSearch("");
    setStartDate("");
    setEndDate("");
    setCurrentPage(1);
  };

  const handlePageChange = (page) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  const activeFilterCount = [
    search,
    startDate,
    endDate,
    typeFilter !== "All",
    partyFilter !== "All Parties",
    statusFilter !== "All Status",
    paymentFilter !== "All Payments",
  ].filter(Boolean).length;

  const updateOrderForm = (key, value) => {
    setFormError("");
    setOrderForm((current) => {
      const next = { ...current, [key]: value };
      if (key === "type" && value === "purchase") {
        next.partyType = "B2B";
        next.partyName = sessionRole === "outlet" ? businessProfile?.tradeName || "Admin" : "";
        next.outletId = activeOutlet?.id || null;
        next.customerId = null;
        next.supplierId = null;
        next.supplierEmail = "";
        next.supplierPhone = "";
      }
      if (key === "type" && value === "sale" && sessionRole === "outlet") {
        next.outletId = activeOutlet?.id || null;
      }
      if (key === "partyType") {
        next.customerId = null;
        next.outletId = sessionRole === "outlet" ? activeOutlet?.id || null : next.outletId;
      }
      return next;
    });
  };

  const updateItem = (index, key, value) => {
    setFormError("");
    const safeValue = key === "productId" && value === "Select product" ? "" : value;
    setItems((current) =>
      current.map((item, itemIndex) => {
        if (itemIndex !== index) {
          return item;
        }
        const next = { ...item, [key]: safeValue };
        if (key === "productId") {
          const product = productLookup[String(safeValue)];
          if (product) {
            next.rate = String(orderForm.type === "purchase" ? product.buyPrice : product.sellPrice);
            next.gstRate = String(product.gstRate);
            next.unitType = product.unitType || "pieces";
            next.unitLabel = product.unitLabel || "Pieces";
            next.packageSize = String(product.packageSize || "1");
            next.packageSizeUnit = product.packageSizeUnit || "Unit";
            next.packageCount = packagedTypes.has(next.unitType) ? next.packageCount || "1" : "";
            if (packagedTypes.has(next.unitType)) {
              next.quantity = String(Number(next.packageCount || 1));
              next.rate = String(orderForm.type === "purchase" ? product.packagePrice || product.buyPrice || 0 : product.sellPrice || 0);
            }
          }
        }
        if ((key === "packageCount" || key === "packageSize") && packagedTypes.has(next.unitType)) {
          next.quantity = String(Number(next.packageCount || 0));
        }
        if ((key === "quantity" || key === "packageCount" || key === "productId") && orderForm.type === "sale") {
          const product = productLookup[String(next.productId)];
          if (product) {
            next.rate = String(product.sellPrice || 0);
          }
        }
        return next;
      })
    );
  };

  const addItem = () => setItems((current) => [...current, emptyItem]);

  const removeItem = (index) => {
    setItems((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  const resetForm = () => {
    pendingOrderRequestKeyRef.current = null;
    setEditingOrder(null);
    setEditingOrderId(null);
    setOrderForm(createEmptyOrderForm());
    setItems([emptyItem]);
    setSelectedPartyId("");
    setShowManualParty(false);
    setShowForm(false);
    setFormError("");
  };

  const buildPrefilledItem = (product, intentProduct = {}) => {
    if (!product) {
      return { ...emptyItem };
    }
    const suggestedQuantity = Math.max(
      Number(intentProduct.reorderLevel || 0) - Number(intentProduct.remaining || 0),
      1
    );
    const next = {
      ...emptyItem,
      productId: String(product.id),
      quantity: String(suggestedQuantity),
      gstRate: String(product.gstRate || 0),
      unitType: product.unitType || "pieces",
      unitLabel: product.unitLabel || "Pieces",
      packageSize: String(product.packageSize || "1"),
      packageSizeUnit: product.packageSizeUnit || "Unit",
    };
    next.rate = String(packagedTypes.has(next.unitType) ? product.packagePrice || product.buyPrice || 0 : product.buyPrice || 0);
    if (packagedTypes.has(next.unitType)) {
      next.packageCount = String(suggestedQuantity);
    }
    return next;
  };

  useEffect(() => {
    if (!navigationIntent?.openCreateForm) {
      return;
    }

    const nextForm = {
      ...createEmptyOrderForm(),
      type: navigationIntent.type === "sale" ? "sale" : "purchase",
    };
    if (nextForm.type === "purchase" && sessionRole === "outlet") {
      nextForm.customerId = null;
      nextForm.outletId = activeOutlet?.id || null;
      nextForm.partyName = businessProfile?.tradeName || "Admin";
      nextForm.partyType = "B2B";
    }

    pendingOrderRequestKeyRef.current = null;
    setEditingOrder(null);
    setEditingOrderId(null);
    setOrderForm(nextForm);
    const intentProductId = navigationIntent.product?.id || navigationIntent.productId;
    const intentProduct = intentProductId ? productLookup[String(intentProductId)] : null;
    setItems([intentProduct ? buildPrefilledItem(intentProduct, navigationIntent.product) : { ...emptyItem }]);
    setSelectedPartyId(nextForm.type === "purchase" && sessionRole === "outlet" ? "ADMIN" : "");
    setShowManualParty(false);
    setFormError("");
    setTypeFilter(nextForm.type === "purchase" ? "Purchase Orders" : "Sales Orders");
    setShowForm(true);
  }, [activeOutlet?.id, businessProfile?.tradeName, navigationIntent?.key, navigationIntent?.openCreateForm, navigationIntent?.product, navigationIntent?.productId, navigationIntent?.type, productLookup, sessionRole]);

  const openEditForm = (order) => {
    pendingOrderRequestKeyRef.current = null;
    setEditingOrder(order);
    setEditingOrderId(order.id);
    setOrderForm({
      date: order.date,
      partyName: order.partyName,
      partyType: order.partyType,
      supplierEmail: order.supplierEmail || "",
      supplierPhone: order.supplierPhone || order.supplierMobile || "",
      supplierId: order.supplierId || null,
      outletId: order.outletId || null,
      customerId: order.customerId || null,
      paymentStatus: order.paymentStatus,
      status: order.status,
      type: order.type,
    });
    setSelectedPartyId(order.customerId ? String(order.customerId) : order.outletId ? String(order.outletId) : "ADMIN");
    setItems(
      order.items.map((item) => ({
        gstRate: String(item.gstRate),
        packageCount: String(item.packageCount || ""),
        packageSize: String(item.packageSize || "1"),
        packageSizeUnit: item.packageSizeUnit || "Unit",
        productId: String(item.productId),
        quantity: String(item.quantity),
        rate: String(item.rate),
        unitLabel: item.unitLabel || "Pieces",
        unitType: item.unitType || "pieces",
      }))
    );
    setShowForm(true);
    requestAnimationFrame(() => {
      scrollRef.current?.scrollTo({ animated: true, y: 0 });
    });
  };

  const submitOrder = async () => {
    if (isSubmitLocked) {
      return;
    }
    const normalizedOrderDate = normalizeOrderDate(orderForm.date);
    if (!orderForm.partyName.trim()) {
      setFormError("Party name is required");
      return;
    }
    if (!normalizedOrderDate) {
      setFormError("Enter a valid order date");
      return;
    }
    if (orderForm.supplierEmail.trim() && !isValidEmail(orderForm.supplierEmail)) {
      setFormError("Enter a valid supplier email address");
      return;
    }
    if (orderForm.type === "purchase" && sessionRole !== "outlet" && !isValidPhone(orderForm.supplierPhone)) {
      setFormError("Enter a valid supplier phone number");
      return;
    }
    const validItems = items.filter((item) => item.productId);
    if (!validItems.length) {
      setFormError("Add at least one product");
      return;
    }
    const invalidItem = validItems.find(
      (item) => !isPositiveNumber(item.quantity) || !isPositiveNumber(item.rate) || !isNonNegativeNumber(item.gstRate)
    );
    if (invalidItem) {
      setFormError("Each item needs valid quantity, rate, and GST");
      return;
    }
    const productIds = validItems.map((item) => String(item.productId));
    if (new Set(productIds).size !== productIds.length) {
      setFormError("Each product can be added only once per order");
      return;
    }
    setOrderSubmitting(true);
    try {
      let supplierId = orderForm.supplierId;
      if (!editingOrderId && !pendingOrderRequestKeyRef.current) {
        pendingOrderRequestKeyRef.current = createRequestKey("order");
      }
      if (orderForm.type === "purchase" && !supplierId && orderForm.partyName.trim() && sessionRole !== "outlet") {
        if (!onCreateSupplier) {
          throw new Error("Supplier creation is not available.");
        }
        const supplierRecord = await onCreateSupplier({
          email: orderForm.supplierEmail.trim() || null,
          name: orderForm.partyName.trim(),
          phone: orderForm.supplierPhone.trim(),
        });
        supplierId = supplierRecord.id;
        setOrderForm((current) => ({ ...current, supplierId }));
      } else if (orderForm.type === "purchase" && supplierId && sessionRole !== "outlet") {
        const selectedSupplier = suppliers.find((supplier) => String(supplier.id) === String(supplierId));
        const currentPhone = selectedSupplier?.phone || selectedSupplier?.mobile || "";
        const contactChanged = selectedSupplier && (
          (selectedSupplier.email || "") !== orderForm.supplierEmail.trim() ||
          currentPhone !== orderForm.supplierPhone.trim()
        );
        if (contactChanged) {
          if (!onUpdateSupplier) {
            throw new Error("Supplier update is not available.");
          }
          await onUpdateSupplier(supplierId, {
            address: selectedSupplier.address || null,
            email: orderForm.supplierEmail.trim() || null,
            gstin: selectedSupplier.gstin || null,
            isActive: selectedSupplier.isActive !== false,
            name: selectedSupplier.name,
            phone: orderForm.supplierPhone.trim(),
          });
        }
      }
      const payload = {
        ...orderForm,
        date: normalizedOrderDate,
        supplierId,
        outletId:
          sessionRole === "outlet"
            ? activeOutlet?.id || orderForm.outletId || null
            : orderForm.outletId || null,
        items: items
          .filter((item) => item.productId)
          .map((item) => ({
            gstRate: Number(item.gstRate || 0),
            packageCount: item.packageCount ? Number(item.packageCount || 0) : null,
            packageSize: item.packageSize ? Number(item.packageSize || 0) : null,
            packageSizeUnit: item.packageSizeUnit || null,
            productId: Number(item.productId),
            quantity: Number(item.quantity || 0),
            rate: Number(item.rate || 0),
            unitLabel: item.unitLabel || "Pieces",
            unitType: item.unitType || "pieces",
          })),
      };
      delete payload.supplierEmail;
      delete payload.supplierPhone;
      const savedOrder = editingOrderId
        ? await onUpdateOrder(editingOrderId, payload)
        : await onCreateOrder(payload, pendingOrderRequestKeyRef.current);
      resetForm();
      await modal.success(
        editingOrderId ? "Order updated successfully" : "Order created successfully",
        savedOrder?.orderNumber ? `${savedOrder.orderNumber} is ready.` : "The order list has been refreshed."
      );
    } catch (error) {
      setFormError(error?.message || "Unable to save order. Please check the connection and try again.");
    } finally {
      setOrderSubmitting(false);
    }
  };

  const confirmDelete = async (order) => {
    if (deletingOrderId) {
      return;
    }
    const confirmed = await modal.confirm({
      cancelLabel: "Keep order",
      confirmLabel: "Delete",
      message: order.orderNumber || String(order.id),
      title: "Delete order?",
      tone: "danger",
    });
    if (confirmed) {
      setDeletingOrderId(order.id);
      try {
        await onDeleteOrder(order.id);
        if (editingOrderId === order.id) {
          resetForm();
        }
        await modal.success("Order deleted successfully", order.orderNumber || String(order.id));
      } catch (error) {
        await modal.error("Unable to delete order", error?.message || "Please check the connection and try again.");
      } finally {
        setDeletingOrderId(null);
      }
    }
  };

  const openInvoiceModal = (order) => {
    setInvoiceOrder(order);
    setInvoiceDueDate(toDateInputValue());
  };

  const closeInvoiceModal = () => {
    if (isSubmitLocked) {
      return;
    }
    setInvoiceOrder(null);
    setInvoiceDueDate(toDateInputValue());
  };

  const generateInvoice = async () => {
    if (!invoiceOrder) {
      return;
    }
    try {
      const invoice = await onGenerateInvoice(
        {
          dueDate: invoiceDueDate,
          intraState: true,
          orderId: invoiceOrder.id,
          status: invoiceOrder.paymentStatus === "Paid" ? "Paid" : "Unpaid",
        },
        createRequestKey("invoice")
      );
      setInvoiceOrder(null);
      await modal.success(
        "Invoice generated successfully",
        invoice?.invoiceNumber ? `${invoice.invoiceNumber} is ready.` : "The invoice list has been refreshed."
      );
    } catch (error) {
      await modal.error("Invoice generation failed", error?.message || "Please try again.");
    }
  };

  const customerOptions = useMemo(
    () =>
      customers.map((customer) => ({
        hint: [customer.phone, sessionRole === "admin" ? customer.outletLabel : ""].filter(Boolean).join(" · "),
        label: customer.name || customer.phone,
        value: String(customer.id),
      })),
    [customers, sessionRole]
  );

  const outletOptions = useMemo(
    () =>
      outlets.map((outlet) => ({
        hint: outlet.city || outlet.state || outlet.outletCode,
        label: outlet.tradeName || outlet.name,
        value: String(outlet.id),
      })),
    [outlets]
  );

  const supplierOptions = useMemo(
    () =>
      suppliers.map((supplier) => ({
        hint: [supplier.phone || supplier.mobile, supplier.email].filter(Boolean).join(" · "),
        label: supplier.name,
        value: String(supplier.id),
      })),
    [suppliers]
  );

  const partyPickerOptions = useMemo(() => {
    if (sessionRole === "outlet") {
      if (orderForm.type === "sale" && orderForm.partyType === "B2C") {
        return customerOptions;
      }
      return [{ hint: businessProfile?.tradeName || "Admin", label: "Admin", value: "ADMIN" }];
    }

    if (orderForm.type === "sale" && orderForm.partyType === "B2C") {
      return customerOptions;
    }

    if (orderForm.type === "sale" && orderForm.partyType === "B2B") {
      return outletOptions;
    }

    return [];
  }, [businessProfile?.tradeName, customerOptions, outletOptions, orderForm.partyType, orderForm.type, sessionRole]);

  const canPickParty = partyPickerOptions.length > 0;

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader
        eyebrow="B2B and B2C Order Flow"
        iconLabel="O"
        iconTone="danger"
        title="Orders"
        subtitle="Create supplier purchase orders and customer sales orders, then generate GST invoices from them."
      />

      <View style={styles.filterPanel}>
        <AppButton
          label="Create Order"
          disabled={isBusy}
          onPress={() => {
            pendingOrderRequestKeyRef.current = null;
            setEditingOrder(null);
            setEditingOrderId(null);
            setOrderForm(createEmptyOrderForm());
            setItems([{ ...emptyItem }]);
            setSelectedPartyId("");
            setShowManualParty(false);
            setFormError("");
            setShowForm(true);
          }}
        />

        <Modal
          animationType="fade"
          onRequestClose={resetForm}
          transparent
          visible={showForm}
        >
          <View style={styles.modalOverlay}>
            <View style={styles.modalCard}>
              <View style={styles.modalHeader}>
                <View style={styles.modalTitleWrap}>
                  <Text style={styles.formTitle}>{editingOrder ? "Edit order" : "Create order"}</Text>
                  <Text style={styles.modalSubtitle}>Add the party, products and payment details below.</Text>
                </View>
                <TouchableOpacity
                  accessibilityLabel="Close order form"
                  activeOpacity={0.8}
                  disabled={isSubmitLocked}
                  onPress={resetForm}
                  style={styles.modalCloseButton}
                >
                  <Text style={styles.modalCloseText}>×</Text>
                </TouchableOpacity>
              </View>
              <ScrollView
                contentContainerStyle={styles.formCard}
                keyboardShouldPersistTaps="handled"
                showsVerticalScrollIndicator={false}
              >
            <View style={styles.formSection}>
              <View style={styles.sectionHeader}>
                <View>
                  <Text style={styles.sectionTitle}>Order details</Text>
                  <Text style={styles.sectionHint}>{orderForm.type === "purchase" ? "Supplier purchase workflow" : "Customer sale workflow"}</Text>
                </View>
              </View>
            <FilterChips
              activeValue={orderForm.type === "purchase" ? "Purchase from B2B" : "Sale to Customer"}
              disabled={isSubmitLocked}
              onChange={(value) => updateOrderForm("type", value === "Purchase from B2B" ? "purchase" : "sale")}
              options={["Purchase from B2B", "Sale to Customer"]}
            />
            <View style={styles.formGrid}>
              <View style={styles.formGridItem}>
                <FormField
                  error={formError === "Enter a valid order date" ? formError : ""}
                  label="Order date"
                  onChangeText={(value) => updateOrderForm("date", value)}
                  placeholder="YYYY-MM-DD"
                  type="date"
                  value={orderForm.date}
                />
              </View>
              <View style={styles.formGridItem}>
                <Text style={styles.fieldGroupLabel}>Order status</Text>
                <FilterChips
                  activeValue={orderForm.status}
                  disabled={isSubmitLocked}
                  onChange={(value) => updateOrderForm("status", value)}
                  options={orderForm.type === "purchase" ? ["Draft", "Sent", "Received", "Cancelled"] : ["Draft", "Packed", "Delivered", "Cancelled"]}
                />
              </View>
              <View style={styles.formGridItem}>
                <Text style={styles.fieldGroupLabel}>Payment</Text>
                <FilterChips
                  activeValue={orderForm.paymentStatus}
                  disabled={isSubmitLocked}
                  onChange={(value) => updateOrderForm("paymentStatus", value)}
                  options={["Unpaid", "Partially Paid", "Paid"]}
                />
              </View>
            </View>
            </View>

            <View style={styles.formSection}>
              <View style={styles.sectionHeader}>
                <View>
                  <Text style={styles.sectionTitle}>{orderForm.type === "purchase" ? "Supplier" : "Customer / outlet"}</Text>
                  <Text style={styles.sectionHint}>Party information used for order and invoice records.</Text>
                </View>
              </View>
            {orderForm.type === "sale" && (
              <View style={styles.partyTypeWrap}>
                <Text style={styles.fieldGroupLabel}>Party type</Text>
                <FilterChips
                  activeValue={orderForm.partyType}
                  disabled={isSubmitLocked}
                  onChange={(value) => {
                    updateOrderForm("partyType", value);
                    updateOrderForm("customerId", null);
                    updateOrderForm("outletId", null);
                    updateOrderForm("partyName", "");
                    setSelectedPartyId("");
                  }}
                  options={["B2C", "B2B"]}
                />
              </View>
            )}
            {orderForm.type === "purchase" ? (
              <View style={styles.partyPanel}>
                <Text style={styles.helperText}>
                  {sessionRole === "outlet"
                    ? "This purchase is sent to the admin. The supplier details stay fixed."
                    : "Select an existing supplier or add a new one with complete contact details."}
                </Text>
                {sessionRole === "outlet" ? (
                  <FormField
                    label="Supplier company"
                    onChangeText={(value) => updateOrderForm("partyName", value)}
                    placeholder="Supplier / business name"
                    value={orderForm.partyName}
                  />
                ) : (
                  <>
                    <SearchablePicker
                      activeValue={orderForm.supplierId ? String(orderForm.supplierId) : ""}
                      allowCustomValue
                      disabled={isSubmitLocked}
                      emptyText="No suppliers yet. Type a new supplier here."
                      inputValue={orderForm.partyName}
                      label="Supplier"
                      onChange={(value) => {
                        const selectedSupplier = suppliers.find((supplier) => String(supplier.id) === String(value));
                        updateOrderForm("supplierId", selectedSupplier?.id || null);
                        updateOrderForm("partyName", selectedSupplier?.name || "");
                        updateOrderForm("supplierEmail", selectedSupplier?.email || "");
                        updateOrderForm("supplierPhone", selectedSupplier?.phone || selectedSupplier?.mobile || "");
                      }}
                      onInputChange={(value) => {
                        updateOrderForm("supplierId", null);
                        updateOrderForm("partyName", value);
                        updateOrderForm("supplierEmail", "");
                        updateOrderForm("supplierPhone", "");
                      }}
                      options={supplierOptions}
                      placeholder="Select supplier"
                      searchKeys={["label", "hint"]}
                    />
                    <View style={styles.contactFields}>
                      <View style={styles.contactFieldItem}>
                        <FormField
                          label="Supplier email"
                          onChangeText={(value) => updateOrderForm("supplierEmail", value)}
                          placeholder="supplier@example.com"
                          value={orderForm.supplierEmail}
                        />
                      </View>
                      <View style={styles.contactFieldItem}>
                        <FormField
                          error={formError === "Enter a valid supplier phone number" ? formError : ""}
                          keyboardType="phone-pad"
                          label="Supplier phone"
                          maxLength={20}
                          onChangeText={(value) => updateOrderForm("supplierPhone", value)}
                          placeholder="Phone with country code"
                          value={orderForm.supplierPhone}
                        />
                      </View>
                    </View>
                  </>
                )}
              </View>
            ) : (
              <View style={styles.partyPanel}>
                {canPickParty ? (
                  <SearchablePicker
                    activeValue={selectedPartyId}
                    disabled={isSubmitLocked}
                    emptyText="No matching party found"
                    label={orderForm.partyType === "B2C" ? "Customer" : "Outlet / Admin"}
                    onChange={(value) => {
                      setSelectedPartyId(value);
                      if (value === "ADMIN") {
                        updateOrderForm("partyName", businessProfile?.tradeName || "Admin");
                        updateOrderForm("outletId", activeOutlet?.id || null);
                        updateOrderForm("customerId", null);
                        return;
                      }
                      const selectedCustomer = customers.find((customer) => String(customer.id) === String(value));
                      const selectedOutlet = outlets.find((outlet) => String(outlet.id) === String(value));
                      if (selectedCustomer) {
                        updateOrderForm("partyName", selectedCustomer.name || selectedCustomer.phone);
                        updateOrderForm("customerId", selectedCustomer.id);
                        updateOrderForm("outletId", selectedCustomer.outletId || selectedCustomer.outlet_id || activeOutlet?.id || null);
                      } else if (selectedOutlet) {
                        updateOrderForm("partyName", selectedOutlet.tradeName || selectedOutlet.name);
                        updateOrderForm("outletId", selectedOutlet.id);
                        updateOrderForm("customerId", null);
                      }
                    }}
                    options={partyPickerOptions}
                    placeholder="Search who this order is for"
                    searchKeys={["label", "hint"]}
                  />
                ) : null}
                <TouchableOpacity
                  activeOpacity={0.85}
                  disabled={isSubmitLocked}
                  onPress={() => setShowManualParty((value) => !value)}
                  style={styles.linkButton}
                >
                  <Text style={styles.linkButtonText}>{showManualParty ? "Hide manual entry" : "Add new party"}</Text>
                </TouchableOpacity>
                {(showManualParty || !canPickParty) && (
                  <FormField
                    label={orderForm.type === "sale" ? "Customer / outlet name" : "Supplier company"}
                    onChangeText={(value) => updateOrderForm("partyName", value)}
                    placeholder={orderForm.type === "sale" ? "Enter customer or outlet" : "Enter supplier company"}
                    value={orderForm.partyName}
                  />
                )}
              </View>
            )}
            </View>

            <View style={styles.formSection}>
            <View style={styles.sectionHeader}>
              <View>
                <Text style={styles.sectionTitle}>Products</Text>
                <Text style={styles.sectionHint}>{items.length} line{items.length === 1 ? "" : "s"} in this order</Text>
              </View>
              <TouchableOpacity disabled={isSubmitLocked} activeOpacity={0.85} onPress={addItem} style={styles.smallButton}>
                <Text style={styles.smallButtonText}>Add item</Text>
              </TouchableOpacity>
            </View>

            {items.map((item, index) => {
              const product = productLookup[String(item.productId)];
              const quoteLine = quotedItemsByProduct[String(item.productId)];
              const localLineSubtotal = Number(item.quantity || 0) * Number(item.rate || 0);
              const localLineDiscount = orderForm.type === "sale" && product ? discountAmountForProduct(product, item.quantity, item.rate) : 0;
              const lineSubtotal = Number(quoteLine?.lineSubtotal ?? quoteLine?.line_subtotal ?? localLineSubtotal);
              const lineDiscount = Number(quoteLine?.discountAmount ?? quoteLine?.discount_amount ?? localLineDiscount);
              const lineTaxable = Number(quoteLine?.lineTotal ?? quoteLine?.line_total ?? Math.max(0, lineSubtotal - lineDiscount));
              const lineTax = (lineTaxable * Number(item.gstRate || 0)) / 100;
              const quickOptions = getQuantityOptions(product);
              const isPackaged = packagedTypes.has(item.unitType);
              const appliedDiscount = compactDiscountOffer(quoteLine?.discountLabel || quoteLine?.discount_label || (product && orderForm.type === "sale" ? discountLabel(product, item.quantity) : ""));

              return (
                <View key={`item-${index}`} style={styles.itemFormCard}>
                  <View style={styles.itemTopRow}>
                    <View style={styles.itemIndexBadge}>
                      <Text style={styles.itemIndexText}>{index + 1}</Text>
                    </View>
                    <View style={styles.itemProductCell}>
                      <SearchablePicker
                        activeValue={item.productId}
                        disabled={isSubmitLocked}
                        emptyText="No products match your search"
                        label="Product"
                        onChange={(value) => updateItem(index, "productId", value)}
                        options={productOptions}
                        placeholder="Search product name or SKU"
                        searchKeys={["label", "hint"]}
                      />
                      <View style={styles.productMetaRow}>
                        <Text style={styles.selectedProduct}>
                          {product ? `${product.name} - ${product.sku}` : "Pick a product from the searchable list"}
                        </Text>
                        {!!appliedDiscount && <Text style={styles.discountText}>{appliedDiscount}</Text>}
                      </View>
                    </View>
                    {items.length > 1 && (
                      <TouchableOpacity disabled={isSubmitLocked} activeOpacity={0.85} onPress={() => removeItem(index)} style={styles.removeIconButton}>
                        <Text style={styles.removeIconText}>×</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                  {!!quickOptions.length && (
                    <View style={styles.quickQtyRow}>
                      <Text style={styles.fieldGroupLabel}>Quick quantity</Text>
                      <FilterChips
                        activeValue={isPackaged ? item.packageCount : item.quantity}
                        disabled={isSubmitLocked}
                        onChange={(value) => updateItem(index, isPackaged ? "packageCount" : "quantity", value)}
                        options={quickOptions}
                      />
                    </View>
                  )}
                  {isPackaged && (
                    <View style={styles.itemFieldGrid}>
                      <View style={styles.itemField}>
                        <FormField keyboardType="numeric" label={`No. of ${item.unitLabel}`} onChangeText={(value) => updateItem(index, "packageCount", value)} placeholder="1" value={item.packageCount} />
                      </View>
                      <View style={styles.itemField}>
                        <FormField keyboardType="numeric" label={`Content in one ${item.unitLabel} (${item.packageSizeUnit || "units"})`} onChangeText={(value) => updateItem(index, "packageSize", value)} placeholder="1" value={item.packageSize} />
                      </View>
                    </View>
                  )}
                  <View style={styles.itemFieldGrid}>
                    <View style={styles.itemField}>
                      <FormField keyboardType="numeric" label={`Quantity (${item.unitLabel})`} onChangeText={(value) => updateItem(index, "quantity", value)} placeholder="1" value={item.quantity} />
                    </View>
                    <View style={styles.itemField}>
                      <FormField disabled={orderForm.type === "sale"} keyboardType="numeric" label={orderForm.type === "sale" ? "Selling price" : "Purchase rate"} onChangeText={(value) => updateItem(index, "rate", value)} placeholder="0" value={item.rate} />
                    </View>
                    <View style={styles.itemField}>
                      <FormField keyboardType="numeric" label="GST %" onChangeText={(value) => updateItem(index, "gstRate", value)} placeholder="18" value={item.gstRate} />
                    </View>
                  </View>
                  <Text style={styles.selectedProduct}>Format: {formatUnitSummary(item)}</Text>
                  <View style={styles.lineTotal}>
                    <LineMetric label="Original" value={formatCurrency(lineSubtotal)} />
                    <LineMetric highlight={lineDiscount > 0} label="Discount" value={lineDiscount > 0 ? appliedDiscount || "Offer applied" : "-"} />
                    <LineMetric label="Taxable" value={formatCurrency(lineTaxable)} />
                    <LineMetric label="GST" value={formatCurrency(lineTax)} />
                  </View>
                </View>
              );
            })}
            </View>

            <OrderTotalsPanel quoteError={quoteError} quoteLoading={quoteLoading} totals={displayedTotals} />

            {!!formError && <Text style={styles.formErrorText}>{formError}</Text>}
                <View style={styles.formActions}>
                  <TouchableOpacity disabled={isSubmitLocked} activeOpacity={0.85} onPress={resetForm} style={styles.cancelButton}>
                    <Text style={styles.cancelButtonText}>Cancel</Text>
                  </TouchableOpacity>
                  <View style={styles.saveButtonWrap}>
                    <AppButton disabled={isSubmitLocked} label={orderSubmitting ? "Saving..." : editingOrder ? "Update Order" : "Save Order"} onPress={submitOrder} />
                  </View>
                </View>
              </ScrollView>
            </View>
          </View>
        </Modal>

        <OrderInvoiceModal
          dueDate={invoiceDueDate}
          isBusy={isBusy}
          onClose={closeInvoiceModal}
          onGenerate={generateInvoice}
          onDueDateChange={setInvoiceDueDate}
          order={invoiceOrder}
        />

        <View style={styles.filterCard}>
          <View style={styles.filterHeader}>
            <View style={styles.filterTitleWrap}>
              <Text style={styles.filterTitle}>Find an order</Text>
              <Text style={styles.filterSubtitle}>{filteredOrders.length} of {orders.length} orders shown</Text>
            </View>
            {activeFilterCount > 0 && (
              <TouchableOpacity activeOpacity={0.8} onPress={clearFilters} style={styles.resetButton}>
                <Text style={styles.resetButtonText}>Reset filters</Text>
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.searchWrap}>
            <Text style={styles.searchIcon}>⌕</Text>
            <SearchInput
              disabled={isBusy}
              placeholder="Search order, party, product or SKU"
              value={search}
              onChangeText={setSearch}
            />
          </View>

          <View style={styles.primaryFilters}>
            <View style={styles.filterGroup}>
              <SearchablePicker
                activeValue={typeFilter}
                disabled={isBusy}
                label="Order type"
                onChange={setTypeFilter}
                options={["All", "Purchase Orders", "Sales Orders"].map((value) => ({ label: value, value }))}
                overlayDropdown
                placeholder="Select order type"
                selectMode
                showDropdownIndicator
              />
            </View>
            <View style={styles.filterGroup}>
              <SearchablePicker
                activeValue={statusFilter}
                disabled={isBusy}
                label="Status"
                onChange={setStatusFilter}
                options={statuses.map((value) => ({ label: value, value }))}
                overlayDropdown
                placeholder="Select status"
                selectMode
                showDropdownIndicator
              />
            </View>
            <View style={styles.filterGroup}>
              <SearchablePicker
                activeValue={paymentFilter}
                disabled={isBusy}
                label="Payment"
                onChange={setPaymentFilter}
                options={paymentStatuses.map((value) => ({ label: value, value }))}
                overlayDropdown
                placeholder="Select payment status"
                selectMode
                showDropdownIndicator
              />
            </View>
          </View>

          <TouchableOpacity
            activeOpacity={0.8}
            disabled={isBusy}
            onPress={() => setShowAdvancedFilters((value) => !value)}
            style={styles.moreFiltersButton}
          >
            <Text style={styles.moreFiltersText}>{showAdvancedFilters ? "Hide more filters" : "More filters"}</Text>
            <Text style={styles.moreFiltersChevron}>{showAdvancedFilters ? "−" : "+"}</Text>
          </TouchableOpacity>

          {showAdvancedFilters && (
            <View style={styles.moreFiltersPanel}>
              <View style={styles.filterGroup}>
                <SearchablePicker
                  activeValue={partyFilter}
                  disabled={isBusy}
                  label="Party type"
                  onChange={setPartyFilter}
                  options={["All Parties", "B2B", "B2C"].map((value) => ({ label: value, value }))}
                  overlayDropdown
                  placeholder="Select party type"
                  selectMode
                  showDropdownIndicator
                />
              </View>
              <View style={styles.filterGroup}>
                <Text style={styles.filterLabel}>Order date</Text>
                <View style={styles.twoColumn}>
                  <View style={styles.flexItem}>
                    <FormField label="From" value={startDate} onChangeText={setStartDate} placeholder="YYYY-MM-DD" type="date" />
                  </View>
                  <View style={styles.flexItem}>
                    <FormField label="To" value={endDate} onChangeText={setEndDate} placeholder="YYYY-MM-DD" type="date" />
                  </View>
                </View>
              </View>
            </View>
          )}
        </View>
      </View>

      <View style={styles.list}>
        {!visibleOrders.length && (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No orders found</Text>
            <Text style={styles.emptyText}>Try changing the search text or clearing the active filters.</Text>
          </View>
        )}
        {visibleOrders.map((order) => {
          const isSale = order.type === "sale";
          const taxableValue = Number(order.taxableValue || 0);
          const taxValue = Number(order.taxValue || 0);
          const subtotalValue = Number(order.subtotalValue ?? order.subtotal_value ?? taxableValue);
          const discountOffer = orderDiscountOfferSummary(order, productLookup);
          const grandTotal = Number(order.grandTotal || taxableValue + taxValue);
          const isDeletingThisOrder = String(deletingOrderId) === String(order.id);

          return (
            <View key={order.id} style={styles.orderCardPair}>
              <View style={[styles.card, styles.orderDetailsCard]}>
                <View style={styles.cardHeader}>
                  <View style={styles.titleWrap}>
                    <Text style={styles.orderId}>{order.orderNumber || `Order ${order.id}`}</Text>
                    <Text style={styles.party}>{order.partyName}</Text>
                  </View>
                  <Text style={[styles.typeBadge, isSale ? styles.saleBadge : styles.purchaseBadge]}>
                    {isSale ? "SALE" : "PURCHASE"}
                  </Text>
                </View>

                <View style={styles.badgeRow}>
                  <Text style={styles.meta}>{order.partyType}</Text>
                  <Text style={[styles.statusBadge, styles.neutralBadge]}>{order.status}</Text>
                  <Text
                    style={[
                      styles.statusBadge,
                      order.paymentStatus === "Paid" ? styles.successBadge : styles.warningBadge,
                    ]}
                  >
                    {order.paymentStatus}
                  </Text>
                </View>

                <View style={styles.detailGrid}>
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>{isSale ? "Customer" : "Supplier"}</Text>
                    <Text style={styles.detailValue}>{order.partyName || "-"}</Text>
                  </View>
                  <View style={styles.detailItem}>
                    <Text style={styles.detailLabel}>Order date</Text>
                    <Text style={styles.detailValue}>{formatDate(order.date)}</Text>
                  </View>
                  {!isSale && (
                    <View style={styles.detailItem}>
                      <Text style={styles.detailLabel}>Supplier phone</Text>
                      <Text style={styles.detailValue}>{order.supplierPhone || order.supplierMobile || "Not provided"}</Text>
                    </View>
                  )}
                </View>

                <View style={styles.itemsBox}>
                  <Text style={styles.sectionLabel}>Product summary</Text>
                  {order.items.map((item) => {
                    const itemDiscount = Number(item.discountAmount ?? item.discount_amount ?? 0);
                    const itemDiscountLabel = itemDiscountOffer(item);
                    const availableOffer = itemAvailableOffer(item, productLookup[String(item.productId ?? item.product_id)]);
                    return (
                      <View key={`${order.id}-${item.id || item.productId}`} style={styles.itemRow}>
                        <Text style={styles.itemName}>{item.productName || productLookup[String(item.productId)]?.name || item.productId}</Text>
                        <Text style={styles.itemValue}>
                          {formatUnitSummary(item)} - Original {formatCurrency(item.rate)}
                          {itemDiscount > 0
                            ? ` - Discount ${itemDiscountLabel || "Offer applied"}`
                            : !isSale && availableOffer
                              ? ` - Sale offer ${availableOffer}`
                              : ""}
                          {" - "}GST {item.gstRate}%
                        </Text>
                      </View>
                    );
                  })}
                </View>
              </View>

              <View style={[styles.card, styles.financialCard]}>
                <View>
                  <Text style={styles.sectionLabel}>Financial summary</Text>
                  <View style={styles.totalGrid}>
                    <Total label="Original subtotal" value={formatCurrency(subtotalValue)} />
                    <Total label={isSale ? "Discount" : "Sale offers"} value={discountOffer} />
                    <Total label="Taxable value" value={formatCurrency(taxableValue)} />
                    <Total label="Tax" value={formatCurrency(taxValue)} />
                    <Total label="Grand total" value={formatCurrency(grandTotal)} strong />
                  </View>
                </View>

                <View style={styles.invoiceRow}>
                  <TouchableOpacity disabled={isBusy || isDeletingThisOrder} activeOpacity={0.85} onPress={() => openInvoiceModal(order)} style={styles.invoiceButton}>
                    <Text style={styles.invoiceButtonText}>Generate Invoice</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.actionRow}>
                  <TouchableOpacity disabled={isBusy || isDeletingThisOrder} activeOpacity={0.85} onPress={() => openEditForm(order)} style={styles.editButton}>
                    <Text style={styles.editText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    disabled={isBusy || isDeletingThisOrder}
                    activeOpacity={0.85}
                    onPress={() => confirmDelete(order)}
                    style={[styles.deleteButton, isDeletingThisOrder && styles.actionButtonDisabled]}
                  >
                    <Text style={styles.deleteText}>{isDeletingThisOrder ? "Deleting..." : "Delete"}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          );
        })}
      </View>

      <View style={styles.pagination}>
          <PaginationControls
            currentPage={currentPage}
            label="orders"
            onPageChange={handlePageChange}
            pageSize={PAGE_SIZE}
            totalCount={filteredOrders.length}
            totalPages={totalPages}
          />
      </View>
    </ScrollView>
  );
}

function Total({ inverse, label, strong, value }) {
  return (
    <View style={styles.totalItem}>
      <Text style={[styles.totalLabel, inverse && styles.totalLabelInverse]}>{label}</Text>
      <Text style={[styles.totalValue, inverse && styles.totalValueInverse, strong && styles.strongTotal]}>{value}</Text>
    </View>
  );
}

function LineMetric({ highlight, label, value }) {
  return (
    <View style={styles.lineMetric}>
      <Text style={styles.lineMetricLabel}>{label}</Text>
      <Text style={[styles.lineMetricValue, highlight && styles.lineMetricHighlight]}>{value}</Text>
    </View>
  );
}

function OrderTotalsPanel({ quoteError, quoteLoading, totals }) {
  return (
    <View style={styles.formTotalsWrap}>
      <View style={styles.formTotals}>
        <Total inverse label="Original subtotal" value={formatCurrency(totals.subtotalValue ?? totals.subtotal_value ?? 0)} />
        <Total inverse label="Discount" value={`-${formatCurrency(totals.discountValue ?? totals.discount_value ?? 0)}`} />
        <Total inverse label="Taxable value" value={formatCurrency(totals.taxableValue ?? totals.taxable_value ?? 0)} />
        <Total inverse label="Taxes" value={formatCurrency(totals.taxValue ?? totals.tax_value ?? 0)} />
        <Total inverse label={quoteLoading ? "Total updating" : "Total"} value={formatCurrency(totals.grandTotal ?? totals.grand_total ?? 0)} strong />
      </View>
      {!!quoteError && <Text style={styles.quoteWarning}>Live pricing unavailable. Showing local estimate.</Text>}
    </View>
  );
}

function OrderInvoiceModal({ dueDate, isBusy, onClose, onDueDateChange, onGenerate, order }) {
  return (
    <Modal animationType="fade" onRequestClose={onClose} transparent visible={!!order}>
      <View style={styles.modalOverlay}>
        <View style={styles.invoiceModalCard}>
          <View style={styles.modalHeader}>
            <View style={styles.modalTitleWrap}>
              <Text style={styles.formTitle}>Generate invoice</Text>
              <Text style={styles.modalSubtitle}>
                {order?.orderNumber || `Order ${order?.id}`} - {order?.partyName}
              </Text>
            </View>
            <TouchableOpacity
              accessibilityLabel="Close invoice form"
              activeOpacity={0.8}
              disabled={isBusy}
              onPress={onClose}
              style={styles.modalCloseButton}
            >
              <Text style={styles.modalCloseText}>×</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.invoiceModalBody}>
            <FormField
              disabled={isBusy}
              label="Invoice due date"
              onChangeText={onDueDateChange}
              placeholder="YYYY-MM-DD"
              type="date"
              value={dueDate}
            />
            <View style={styles.invoicePreview}>
              <Total label="Order total" value={formatCurrency(order?.grandTotal || order?.grand_total || 0)} strong />
              <Total label="Payment" value={order?.paymentStatus || "Unpaid"} />
            </View>
            <View style={styles.formActions}>
              <TouchableOpacity disabled={isBusy} activeOpacity={0.85} onPress={onClose} style={styles.cancelButton}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity disabled={isBusy} activeOpacity={0.85} onPress={onGenerate} style={styles.invoiceButton}>
                <Text style={styles.invoiceButtonText}>{isBusy ? "Generating..." : "Generate Invoice"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </View>
    </Modal>
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
  filterCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
  },
  filterHeader: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  filterTitleWrap: {
    flexGrow: 1,
  },
  filterTitle: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: "700",
  },
  filterSubtitle: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 3,
  },
  resetButton: {
    backgroundColor: colors.dangerSoft,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  resetButtonText: {
    color: colors.danger,
    fontSize: 12,
    fontWeight: "700",
  },
  searchWrap: {
    position: "relative",
  },
  searchIcon: {
    color: colors.muted,
    fontSize: 22,
    position: "absolute",
    right: spacing.md,
    top: 12,
    zIndex: 2,
  },
  primaryFilters: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  filterGroup: {
    flexBasis: 220,
    flexGrow: 1,
    gap: spacing.sm,
  },
  filterLabel: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  moreFiltersButton: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    flexDirection: "row",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  moreFiltersText: {
    color: colors.primaryDark,
    fontSize: 12,
    fontWeight: "700",
  },
  moreFiltersChevron: {
    color: colors.primary,
    fontSize: 17,
    fontWeight: "700",
    lineHeight: 17,
  },
  moreFiltersPanel: {
    backgroundColor: colors.background,
    borderRadius: radii.md,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    padding: spacing.md,
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
    maxWidth: 1080,
    overflow: "hidden",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.24,
    shadowRadius: 36,
    width: "100%",
  },
  invoiceModalCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    maxWidth: 520,
    overflow: "hidden",
    shadowColor: "#000000",
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.22,
    shadowRadius: 32,
    width: "100%",
  },
  invoiceModalBody: {
    gap: spacing.md,
    padding: spacing.md,
  },
  invoicePreview: {
    backgroundColor: colors.background,
    borderRadius: radii.md,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    padding: spacing.md,
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
  },
  modalSubtitle: {
    color: colors.muted,
    fontSize: 12,
    marginTop: 4,
  },
  modalCloseButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: 999,
    height: 38,
    justifyContent: "center",
    width: 38,
  },
  modalCloseText: {
    color: colors.ink,
    fontSize: 25,
    fontWeight: "500",
    lineHeight: 27,
  },
  formCard: {
    backgroundColor: colors.background,
    gap: spacing.md,
    padding: spacing.md,
  },
  formSection: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  sectionHeader: {
    alignItems: "center",
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "space-between",
    paddingBottom: spacing.sm,
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "700",
  },
  sectionHint: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    marginTop: 3,
  },
  formGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  formGridItem: {
    flexBasis: 240,
    flexGrow: 1,
    gap: spacing.sm,
  },
  fieldGroupLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  partyTypeWrap: {
    gap: spacing.sm,
  },
  formActions: {
    alignItems: "stretch",
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    paddingTop: spacing.md,
  },
  cancelButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexGrow: 1,
    justifyContent: "center",
    minHeight: 50,
    paddingHorizontal: spacing.lg,
  },
  cancelButtonText: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "700",
  },
  saveButtonWrap: {
    flexBasis: 240,
    flexGrow: 2,
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
  partyPanel: {
    gap: spacing.sm,
  },
  linkButton: {
    alignSelf: "flex-start",
    paddingVertical: 4,
  },
  linkButtonText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
  },
  smallButton: {
    backgroundColor: colors.primarySoft,
    borderRadius: 99,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  smallButtonText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
  },
  itemFormCard: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  itemTopRow: {
    alignItems: "flex-start",
    flexDirection: "row",
    gap: spacing.sm,
  },
  itemIndexBadge: {
    alignItems: "center",
    backgroundColor: colors.primaryDark,
    borderRadius: radii.sm,
    height: 36,
    justifyContent: "center",
    marginTop: 20,
    width: 36,
  },
  itemIndexText: {
    color: colors.white,
    fontSize: 13,
    fontWeight: "700",
  },
  itemProductCell: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 220,
  },
  productMetaRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  quickQtyRow: {
    gap: spacing.sm,
  },
  itemFieldGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  itemField: {
    flexBasis: 170,
    flexGrow: 1,
  },
  selectedProduct: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  discountText: {
    color: colors.success,
    fontSize: 12,
    fontWeight: "700",
  },
  twoColumn: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  contactFields: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  contactFieldItem: {
    flexBasis: 240,
    flexGrow: 1,
  },
  flexItem: {
    flex: 1,
  },
  lineTotal: {
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
  lineMetric: {
    flexBasis: 110,
    flexGrow: 1,
  },
  lineMetricLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
  },
  lineMetricValue: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "700",
    marginTop: 3,
  },
  lineMetricHighlight: {
    color: colors.success,
  },
  removeIconButton: {
    alignItems: "center",
    backgroundColor: colors.dangerSoft,
    borderRadius: radii.sm,
    height: 34,
    justifyContent: "center",
    marginTop: 20,
    width: 34,
  },
  removeIconText: {
    color: colors.danger,
    fontSize: 20,
    fontWeight: "700",
    lineHeight: 22,
  },
  formTotals: {
    backgroundColor: colors.primaryDark,
    borderRadius: radii.md,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "space-between",
    padding: spacing.md,
  },
  list: {
    gap: spacing.md,
    paddingHorizontal: spacing.md,
  },
  emptyCard: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    padding: spacing.xl,
  },
  emptyTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "700",
  },
  emptyText: {
    color: colors.muted,
    fontSize: 13,
    marginTop: spacing.xs,
    textAlign: "center",
  },
  orderCardPair: {
    alignItems: "stretch",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
  },
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    flexGrow: 1,
    maxWidth: "100%",
    padding: spacing.md,
  },
  orderDetailsCard: {
    flexBasis: 430,
  },
  financialCard: {
    flexBasis: 300,
    justifyContent: "space-between",
  },
  cardHeader: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  titleWrap: {
    flex: 1,
  },
  orderId: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "700",
  },
  party: {
    color: colors.muted,
    fontSize: 12,
    marginTop: spacing.xs,
  },
  typeBadge: {
    borderRadius: 99,
    fontSize: 11,
    fontWeight: "700",
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  saleBadge: {
    backgroundColor: colors.successSoft,
    color: colors.success,
  },
  purchaseBadge: {
    backgroundColor: colors.primarySoft,
    color: colors.primary,
  },
  badgeRow: {
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
  statusBadge: {
    borderRadius: 99,
    fontSize: 11,
    fontWeight: "700",
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  neutralBadge: {
    backgroundColor: colors.primarySoft,
    color: colors.primaryDark,
  },
  successBadge: {
    backgroundColor: colors.successSoft,
    color: colors.success,
  },
  warningBadge: {
    backgroundColor: colors.warningSoft,
    color: colors.warning,
  },
  detailGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  detailItem: {
    backgroundColor: colors.background,
    borderRadius: radii.md,
    flex: 1,
    flexBasis: 150,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  detailLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "600",
  },
  detailValue: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "700",
    marginTop: spacing.xs,
  },
  sectionLabel: {
    color: colors.ink,
    fontSize: 12,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  itemsBox: {
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  itemRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  itemName: {
    color: colors.ink,
    flex: 1,
    fontSize: 13,
    fontWeight: "700",
  },
  itemValue: {
    color: colors.muted,
    flexShrink: 1,
    fontSize: 12,
    fontWeight: "600",
    textAlign: "right",
  },
  totalGrid: {
    backgroundColor: colors.background,
    borderRadius: radii.md,
    flexWrap: "wrap",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
    marginTop: spacing.md,
    padding: spacing.md,
  },
  totalItem: {
    flexBasis: 110,
    flexGrow: 1,
  },
  totalLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
  },
  totalLabelInverse: {
    color: "rgba(255, 255, 255, 0.72)",
  },
  totalValue: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "700",
    marginTop: spacing.xs,
  },
  totalValueInverse: {
    color: colors.white,
  },
  strongTotal: {
    color: colors.success,
  },
  invoiceRow: {
    alignItems: "flex-end",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "flex-end",
    marginTop: spacing.md,
  },
  invoiceButton: {
    backgroundColor: colors.primary,
    borderRadius: radii.md,
    alignItems: "center",
    flexGrow: 1,
    justifyContent: "center",
    minHeight: 50,
    paddingHorizontal: spacing.md,
  },
  invoiceButtonText: {
    color: colors.white,
    fontSize: 12,
    fontWeight: "700",
  },
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.md,
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
  actionButtonDisabled: {
    opacity: 0.55,
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
});
