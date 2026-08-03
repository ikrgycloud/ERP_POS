import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ActivityIndicator,
  Image,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, { Circle, Line, Path, Polyline, Rect } from "react-native-svg";
import { LoginScreen } from "./src/screens/LoginScreen";
import { RegisterScreen } from "./src/screens/RegisterScreen";
import { DashboardScreen } from "./src/screens/DashboardScreen";
import { ProductsScreen } from "./src/screens/ProductsScreen";
import { InventoryScreen } from "./src/screens/InventoryScreen";
import { DiscountsScreen } from "./src/screens/DiscountsScreen";
import { OrdersScreen } from "./src/screens/OrdersScreen";
import { InvoicesScreen } from "./src/screens/InvoicesScreen";
import { WaybillsScreen } from "./src/screens/WaybillsScreen";
import { ReportsScreen } from "./src/screens/ReportsScreen";
import { BusinessProfileScreen } from "./src/screens/BusinessProfileScreen";
import { CustomersScreen } from "./src/screens/CustomersScreen";
import { FilesScreen } from "./src/screens/FilesScreen";
import { RecentSalesScreen } from "./src/screens/RecentSalesScreen";
import { LandingScreen } from "./src/screens/LandingScreen";
import { colors, spacing, typography } from "./src/constants/theme";
import { ModalProvider } from "./src/components/ModalProvider";
import { api, createRequestKey } from "./src/services/api";
import { API_ROOT_URL } from "./src/config/apiConfig";
import { AppQueryProvider } from "./src/app/queryClient";
import { businessHooks, businessKeys, outletsKeys } from "./src/features/business";
import { customersKeys } from "./src/features/customers";
import { dashboardHooks, dashboardKeys } from "./src/features/dashboard";
import { filesHooks, filesKeys } from "./src/features/files";
import { inventoryHooks, inventoryKeys } from "./src/features/inventory";
import { invoicesHooks, invoicesKeys } from "./src/features/invoices";
import { ordersHooks, ordersKeys } from "./src/features/orders";
import { paymentsKeys } from "./src/features/payments";
import { productsHooks, productsKeys } from "./src/features/products";
import { reportsKeys } from "./src/features/reports";
import { suppliersHooks, suppliersKeys } from "./src/features/suppliers";
import { waybillsHooks, waybillsKeys } from "./src/features/waybills";

Text.defaultProps = Text.defaultProps || {};
Text.defaultProps.style = [Text.defaultProps.style, { fontFamily: typography.baseFont }];
TextInput.defaultProps = TextInput.defaultProps || {};
TextInput.defaultProps.style = [
  TextInput.defaultProps.style,
  {
    boxShadow: "none",
    fontFamily: typography.baseFont,
    outlineColor: "transparent",
    outlineStyle: "none",
    outlineWidth: 0,
  },
];

const WEB_CONTROL_FOCUS_STYLE_ID = "erp-soft-control-focus";

function installWebControlFocusStyles() {
  if (Platform.OS !== "web" || typeof document === "undefined") {
    return;
  }
  if (document.getElementById(WEB_CONTROL_FOCUS_STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = WEB_CONTROL_FOCUS_STYLE_ID;
  style.textContent = `
    input,
    textarea,
    select,
    button {
      outline: none !important;
    }

    input:focus,
    textarea:focus,
    select:focus {
      border-color: #DCE4EF !important;
      box-shadow: 0 0 0 3px rgba(76, 123, 110, 0.10) !important;
    }

    button:focus {
      box-shadow: none !important;
    }
  `;
  document.head.appendChild(style);
}

const tabs = [
  { key: "dashboard", label: "Dashboard", icon: "grid-outline", symbol: "⌂", tint: "#2563EB" },
  { key: "products", label: "Products", icon: "cube-outline", symbol: "▣", tint: "#7C3AED" },
  { key: "inventory", label: "Inventory", icon: "layers-outline", symbol: "▤", tint: "#F59E0B" },
  { key: "discounts", label: "Discounts", icon: "pricetag-outline", symbol: "%", tint: "#EF4444" },
  { key: "orders", label: "Orders", icon: "swap-horizontal-outline", symbol: "⇄", tint: "#F97316" },
  { key: "recentSales", label: "Recent Sales", icon: "trending-up-outline", symbol: "↗", tint: "#16A34A" },
  { key: "outlets", label: "Outlets", icon: "storefront-outline", symbol: "⌘", tint: "#14B8A6" },
  { key: "customers", label: "Customers", icon: "people-outline", symbol: "☏", tint: "#10B981" },
  { key: "invoices", label: "Invoices", icon: "document-text-outline", symbol: "₹", tint: "#0EA5E9" },
  { key: "waybills", label: "Waybills", icon: "time-outline", symbol: "◷", tint: "#8B5CF6" },
  { key: "reports", label: "Reports", icon: "bar-chart-outline", symbol: "▥", tint: "#0F766E" },
  { key: "files", label: "Files", icon: "folder-open-outline", symbol: "▱", tint: "#A16207" },
  { key: "business", label: "Business", icon: "briefcase-outline", symbol: "◆", tint: "#64748B" },
];

const outletTabs = [
  { key: "business", label: "Business", icon: "briefcase-outline", symbol: "◆", tint: "#64748B" },
  { key: "dashboard", label: "Dashboard", icon: "grid-outline", symbol: "⌂", tint: "#2563EB" },
  { key: "customers", label: "Customers", icon: "people-outline", symbol: "☏", tint: "#10B981" },
  { key: "orders", label: "Orders", icon: "swap-horizontal-outline", symbol: "⇄", tint: "#F97316" },
  { key: "recentSales", label: "Recent Sales", icon: "trending-up-outline", symbol: "↗", tint: "#16A34A" },
  { key: "invoices", label: "Invoices", icon: "document-text-outline", symbol: "₹", tint: "#0EA5E9" },
  { key: "reports", label: "Reports", icon: "bar-chart-outline", symbol: "▥", tint: "#0F766E" },
  { key: "files", label: "Files", icon: "folder-open-outline", symbol: "▱", tint: "#A16207" },
];

const sidebarIconProps = {
  fill: "none",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  strokeWidth: 2,
};

function SidebarIcon({ name, color }) {
  const common = { ...sidebarIconProps, stroke: color };
  const size = 18;

  return (
    <Svg height={size} viewBox="0 0 24 24" width={size}>
      {name === "dashboard" && (
        <>
          <Rect {...common} height="7" width="7" x="3" y="3" rx="1.5" />
          <Rect {...common} height="7" width="7" x="14" y="3" rx="1.5" />
          <Rect {...common} height="7" width="7" x="3" y="14" rx="1.5" />
          <Rect {...common} height="7" width="7" x="14" y="14" rx="1.5" />
        </>
      )}
      {name === "products" && (
        <>
          <Path {...common} d="M12 3 4 7.2l8 4.2 8-4.2L12 3Z" />
          <Path {...common} d="M4 7.2v9.6L12 21l8-4.2V7.2" />
          <Path {...common} d="M12 11.4V21" />
        </>
      )}
      {name === "inventory" && (
        <>
          <Path {...common} d="m12 4 8 4-8 4-8-4 8-4Z" />
          <Path {...common} d="m4 12 8 4 8-4" />
          <Path {...common} d="m4 16 8 4 8-4" />
        </>
      )}
      {name === "discounts" && (
        <>
          <Path {...common} d="M20 12.5 12.5 20 4 11.5V4h7.5L20 12.5Z" />
          <Circle {...common} cx="8.5" cy="8.5" r="1.5" />
          <Line {...common} x1="9" y1="16" x2="16" y2="9" />
        </>
      )}
      {name === "orders" && (
        <>
          <Path {...common} d="M7 7h12l-3-3" />
          <Path {...common} d="M17 17H5l3 3" />
          <Path {...common} d="M19 7l-3 3" />
          <Path {...common} d="M5 17l3-3" />
        </>
      )}
      {name === "recentSales" && (
        <>
          <Polyline {...common} points="4 16 9 11 13 15 20 8" />
          <Path {...common} d="M14 8h6v6" />
        </>
      )}
      {name === "outlets" && (
        <>
          <Path {...common} d="M4 10h16l-1.2-5H5.2L4 10Z" />
          <Path {...common} d="M6 10v10h12V10" />
          <Path {...common} d="M9 20v-5h6v5" />
        </>
      )}
      {name === "customers" && (
        <>
          <Circle {...common} cx="9" cy="8" r="3" />
          <Path {...common} d="M3.5 20c.8-3.2 2.8-5 5.5-5s4.7 1.8 5.5 5" />
          <Path {...common} d="M15 11c1.8.2 3.3 1.5 4 3.5" />
          <Path {...common} d="M16 5.5a2.5 2.5 0 0 1 0 5" />
        </>
      )}
      {name === "invoices" && (
        <>
          <Path {...common} d="M7 3h8l4 4v14H7V3Z" />
          <Path {...common} d="M15 3v5h4" />
          <Path {...common} d="M10 12h6" />
          <Path {...common} d="M10 16h4" />
        </>
      )}
      {name === "waybills" && (
        <>
          <Rect {...common} height="13" width="16" x="4" y="5" rx="2" />
          <Path {...common} d="M8 9h8" />
          <Path {...common} d="M8 13h5" />
          <Circle {...common} cx="8" cy="19" r="1.5" />
          <Circle {...common} cx="16" cy="19" r="1.5" />
        </>
      )}
      {name === "reports" && (
        <>
          <Path {...common} d="M5 20V10" />
          <Path {...common} d="M12 20V4" />
          <Path {...common} d="M19 20v-7" />
          <Path {...common} d="M4 20h16" />
        </>
      )}
      {name === "files" && (
        <>
          <Path {...common} d="M4 6h6l2 2h8v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Z" />
          <Path {...common} d="M4 10h16" />
        </>
      )}
      {name === "business" && (
        <>
          <Rect {...common} height="14" width="16" x="4" y="6" rx="2" />
          <Path {...common} d="M9 6V4h6v2" />
          <Path {...common} d="M4 12h16" />
          <Path {...common} d="M10 12v2h4v-2" />
        </>
      )}
    </Svg>
  );
}

function SidebarNavItem({ isActive, onPress, tab }) {
  const tint = tab.tint || colors.primary;
  const iconColor = isActive ? colors.white : tint;

  return (
    <TouchableOpacity
      activeOpacity={0.88}
      onPress={onPress}
      style={[
        styles.sidebarItem,
        isActive && styles.sidebarItemActive,
        isActive && { backgroundColor: `${tint}12`, borderColor: `${tint}30` },
      ]}
      accessible
      accessibilityLabel={tab.label}
    >
      <View style={[styles.sidebarActiveRail, isActive && { backgroundColor: tint, opacity: 1 }]} />
      <View style={[styles.sidebarSymbol, { backgroundColor: isActive ? tint : `${tint}14` }]}>
        <SidebarIcon color={iconColor} name={tab.key} />
      </View>
      <Text style={[styles.sidebarLabel, isActive && { color: colors.ink }]} numberOfLines={1}>
        {tab.label}
      </Text>
    </TouchableOpacity>
  );
}

const emptyDashboard = {
  inventoryValue: 0,
  lowStockCount: 0,
  payables: 0,
  purchaseOrders: 0,
  receivables: 0,
  salesOrders: 0,
  totalProfit: 0,
  totalRevenue: 0,
};

const WEB_SESSION_KEY = "erp-session";
const dashboardRangeOptions = ["All Time", "Today", "Last 7 Days", "Last 1 Month", "Last 3 Months", "Last 6 Months", "Last 1 Year"];

function toDateParam(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDashboardRangeFilters(range) {
  const end = new Date();
  const start = new Date(end);

  if (range === "All Time") {
    return {};
  }
  if (range === "Today") {
    return { startDate: toDateParam(end), endDate: toDateParam(end) };
  }
  if (range === "Last 7 Days") {
    start.setDate(start.getDate() - 6);
  } else if (range === "Last 1 Month") {
    start.setMonth(start.getMonth() - 1);
  } else if (range === "Last 3 Months") {
    start.setMonth(start.getMonth() - 3);
  } else if (range === "Last 6 Months") {
    start.setMonth(start.getMonth() - 6);
  } else if (range === "Last 1 Year") {
    start.setFullYear(start.getFullYear() - 1);
  } else {
    return {};
  }

  return { startDate: toDateParam(start), endDate: toDateParam(end) };
}

function logoSourceFor(profile) {
  const logoUrl = profile?.logoUrl || profile?.logo_url;
  if (!logoUrl) {
    return null;
  }
  const version = profile?.updatedAt || profile?.updated_at || profile?.logoUpdatedAt || profile?.logo_updated_at || "";
  const cacheSuffix = version ? `${logoUrl.includes("?") ? "&" : "?"}t=${encodeURIComponent(version)}` : "";
  if (/^https?:\/\//i.test(logoUrl)) {
    return { uri: `${logoUrl}${cacheSuffix}` };
  }
  return { uri: `${API_ROOT_URL}${logoUrl.startsWith("/") ? logoUrl : `/${logoUrl}`}${cacheSuffix}` };
}

function AppContent() {
  const queryClient = useQueryClient();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [activeTab, setActiveTab] = useState("dashboard");
  const [businessProfile, setBusinessProfile] = useState(null);
  const [posStaff, setPosStaff] = useState([]);
  const [products, setProducts] = useState([]);
  const [currentOutlet, setCurrentOutlet] = useState(null);
  const currentOutletRef = useRef(null);
  const [sessionRole, setSessionRole] = useState("admin");
  const [accessToken, setAccessToken] = useState(null);
  const [dashboardRange, setDashboardRange] = useState(dashboardRangeOptions[0]);
  const [inventoryNavigation, setInventoryNavigation] = useState(null);
  const [ordersNavigation, setOrdersNavigation] = useState(null);
  const [productsNavigation, setProductsNavigation] = useState(null);
  const [showRegister, setShowRegister] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [isActionLocked, setIsActionLocked] = useState(false);
  const [error, setError] = useState("");
  const [startupError, setStartupError] = useState("");
  const [logoLoadFailed, setLogoLoadFailed] = useState(false);
  const hasLoadedDataRef = useRef(false);
  const businessProfileQuery = businessHooks.useProfile({
    enabled: isAuthenticated,
    request: { bypassCache: true },
    staleTime: 60_000,
  });
  const activeBusinessProfile = businessProfileQuery.data || businessProfile;
  const outletsQuery = businessHooks.useOutlets(activeBusinessProfile?.id, {
    enabled: isAuthenticated && Boolean(activeBusinessProfile?.id),
    request: { bypassCache: true },
    staleTime: 60_000,
  });
  const outletList = outletsQuery.data || [];
  useEffect(() => {
    if (!isAuthenticated || !activeBusinessProfile?.id || sessionRole !== "admin") {
      setPosStaff([]);
      return;
    }
    let cancelled = false;
    api.getPosStaff(activeBusinessProfile.id)
      .then((rows) => { if (!cancelled) setPosStaff(Array.isArray(rows) ? rows : []); })
      .catch(() => { if (!cancelled) setPosStaff([]); });
    return () => { cancelled = true; };
  }, [activeBusinessProfile?.id, isAuthenticated, sessionRole]);
  const dashboardFilters = useMemo(() => {
    const rangeFilters = getDashboardRangeFilters(dashboardRange);
    if (sessionRole === "outlet") {
      const outletId = currentOutlet?.id || currentOutletRef.current?.id || null;
      return { ...rangeFilters, ...(outletId ? { outletId } : {}) };
    }
    return rangeFilters;
  }, [currentOutlet?.id, dashboardRange, sessionRole]);
  const dashboardQuery = dashboardHooks.useSummary(dashboardFilters, {
    enabled: isAuthenticated && Boolean(activeBusinessProfile?.id),
    staleTime: 30_000,
  });
  const dashboardSummary = dashboardQuery.data || emptyDashboard;
  const inventoryValueTimelineQuery = dashboardHooks.useInventoryValueTimeline(dashboardFilters, {
    enabled: isAuthenticated && Boolean(activeBusinessProfile?.id),
    staleTime: 30_000,
  });
  const inventoryValueTimeline = inventoryValueTimelineQuery.data || [];
  const inventoryValueReportQuery = dashboardHooks.useInventoryValueReport(dashboardFilters, {
    enabled: isAuthenticated && Boolean(activeBusinessProfile?.id),
    staleTime: 30_000,
  });
  const inventoryValueReport = inventoryValueReportQuery.data || null;
  const dashboardScopeLabel =
    sessionRole === "outlet"
      ? `${currentOutlet?.tradeName || currentOutlet?.name || "Outlet"} summary`
      : "Admin summary";
  const orderFilters = useMemo(() => {
    if (sessionRole !== "outlet") {
      return undefined;
    }
    const outletId = currentOutlet?.id || currentOutletRef.current?.id || null;
    return outletId ? { outletId } : undefined;
  }, [currentOutlet?.id, sessionRole]);
  const ordersQuery = ordersHooks.useList(orderFilters, {
    enabled: isAuthenticated && Boolean(activeBusinessProfile?.id),
    request: { bypassCache: true },
    staleTime: 30_000,
  });
  const orderList = ordersQuery.data || [];
  const invoiceFilters = useMemo(() => {
    if (sessionRole !== "outlet") {
      return undefined;
    }
    const outletId = currentOutlet?.id || currentOutletRef.current?.id || null;
    return outletId ? { outletId } : undefined;
  }, [currentOutlet?.id, sessionRole]);
  const invoicesQuery = invoicesHooks.useList(invoiceFilters, {
    enabled: isAuthenticated && Boolean(activeBusinessProfile?.id),
    request: { bypassCache: true },
    staleTime: 30_000,
  });
  const invoiceList = invoicesQuery.data || [];
  const waybillsQuery = waybillsHooks.useList(undefined, {
    enabled: isAuthenticated && Boolean(activeBusinessProfile?.id) && sessionRole !== "outlet",
    request: { bypassCache: true },
    staleTime: 30_000,
  });
  const waybillList = waybillsQuery.data || [];
  const inventoryQuery = inventoryHooks.useList(undefined, {
    enabled: isAuthenticated && Boolean(activeBusinessProfile?.id),
    request: { bypassCache: true },
    staleTime: 30_000,
  });
  const inventoryList = inventoryQuery.data || [];
  const damagedInventoryQuery = inventoryHooks.useDamaged(undefined, {
    enabled: isAuthenticated && Boolean(activeBusinessProfile?.id),
    request: { bypassCache: true },
    staleTime: 30_000,
  });
  const damagedInventoryList = damagedInventoryQuery.data || [];
  const supplierReturnsQuery = inventoryHooks.useSupplierReturns(undefined, {
    enabled: isAuthenticated && Boolean(activeBusinessProfile?.id),
    request: { bypassCache: true },
    staleTime: 30_000,
  });
  const supplierReturnList = supplierReturnsQuery.data || [];
  const suppliersQuery = suppliersHooks.useList(undefined, {
    enabled: isAuthenticated && Boolean(activeBusinessProfile?.id),
    request: { bypassCache: true },
    staleTime: 60_000,
  });
  const supplierList = suppliersQuery.data || [];
  const filesQuery = filesHooks.useList({
    enabled: isAuthenticated && Boolean(activeBusinessProfile?.id),
    request: { bypassCache: true },
    staleTime: 60_000,
  });
  const uploadedFileList = filesQuery.data || [];
  const productsQuery = productsHooks.useList(undefined, {
    enabled: isAuthenticated,
    staleTime: 15_000,
  });
  const productList = productsQuery.data || products;
  const createProductMutation = productsHooks.useCreate({
    onSuccess: (createdProduct) => {
      if (createdProduct?.id) {
        queryClient.setQueriesData({ queryKey: productsKeys.root }, (current) => {
          if (!Array.isArray(current)) return current;
          if (current.some((product) => String(product.id) === String(createdProduct.id))) {
            return current.map((product) => (String(product.id) === String(createdProduct.id) ? createdProduct : product));
          }
          return [createdProduct, ...current];
        });
        setProducts((current) => {
          if (current.some((product) => String(product.id) === String(createdProduct.id))) {
            return current.map((product) => (String(product.id) === String(createdProduct.id) ? createdProduct : product));
          }
          return [createdProduct, ...current];
        });
      }
    },
  });
  const updateProductMutation = productsHooks.useUpdate({
    onSuccess: (updatedProduct) => {
      if (updatedProduct?.id) {
        queryClient.setQueriesData({ queryKey: productsKeys.root }, (current) => {
          if (!Array.isArray(current)) return current;
          return current.map((product) => (String(product.id) === String(updatedProduct.id) ? updatedProduct : product));
        });
        setProducts((current) =>
          current.map((product) => (String(product.id) === String(updatedProduct.id) ? updatedProduct : product))
        );
      }
    },
  });
  const deleteProductMutation = productsHooks.useRemove();
  const syncOrderCache = useCallback(
    (serverOrder) => {
      if (!serverOrder?.id) {
        return;
      }
      queryClient.setQueriesData({ queryKey: ordersKeys.root }, (current) => {
        if (!Array.isArray(current)) return current;
        if (current.some((order) => String(order.id) === String(serverOrder.id))) {
          return current.map((order) => (String(order.id) === String(serverOrder.id) ? serverOrder : order));
        }
        return [serverOrder, ...current];
      });
    },
    [queryClient]
  );
  const removeOrderFromCache = useCallback(
    (_result, variables) => {
      const orderId = variables?.id ?? variables;
      queryClient.setQueriesData({ queryKey: ordersKeys.root }, (current) => {
        if (!Array.isArray(current)) return current;
        return current.filter((order) => String(order.id) !== String(orderId));
      });
    },
    [queryClient]
  );
  const createOrderMutation = ordersHooks.useCreate({
    onSuccess: syncOrderCache,
  });
  const updateOrderMutation = ordersHooks.useUpdate({
    onSuccess: syncOrderCache,
  });
  const deleteOrderMutation = ordersHooks.useRemove({
    onSuccess: removeOrderFromCache,
  });
  const syncInvoiceCache = useCallback(
    (serverInvoice) => {
      if (!serverInvoice?.id) {
        return;
      }
      queryClient.setQueriesData({ queryKey: invoicesKeys.root }, (current) => {
        if (!Array.isArray(current)) return current;
        if (current.some((invoice) => String(invoice.id) === String(serverInvoice.id))) {
          return current.map((invoice) => (String(invoice.id) === String(serverInvoice.id) ? serverInvoice : invoice));
        }
        return [serverInvoice, ...current];
      });
    },
    [queryClient]
  );
  const removeInvoiceFromCache = useCallback(
    (_result, variables) => {
      const invoiceId = variables?.id ?? variables;
      queryClient.setQueriesData({ queryKey: invoicesKeys.root }, (current) => {
        if (!Array.isArray(current)) return current;
        return current.filter((invoice) => String(invoice.id) !== String(invoiceId));
      });
    },
    [queryClient]
  );
  const generateInvoiceMutation = invoicesHooks.useGenerate({
    onSuccess: syncInvoiceCache,
  });
  const deleteInvoiceMutation = invoicesHooks.useRemove({
    onSuccess: removeInvoiceFromCache,
  });
  const reverseInvoiceMutation = invoicesHooks.useReverse({
    onSuccess: syncInvoiceCache,
  });
  const approveReverseInvoiceMutation = invoicesHooks.useApproveReverse({
    onSuccess: syncInvoiceCache,
  });
  const createInvoicePaymentMutation = invoicesHooks.useCreatePayment({
    onSuccess: (result, variables) => {
      const summary = result?.summary;
      if (!summary || !variables?.id) {
        return;
      }
      queryClient.setQueriesData({ queryKey: invoicesKeys.root }, (current) => {
        if (!Array.isArray(current)) return current;
        return current.map((invoice) =>
          String(invoice.id) === String(variables.id) ? { ...invoice, ...summary } : invoice
        );
      });
    },
  });
  const reverseInvoicePaymentMutation = invoicesHooks.useReversePayment();
  const createSupplierReturnMutation = inventoryHooks.useCreateSupplierReturn();
  const dispatchSupplierReturnMutation = inventoryHooks.useDispatchSupplierReturn();
  const resendSupplierReturnNotificationMutation = inventoryHooks.useResendSupplierReturnNotification();
  const syncSupplierCache = useCallback(
    (serverSupplier) => {
      if (!serverSupplier?.id) {
        return;
      }
      queryClient.setQueriesData({ queryKey: suppliersKeys.root }, (current) => {
        if (!Array.isArray(current)) return current;
        if (current.some((supplier) => String(supplier.id) === String(serverSupplier.id))) {
          return current.map((supplier) =>
            String(supplier.id) === String(serverSupplier.id) ? serverSupplier : supplier
          );
        }
        return [serverSupplier, ...current];
      });
    },
    [queryClient]
  );
  const createSupplierMutation = suppliersHooks.useCreate({
    onSuccess: syncSupplierCache,
  });
  const updateSupplierMutation = suppliersHooks.useUpdate({
    onSuccess: syncSupplierCache,
  });
  const syncFileCache = useCallback(
    (serverFile) => {
      if (!serverFile?.id) {
        return;
      }
      queryClient.setQueriesData({ queryKey: filesKeys.root }, (current) => {
        if (!Array.isArray(current)) return current;
        if (current.some((file) => String(file.id) === String(serverFile.id))) {
          return current.map((file) => (String(file.id) === String(serverFile.id) ? serverFile : file));
        }
        return [serverFile, ...current];
      });
    },
    [queryClient]
  );
  const removeFileFromCache = useCallback(
    (_result, variables) => {
      const fileId = variables?.id ?? variables;
      queryClient.setQueriesData({ queryKey: filesKeys.root }, (current) => {
        if (!Array.isArray(current)) return current;
        return current.filter((file) => String(file.id) !== String(fileId));
      });
    },
    [queryClient]
  );
  const uploadFileMutation = filesHooks.useUpload({
    onSuccess: syncFileCache,
  });
  const submitFileProductsMutation = filesHooks.useSubmitProducts();
  const deleteFileMutation = filesHooks.useRemove({
    onSuccess: removeFileFromCache,
  });
  const syncWaybillCache = useCallback(
    (serverWaybill) => {
      if (!serverWaybill?.id) {
        return;
      }
      queryClient.setQueriesData({ queryKey: waybillsKeys.root }, (current) => {
        if (!Array.isArray(current)) return current;
        return current.map((waybill) => (String(waybill.id) === String(serverWaybill.id) ? serverWaybill : waybill));
      });
    },
    [queryClient]
  );
  const removeWaybillFromCache = useCallback(
    (_result, variables) => {
      const waybillId = variables?.id ?? variables;
      queryClient.setQueriesData({ queryKey: waybillsKeys.root }, (current) => {
        if (!Array.isArray(current)) return current;
        return current.filter((waybill) => String(waybill.id) !== String(waybillId));
      });
    },
    [queryClient]
  );
  const updateWaybillMutation = waybillsHooks.useUpdate({
    onSuccess: syncWaybillCache,
  });
  const deleteWaybillMutation = waybillsHooks.useRemove({
    onSuccess: removeWaybillFromCache,
  });
  const syncBusinessProfileCache = useCallback(
    (serverProfile) => {
      if (!serverProfile?.id) {
        return;
      }
      queryClient.setQueriesData({ queryKey: businessKeys.root }, (current) => serverProfile || current);
      setBusinessProfile(serverProfile);
    },
    [queryClient]
  );
  const syncOutletCache = useCallback(
    (serverOutlet) => {
      if (!serverOutlet?.id) {
        return;
      }
      queryClient.setQueriesData({ queryKey: outletsKeys.root }, (current) => {
        if (!Array.isArray(current)) return current;
        if (current.some((outlet) => String(outlet.id) === String(serverOutlet.id))) {
          return current.map((outlet) => (String(outlet.id) === String(serverOutlet.id) ? serverOutlet : outlet));
        }
        return [serverOutlet, ...current];
      });
    },
    [queryClient]
  );
  const removeOutletFromCache = useCallback(
    (_result, variables) => {
      const outletId = variables?.outletId;
      queryClient.setQueriesData({ queryKey: outletsKeys.root }, (current) => {
        if (!Array.isArray(current)) return current;
        return current.filter((outlet) => String(outlet.id) !== String(outletId));
      });
    },
    [queryClient]
  );
  const saveBusinessProfileMutation = businessHooks.useSaveProfile({
    onSuccess: syncBusinessProfileCache,
  });
  const uploadBusinessLogoMutation = businessHooks.useUploadLogo({
    onSuccess: syncBusinessProfileCache,
  });
  const createOutletMutation = businessHooks.useCreateOutlet({
    onSuccess: syncOutletCache,
  });
  const updateOutletMutation = businessHooks.useUpdateOutlet({
    onSuccess: syncOutletCache,
  });
  const deleteOutletMutation = businessHooks.useDeleteOutlet({
    onSuccess: removeOutletFromCache,
  });

  useEffect(() => {
    installWebControlFocusStyles();
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") {
      return;
    }
    try {
      const savedSession = window.localStorage?.getItem(WEB_SESSION_KEY);
      if (!savedSession) {
        return;
      }
      const parsedSession = JSON.parse(savedSession);
      api.setActiveBusinessProfileId(parsedSession.businessProfile?.id);
      api.setActiveAccessToken(parsedSession.accessToken);
      setAccessToken(parsedSession.accessToken || null);
      setBusinessProfile(parsedSession.businessProfile || null);
      setSessionRole(parsedSession.role || "admin");
      setCurrentOutlet(parsedSession.outlet || null);
      currentOutletRef.current = parsedSession.outlet || null;
      setActiveTab(parsedSession.activeTab || (parsedSession.role === "outlet" ? "business" : "dashboard"));
      setIsAuthenticated(true);
    } catch {
      window.localStorage?.removeItem(WEB_SESSION_KEY);
    }
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web" || !isAuthenticated) {
      return;
    }
    window.localStorage?.setItem(
      WEB_SESSION_KEY,
      JSON.stringify({
        activeTab,
        accessToken,
        businessProfile: activeBusinessProfile,
        outlet: currentOutlet,
        role: sessionRole,
      })
    );
  }, [accessToken, activeBusinessProfile, activeTab, currentOutlet, isAuthenticated, sessionRole]);

  useEffect(() => {
    if (!businessProfileQuery.data?.id) {
      return;
    }
    setBusinessProfile(businessProfileQuery.data);
    api.setActiveBusinessProfileId(businessProfileQuery.data.id);
    hasLoadedDataRef.current = true;
    setStartupError("");
  }, [businessProfileQuery.data]);

  useEffect(() => {
    if (!isAuthenticated || !businessProfileQuery.isError) {
      return;
    }
    setStartupError("ERP services are not ready yet. Check the backend connection and try again.");
  }, [businessProfileQuery.isError, isAuthenticated]);

  useEffect(() => {
    currentOutletRef.current = currentOutlet;
  }, [currentOutlet]);

  useEffect(() => {
    if (!isAuthenticated || sessionRole !== "outlet") {
      return;
    }
    const selectedOutlet = currentOutletRef.current
      ? outletList.find((item) => item.id === currentOutletRef.current.id) || null
      : outletList[0] || null;
    if (selectedOutlet && selectedOutlet.id !== currentOutletRef.current?.id) {
      setCurrentOutlet(selectedOutlet);
    }
    if (!selectedOutlet && currentOutletRef.current) {
      setCurrentOutlet(null);
    }
  }, [isAuthenticated, outletList, sessionRole]);

  useEffect(() => {
    setLogoLoadFailed(false);
  }, [
    activeBusinessProfile?.id,
    activeBusinessProfile?.logoUrl,
    activeBusinessProfile?.logo_url,
    activeBusinessProfile?.updatedAt,
    activeBusinessProfile?.updated_at,
  ]);

  useEffect(() => {
    if (!error) {
      return undefined;
    }
    const timer = setTimeout(() => setError(""), 5000);
    return () => clearTimeout(timer);
  }, [error]);

  useEffect(() => {
    if (Platform.OS !== "web" || !isAuthenticated) {
      return undefined;
    }

    const handleDataChanged = (event) => {
      const domains = Array.isArray(event?.detail?.domains) ? event.detail.domains : [];
      const changedPath = String(event?.detail?.path || "");
      if (changedPath.startsWith("/orders")) {
        queryClient.invalidateQueries({ queryKey: ordersKeys.root });
        queryClient.invalidateQueries({ queryKey: customersKeys.root });
        queryClient.invalidateQueries({ queryKey: dashboardKeys.root });
        queryClient.invalidateQueries({ queryKey: inventoryKeys.root });
        queryClient.invalidateQueries({ queryKey: productsKeys.root });
        queryClient.invalidateQueries({ queryKey: reportsKeys.root });
        return;
      }
      if (changedPath.startsWith("/invoices") || changedPath.startsWith("/payments")) {
        queryClient.invalidateQueries({ queryKey: invoicesKeys.root });
        queryClient.invalidateQueries({ queryKey: ordersKeys.root });
        queryClient.invalidateQueries({ queryKey: customersKeys.root });
        queryClient.invalidateQueries({ queryKey: dashboardKeys.root });
        queryClient.invalidateQueries({ queryKey: paymentsKeys.root });
        queryClient.invalidateQueries({ queryKey: inventoryKeys.root });
        queryClient.invalidateQueries({ queryKey: productsKeys.root });
        queryClient.invalidateQueries({ queryKey: waybillsKeys.root });
        queryClient.invalidateQueries({ queryKey: reportsKeys.root });
        return;
      }
      if (changedPath.startsWith("/supplier-returns")) {
        queryClient.invalidateQueries({ queryKey: inventoryKeys.root });
        queryClient.invalidateQueries({ queryKey: productsKeys.root });
        queryClient.invalidateQueries({ queryKey: dashboardKeys.root });
        queryClient.invalidateQueries({ queryKey: reportsKeys.root });
        return;
      }
      if (changedPath.startsWith("/products")) {
        // Product writes already update the product cache optimistically in
        // their mutation handlers. Keep the server validation focused on the
        // views whose calculations genuinely depend on product data.
        queryClient.invalidateQueries({ queryKey: productsKeys.root });
        queryClient.invalidateQueries({ queryKey: inventoryKeys.root });
        queryClient.invalidateQueries({ queryKey: dashboardKeys.root });
        queryClient.invalidateQueries({ queryKey: reportsKeys.root });
        return;
      }
      if (changedPath.startsWith("/suppliers")) {
        queryClient.invalidateQueries({ queryKey: suppliersKeys.root });
        return;
      }
      if (changedPath.startsWith("/files")) {
        queryClient.invalidateQueries({ queryKey: filesKeys.root });
        queryClient.invalidateQueries({ queryKey: productsKeys.root });
        queryClient.invalidateQueries({ queryKey: inventoryKeys.root });
        queryClient.invalidateQueries({ queryKey: suppliersKeys.root });
        queryClient.invalidateQueries({ queryKey: dashboardKeys.root });
        queryClient.invalidateQueries({ queryKey: reportsKeys.root });
        return;
      }
      if (changedPath.startsWith("/waybills")) {
        queryClient.invalidateQueries({ queryKey: waybillsKeys.root });
        queryClient.invalidateQueries({ queryKey: dashboardKeys.root });
        queryClient.invalidateQueries({ queryKey: reportsKeys.root });
        return;
      }
      if (changedPath.startsWith("/business-profile")) {
        queryClient.invalidateQueries({ queryKey: businessKeys.root });
        queryClient.invalidateQueries({ queryKey: outletsKeys.root });
        queryClient.invalidateQueries({ queryKey: dashboardKeys.root });
        queryClient.invalidateQueries({ queryKey: reportsKeys.root });
        return;
      }
      if (domains.includes("dashboard")) {
        queryClient.invalidateQueries({ queryKey: dashboardKeys.root });
      }
      queryClient.invalidateQueries({ queryKey: ["erp"] });
    };

    window.addEventListener("erp:data-changed", handleDataChanged);
    return () => {
      window.removeEventListener("erp:data-changed", handleDataChanged);
    };
  }, [isAuthenticated, queryClient]);

  const handleGenerateInvoiceFromOrder = async (payload, requestKey = null) => {
    setError("");
    try {
      const invoice = await generateInvoiceMutation.mutateAsync({
        payload,
        idempotencyKey: requestKey || createRequestKey("invoice"),
      });
      setActiveTab("invoices");
      return invoice;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const handleDeleteInvoice = async (id) => {
    setError("");
    try {
      return await deleteInvoiceMutation.mutateAsync({ id });
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const handleReverseInvoice = async (id, payload) => {
    setError("");
    try {
      return await reverseInvoiceMutation.mutateAsync({ id, payload });
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const handleApproveReverseInvoice = async (id) => {
    setError("");
    try {
      return await approveReverseInvoiceMutation.mutateAsync({ id });
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const handleCreateInvoicePayment = async (id, payload, idempotencyKey) => {
    setError("");
    try {
      return await createInvoicePaymentMutation.mutateAsync({ id, payload, idempotencyKey });
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const handleReverseInvoicePayment = async (id, idempotencyKey) => {
    setError("");
    try {
      return await reverseInvoicePaymentMutation.mutateAsync({ id, idempotencyKey });
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const handleResendInvoiceNotification = async (id, channel) => {
    setError("");
    try {
      return await api.resendInvoiceNotification(id, channel);
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const handleCreateSupplierReturn = async (payload) => {
    setError("");
    try {
      return await createSupplierReturnMutation.mutateAsync({ payload });
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const handleDispatchSupplierReturn = async (id, payload) => {
    setError("");
    try {
      return await dispatchSupplierReturnMutation.mutateAsync({ id, payload });
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const handleResendSupplierReturnNotification = async (id, phase, channel) => {
    setError("");
    try {
      return await resendSupplierReturnNotificationMutation.mutateAsync({ id, phase, channel });
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const handleCreateSupplier = async (payload) => {
    setError("");
    try {
      return await createSupplierMutation.mutateAsync({ payload });
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const handleUpdateSupplier = async (id, payload) => {
    setError("");
    try {
      return await updateSupplierMutation.mutateAsync({ id, payload });
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const handleUploadFile = async (file) => {
    setError("");
    try {
      return await uploadFileMutation.mutateAsync({ file });
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const handleSubmitFileProducts = async (id, rows, idempotencyKey) => {
    setError("");
    try {
      return await submitFileProductsMutation.mutateAsync({ id, rows, idempotencyKey });
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const handleDeleteFile = async (id) => {
    setError("");
    try {
      return await deleteFileMutation.mutateAsync({ id });
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const handleUpdateWaybill = async (id, payload) => {
    setError("");
    try {
      return await updateWaybillMutation.mutateAsync({ id, payload });
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const handleDeleteWaybill = async (id) => {
    setError("");
    try {
      return await deleteWaybillMutation.mutateAsync({ id });
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const handleCreateOrder = async (payload, idempotencyKey) => {
    setError("");
    try {
      return await createOrderMutation.mutateAsync({ payload, idempotencyKey });
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const handleUpdateOrder = async (id, payload) => {
    setError("");
    try {
      return await updateOrderMutation.mutateAsync({ id, payload });
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const handleDeleteOrder = async (id) => {
    setError("");
    try {
      return await deleteOrderMutation.mutateAsync({ id });
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const handleCreateProduct = async (payload, idempotencyKey) => {
    setError("");
    try {
      return await createProductMutation.mutateAsync({ payload, idempotencyKey });
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const handleUpdateProduct = async (id, payload) => {
    setError("");
    try {
      return await updateProductMutation.mutateAsync({ id, payload });
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const handleDeleteProduct = async (id) => {
    setError("");
    try {
      const result = await deleteProductMutation.mutateAsync({ id });
      queryClient.setQueriesData({ queryKey: productsKeys.root }, (current) => {
        if (!Array.isArray(current)) return current;
        return current.filter((product) => String(product.id) !== String(id));
      });
      setProducts((current) => current.filter((product) => String(product.id) !== String(id)));
      return result;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const handleOpenInventory = useCallback((navigation = {}) => {
    setInventoryNavigation({
      ...navigation,
      key: Date.now(),
    });
    setActiveTab("inventory");
  }, []);

  const handleOpenPurchaseOrders = useCallback((product = null) => {
    setOrdersNavigation({
      openCreateForm: true,
      product,
      type: "purchase",
      key: Date.now(),
    });
    setActiveTab("orders");
  }, []);

  const handleOpenProductRestock = useCallback((product) => {
    setProductsNavigation({
      mode: "restock",
      productId: product?.id || null,
      key: Date.now(),
    });
    setActiveTab("products");
  }, []);

  const handleProductsNavigationHandled = useCallback((key) => {
    setProductsNavigation((current) => (current?.key === key ? null : current));
  }, []);

  const handleOpenDashboardTarget = useCallback((tab) => {
    setActiveTab(tab);
  }, []);

  const handleSaveBusinessProfile = async (payload) => {
    setError("");
    try {
      return await saveBusinessProfileMutation.mutateAsync({ payload });
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const handleUploadLogo = async (profileId, logoAsset) => {
    setError("");
    try {
      const uploadedProfile = await uploadBusinessLogoMutation.mutateAsync({ profileId, logoAsset });
      if (uploadedProfile?.id) {
        setBusinessProfile(uploadedProfile);
        if (Platform.OS === "web") {
          window.localStorage?.setItem(
            WEB_SESSION_KEY,
            JSON.stringify({
              activeTab,
              accessToken,
              businessProfile: uploadedProfile,
              outlet: currentOutlet,
              role: sessionRole,
            })
          );
        }
      }
      setLogoLoadFailed(false);
      return uploadedProfile;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const handleCreateOutlet = async (profileId, payload) => {
    setError("");
    try {
      return await createOutletMutation.mutateAsync({ profileId, payload });
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const handleUpdateOutlet = async (profileId, outletId, payload) => {
    setError("");
    try {
      return await updateOutletMutation.mutateAsync({ profileId, outletId, payload });
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const handleDeleteOutlet = async (profileId, outletId) => {
    setError("");
    try {
      return await deleteOutletMutation.mutateAsync({ profileId, outletId });
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const handleCreatePosStaff = async (profileId, payload) => {
    setError("");
    try {
      const staff = await api.createPosStaff(profileId, payload);
      setPosStaff((current) => [...current, staff].sort((a, b) => a.fullName.localeCompare(b.fullName)));
      return staff;
    } catch (err) {
      setError(err.message);
      throw err;
    }
  };

  const handleLogin = async (credentials) => {
    setError("");
    setIsLoading(true);
    try {
      const result = await api.login(credentials);
      api.setActiveBusinessProfileId(result.businessProfile?.id);
      api.setActiveAccessToken(result.accessToken);
      setAccessToken(result.accessToken || null);
      setBusinessProfile(result.businessProfile);
      setSessionRole(result.role || "admin");
      setCurrentOutlet(result.outlet || null);
      setActiveTab(result.role === "outlet" ? "business" : "dashboard");
      setIsAuthenticated(true);
      if (Platform.OS === "web") {
        window.localStorage?.setItem(
          WEB_SESSION_KEY,
          JSON.stringify({
            activeTab: result.role === "outlet" ? "business" : "dashboard",
            accessToken: result.accessToken,
            businessProfile: result.businessProfile,
            outlet: result.outlet || null,
            role: result.role || "admin",
          })
        );
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setIsLoading(false);
      setIsActionLocked(false);
    }
  };

  const handleLogout = () => {
    api.setActiveBusinessProfileId(null);
    api.setActiveAccessToken(null);
    setIsAuthenticated(false);
    setAccessToken(null);
    setActiveTab("dashboard");
    setBusinessProfile(null);
    setProducts([]);
    setCurrentOutlet(null);
    setSessionRole("admin");
    setIsActionLocked(false);
    setIsLoading(false);
    setStartupError("");
    setInventoryNavigation(null);
    setOrdersNavigation(null);
    setProductsNavigation(null);
    hasLoadedDataRef.current = false;
    setError("");
    if (Platform.OS === "web") {
      window.localStorage?.removeItem(WEB_SESSION_KEY);
    }
  };

  const retryInitialLoad = () => {
    setStartupError("");
    queryClient.invalidateQueries({ queryKey: businessKeys.root });
    businessProfileQuery.refetch();
  };

  useEffect(() => {
    if (Platform.OS !== "web") {
      return undefined;
    }
    const handleUnauthorized = () => handleLogout();
    window.addEventListener("erp:unauthorized", handleUnauthorized);
    return () => window.removeEventListener("erp:unauthorized", handleUnauthorized);
  }, []);

  const isRegisterRoute =
    Platform.OS === "web" && typeof window !== "undefined" && window.location.pathname === "/register";

  if (isRegisterRoute || showRegister) {
    return (
      <SafeAreaView style={styles.authShell}>
        <StatusBar barStyle="light-content" backgroundColor={colors.primaryDark} />
        <RegisterScreen
          onBackToLogin={showRegister ? () => setShowRegister(false) : undefined}
          onRegister={async (payload, logoAsset) => {
            const profile = await api.registerAdmin(payload);
            if (!logoAsset) {
              return profile;
            }
            // Registration is already committed at this point. Authenticate
            // only for the optional protected logo upload, and never make a
            // successful company creation appear to have failed because that
            // secondary step has a problem.
            try {
              await api.login({ email: payload.email, password: payload.password });
              return await api.uploadBusinessLogo(profile.id, logoAsset);
            } catch {
              return {
                ...profile,
                logoUploadWarning: "The admin was created, but the logo could not be uploaded. Sign in and upload it from the Business Profile screen.",
              };
            }
          }}
        />
      </SafeAreaView>
    );
  }

  if (!isAuthenticated) {
    return (
      <SafeAreaView style={styles.authShell}>
        <StatusBar barStyle="light-content" backgroundColor={colors.primaryDark} />
        <LoginScreen
          error={error}
          isLoading={isLoading}
          onContinue={handleLogin}
          onOpenRegister={() => setShowRegister(true)}
        />
      </SafeAreaView>
    );
  }

  const isProductActionLocked =
    createProductMutation.isPending || updateProductMutation.isPending || deleteProductMutation.isPending;
  const isOrderActionLocked =
    createOrderMutation.isPending || updateOrderMutation.isPending || deleteOrderMutation.isPending;
  const isInvoiceActionLocked =
    generateInvoiceMutation.isPending ||
    deleteInvoiceMutation.isPending ||
    reverseInvoiceMutation.isPending ||
    approveReverseInvoiceMutation.isPending ||
    createInvoicePaymentMutation.isPending ||
    reverseInvoicePaymentMutation.isPending;
  const isInventoryActionLocked =
    createSupplierReturnMutation.isPending ||
    dispatchSupplierReturnMutation.isPending ||
    resendSupplierReturnNotificationMutation.isPending;
  const isSupplierActionLocked = createSupplierMutation.isPending || updateSupplierMutation.isPending;
  const isFileActionLocked =
    uploadFileMutation.isPending || submitFileProductsMutation.isPending || deleteFileMutation.isPending;
  const isWaybillActionLocked = updateWaybillMutation.isPending || deleteWaybillMutation.isPending;
  const isBusinessActionLocked =
    saveBusinessProfileMutation.isPending ||
    uploadBusinessLogoMutation.isPending ||
    createOutletMutation.isPending ||
    updateOutletMutation.isPending ||
    deleteOutletMutation.isPending;
  const screenProps = {
    businessProfile: activeBusinessProfile,
    dashboardSummary,
    dashboardRange,
    dashboardRangeOptions,
    dashboardScopeLabel,
    invoices: invoiceList,
    inventoryValueTimeline,
    inventoryValueReport,
    outlets: outletList,
    orders: orderList,
    products: productList,
    damagedInventory: damagedInventoryList,
    supplierReturns: supplierReturnList,
    suppliers: supplierList,
    waybills: waybillList,
    uploadedFiles: uploadedFileList,
    currentOutlet,
    onDashboardRangeChange: setDashboardRange,
    sessionRole,
  };
  const visibleTabs = sessionRole === "outlet" ? outletTabs : tabs;
  const activeLogoSource = logoLoadFailed ? null : logoSourceFor(activeBusinessProfile);
  const activeLogoText = activeBusinessProfile?.logoText || activeBusinessProfile?.tradeName?.slice(0, 3) || "ERP";

  return (
    <SafeAreaView style={styles.shell}>
      <StatusBar barStyle="dark-content" backgroundColor={colors.background} />
      {isActionLocked && (
        <View style={[styles.actionShield, { pointerEvents: "auto" }]}>
          <View style={styles.actionOverlay}>
            <ActivityIndicator color={colors.primary} size="large" />
            <Text style={styles.actionOverlayText}>Working...</Text>
          </View>
        </View>
      )}

      <View style={styles.appFrame}>
        <View style={styles.sidebar}>
          <View style={styles.sidebarTop}>
            <View style={styles.sidebarBrand}>
              <View style={styles.companyAvatar}>
                {activeLogoSource ? (
                  <Image
                    source={activeLogoSource}
                    style={styles.companyAvatarImage}
                    resizeMode="contain"
                    onError={() => setLogoLoadFailed(true)}
                  />
                ) : (
                  <Text style={styles.companyAvatarText}>{activeLogoText}</Text>
                )}
              </View>
              <View style={styles.companyTextWrap}>
                <Text style={styles.companyName} numberOfLines={1}>
                  {sessionRole === "outlet"
                    ? currentOutlet?.tradeName || currentOutlet?.name || "Outlet Workspace"
                    : activeBusinessProfile?.tradeName || "ERP Workspace"}
                </Text>
                <Text style={styles.companyMeta}>
                  {sessionRole === "outlet" ? currentOutlet?.outletCode || "Outlet login" : "Admin workspace"}
                </Text>
              </View>
            </View>

            <ScrollView
              showsVerticalScrollIndicator={false}
              style={styles.sidebarNavScroll}
              contentContainerStyle={styles.sidebarNav}
            >
              {visibleTabs.map((tab) => {
                const isActive = activeTab === tab.key;
                return (
                  <SidebarNavItem
                    key={tab.key}
                    tab={tab}
                    isActive={isActive}
                    onPress={() => setActiveTab(tab.key)}
                  />
                );
              })}
            </ScrollView>
          </View>

          <TouchableOpacity activeOpacity={0.85} onPress={handleLogout} disabled={isActionLocked} style={styles.logoutButton}>
            <Text style={styles.logoutText}>Logout</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.mainPane}>
          {!!error && (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          {isLoading ? (
            <View style={styles.loader}>
              <ActivityIndicator color={colors.primary} size="large" />
              <Text style={styles.loaderText}>
                {startupError || "Loading ERP data..."}
              </Text>
            </View>
          ) : startupError && !hasLoadedDataRef.current ? (
            <View style={styles.connectionCard}>
              <Text style={styles.connectionTitle}>ERP service is unavailable</Text>
              <Text style={styles.connectionCopy}>{startupError}</Text>
              <TouchableOpacity activeOpacity={0.85} onPress={retryInitialLoad} style={styles.retryButton}>
                <Text style={styles.retryButtonText}>Retry connection</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.content}>
              {activeTab === "dashboard" && (
                <DashboardScreen
                  {...screenProps}
                  onOpenInventory={handleOpenInventory}
                  onOpenScreen={handleOpenDashboardTarget}
                />
              )}
              {activeTab === "products" && (
                <ProductsScreen
                  products={productList}
                  isBusy={isActionLocked || isProductActionLocked}
                  navigationIntent={productsNavigation}
                  onCreateProduct={handleCreateProduct}
                  onDeleteProduct={handleDeleteProduct}
                  onNavigationIntentHandled={handleProductsNavigationHandled}
                  onUpdateProduct={handleUpdateProduct}
                />
              )}
              {activeTab === "inventory" && (
                <InventoryScreen
                  products={inventoryList}
                  damagedInventory={damagedInventoryList}
                  supplierReturns={supplierReturnList}
                  suppliers={supplierList}
                  inventoryValueTimeline={inventoryValueTimeline}
                  inventoryValueReport={inventoryValueReport}
                  databaseInventoryValue={dashboardSummary.inventoryValue}
                  inventoryValueRange={dashboardRange}
                  inventoryValueRangeOptions={dashboardRangeOptions}
                  onInventoryValueRangeChange={setDashboardRange}
                  navigationIntent={inventoryNavigation}
                  isBusy={
                    isActionLocked ||
                    isInventoryActionLocked ||
                    isSupplierActionLocked ||
                    inventoryQuery.isFetching ||
                    damagedInventoryQuery.isFetching ||
                    supplierReturnsQuery.isFetching ||
                    suppliersQuery.isFetching
                  }
                  onOpenPurchaseOrders={handleOpenPurchaseOrders}
                  onRestockProduct={handleOpenProductRestock}
                  onCreateSupplierReturn={handleCreateSupplierReturn}
                  onDispatchSupplierReturn={handleDispatchSupplierReturn}
                  onResendSupplierReturnNotification={handleResendSupplierReturnNotification}
                  onDownloadSupplierReturnPdf={(id) => api.downloadSupplierReturnPdf(id)}
                />
              )}
              {activeTab === "discounts" && (
                <DiscountsScreen products={productList} isBusy={isActionLocked} />
              )}
              {activeTab === "orders" && (
                <OrdersScreen
                  orders={orderList}
                  products={productList}
                  activeOutlet={currentOutlet}
                  businessProfile={activeBusinessProfile}
                  isBusy={
                    isActionLocked ||
                    isOrderActionLocked ||
                    isSupplierActionLocked ||
                    ordersQuery.isFetching ||
                    suppliersQuery.isFetching
                  }
                  navigationIntent={ordersNavigation}
                  outlets={outletList}
                  sessionRole={sessionRole}
                  suppliers={supplierList}
                  onCreateSupplier={handleCreateSupplier}
                  onCreateOrder={handleCreateOrder}
                  onDeleteOrder={handleDeleteOrder}
                  onGenerateInvoice={handleGenerateInvoiceFromOrder}
                  onUpdateSupplier={handleUpdateSupplier}
                  onUpdateOrder={handleUpdateOrder}
                />
              )}
              {activeTab === "recentSales" && (
                <RecentSalesScreen
                  currentOutlet={currentOutlet}
                  orders={orderList}
                  sessionRole={sessionRole}
                />
              )}
              {activeTab === "outlets" && (
                <BusinessProfileScreen
                  businessProfile={activeBusinessProfile}
                  outlets={outletList}
                  isBusy={isActionLocked || isBusinessActionLocked || businessProfileQuery.isFetching || outletsQuery.isFetching}
                  viewMode="outlets"
                  onCreateOutlet={handleCreateOutlet}
                  onDeleteOutlet={handleDeleteOutlet}
                  onUpdateOutlet={handleUpdateOutlet}
                  onSave={handleSaveBusinessProfile}
                  onUploadLogo={handleUploadLogo}
                  posStaff={posStaff}
                  onCreatePosStaff={handleCreatePosStaff}
                />
              )}
              {activeTab === "customers" && (
                <CustomersScreen
                  businessProfile={activeBusinessProfile}
                  outlets={outletList}
                  activeOutlet={currentOutlet}
                  sessionRole={sessionRole}
                />
              )}
              {activeTab === "invoices" && (
                <InvoicesScreen
                  businessProfile={activeBusinessProfile}
                  currentOutlet={currentOutlet}
                  invoices={invoiceList}
                  orders={orderList}
                  isBusy={isActionLocked || isInvoiceActionLocked || invoicesQuery.isFetching}
                  sessionRole={sessionRole}
                  onDeleteInvoice={handleDeleteInvoice}
                  onDownloadInvoicePdf={(id) => api.downloadInvoicePdf(id)}
                  onGetInvoiceNotifications={(id) => api.getInvoiceNotifications(id)}
                  onResendInvoiceNotification={handleResendInvoiceNotification}
                  onCreateInvoicePayment={handleCreateInvoicePayment}
                  onGetInvoicePayments={(id) => api.getInvoicePayments(id)}
                  onGetInvoicePaymentSummary={(id) => api.getInvoicePaymentSummary(id)}
                  onDownloadPaymentReceipt={(id) => api.downloadPaymentReceipt(id)}
                  onReverseInvoicePayment={handleReverseInvoicePayment}
                  onGenerateInvoice={handleGenerateInvoiceFromOrder}
                  onApproveReverseInvoice={handleApproveReverseInvoice}
                  onReverseInvoice={handleReverseInvoice}
                />
              )}
              {activeTab === "waybills" && (
                <WaybillsScreen
                  businessProfile={activeBusinessProfile}
                  isBusy={isActionLocked || isWaybillActionLocked || waybillsQuery.isFetching}
                  onDeleteWaybill={handleDeleteWaybill}
                  onUpdateWaybill={handleUpdateWaybill}
                  waybills={waybillList}
                />
              )}
              {activeTab === "reports" && (
                <ReportsScreen
                  businessProfile={activeBusinessProfile}
                  invoices={invoiceList}
                  isBusy={isActionLocked}
                  orders={orderList}
                  products={productList}
                  supplierReturns={supplierReturnList}
                  waybills={waybillList}
                  onDeleteInvoice={handleDeleteInvoice}
                  onDeleteOrder={handleDeleteOrder}
                  onDeleteWaybill={handleDeleteWaybill}
                  onDownloadSupplierReturnPdf={(id) => api.downloadSupplierReturnPdf(id)}
                />
              )}
              {activeTab === "files" && (
                <FilesScreen
                  files={uploadedFileList}
                  isBusy={isActionLocked || isFileActionLocked || filesQuery.isFetching}
                  onDeleteFile={handleDeleteFile}
                  onSubmitProducts={handleSubmitFileProducts}
                  onUploadFile={handleUploadFile}
                />
              )}
              {activeTab === "business" && (
                <BusinessProfileScreen
                  businessProfile={activeBusinessProfile}
                  outlets={outletList}
                  activeOutlet={currentOutlet}
                  isBusy={isActionLocked || isBusinessActionLocked || businessProfileQuery.isFetching || outletsQuery.isFetching}
                  sessionRole={sessionRole}
                  viewMode="business"
                  onCreateOutlet={handleCreateOutlet}
                  onDeleteOutlet={handleDeleteOutlet}
                  onUpdateOutlet={handleUpdateOutlet}
                  onSave={handleSaveBusinessProfile}
                  onUploadLogo={handleUploadLogo}
                  posStaff={posStaff}
                  onCreatePosStaff={handleCreatePosStaff}
                />
              )}
            </View>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
}

export default function App() {
  if (
    Platform.OS === "web" &&
    typeof window !== "undefined" &&
    ["/", "/landing"].includes(window.location.pathname)
  ) {
    const navigateTo = (path) => {
      // Keep the marketing page separate from the protected ERP workspace.
      // A normal navigation also makes the destination URL shareable/bookmarkable.
      window.location.assign(path);
    };

    return (
      <LandingScreen
        onLogin={() => navigateTo("/login")}
        onRegister={() => navigateTo("/register")}
      />
    );
  }
  return (
    <AppQueryProvider>
      <ModalProvider>
        <AppContent />
      </ModalProvider>
    </AppQueryProvider>
  );
}

const styles = StyleSheet.create({
  authShell: {
    flex: 1,
    backgroundColor: colors.primaryDark,
  },
  shell: {
    flex: 1,
    backgroundColor: colors.background,
  },
  appFrame: {
    flex: 1,
    flexDirection: "row",
    gap: spacing.md,
    padding: spacing.md,
  },
  sidebar: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 28,
    borderWidth: 1,
    justifyContent: "space-between",
    overflow: "hidden",
    padding: spacing.sm,
    width: 228,
    boxShadow: "0 10px 28px rgba(34, 48, 58, 0.08)",
  },
  sidebarTop: {
    flex: 1,
    minHeight: 0,
  },
  sidebarBrand: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.md,
    paddingHorizontal: spacing.xs,
    paddingTop: spacing.xs,
  },
  companyAvatar: {
    alignItems: "center",
    backgroundColor: colors.primarySoft,
    borderColor: colors.border,
    borderRadius: 16,
    borderWidth: 1,
    height: 38,
    justifyContent: "center",
    overflow: "hidden",
    width: 38,
  },
  companyAvatarImage: {
    height: 34,
    width: 34,
  },
  companyAvatarText: {
    color: colors.primary,
    fontFamily: typography.headingFont,
    fontSize: 14,
    fontWeight: "700",
  },
  companyTextWrap: {
    flex: 1,
    minWidth: 0,
  },
  companyName: {
    color: colors.ink,
    fontFamily: typography.headingFont,
    fontSize: 14,
    fontWeight: "700",
  },
  companyMeta: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 11,
    fontWeight: "700",
    marginTop: 2,
  },
  sidebarNavScroll: {
    flex: 1,
  },
  sidebarNav: {
    gap: 4,
    paddingBottom: spacing.md,
  },
  sidebarItem: {
    alignItems: "center",
    borderColor: "transparent",
    borderRadius: 14,
    borderWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    minHeight: 42,
    paddingHorizontal: spacing.xs,
    paddingRight: spacing.sm,
    position: "relative",
  },
  sidebarItemActive: {
    backgroundColor: colors.primarySoft,
  },
  sidebarActiveRail: {
    borderRadius: 999,
    height: 22,
    opacity: 0,
    width: 3,
  },
  sidebarSymbol: {
    alignItems: "center",
    borderRadius: 12,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  sidebarLabel: {
    color: colors.muted,
    flex: 1,
    fontFamily: typography.baseFont,
    fontSize: 13,
    fontWeight: "700",
  },
  logoutButton: {
    alignItems: "center",
    backgroundColor: colors.dangerSoft,
    borderColor: "#F3CBC4",
    borderRadius: 16,
    borderWidth: 1,
    justifyContent: "center",
    marginTop: spacing.sm,
    minHeight: 40,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  logoutText: {
    color: colors.danger,
    fontFamily: typography.baseFont,
    fontSize: 11,
    fontWeight: "700",
  },
  mainPane: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 28,
    borderWidth: 1,
    flex: 1,
    padding: spacing.md,
    boxShadow: `0px 10px 18px rgba(15, 23, 42, 0.08)`,
  },
  topBar: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderRadius: 20,
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: spacing.md,
    padding: spacing.md,
  },
  topBarInfo: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
  },
  topBarLogo: {
    alignItems: "center",
    borderRadius: 16,
    height: 48,
    justifyContent: "center",
    minWidth: 48,
    paddingHorizontal: spacing.sm,
  },
  topBarLogoText: {
    color: colors.white,
    fontFamily: typography.headingFont,
    fontSize: 18,
    fontWeight: "700",
  },
  pageEyebrow: {
    color: colors.primary,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: "700",
    letterSpacing: 1.2,
    textTransform: "uppercase",
  },
  pageTitle: {
    color: colors.ink,
    fontFamily: typography.headingFont,
    fontSize: typography.sizes.pageTitle,
    fontWeight: "700",
  },
  topBarBadge: {
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  topBarBadgeText: {
    color: colors.primary,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: "700",
  },
  errorBox: {
    backgroundColor: colors.dangerSoft,
    borderRadius: 14,
    marginBottom: spacing.sm,
    padding: spacing.sm,
  },
  errorText: {
    color: colors.danger,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: "700",
  },
  actionShield: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 30,
  },
  actionOverlay: {
    alignItems: "center",
    backgroundColor: "rgba(245,239,230,0.78)",
    flex: 1,
    justifyContent: "center",
    gap: spacing.sm,
  },
  actionOverlayText: {
    color: colors.ink,
    fontFamily: typography.baseFont,
    fontSize: 13,
    fontWeight: "700",
  },
  loader: {
    alignItems: "center",
    flex: 1,
    justifyContent: "center",
    gap: spacing.sm,
  },
  connectionCard: {
    alignItems: "center",
    alignSelf: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    gap: spacing.sm,
    marginTop: spacing.xl,
    maxWidth: 440,
    padding: spacing.lg,
    width: "100%",
  },
  connectionTitle: {
    color: colors.ink,
    fontFamily: typography.headingFont,
    fontSize: typography.sizes.sectionTitle,
    fontWeight: "700",
    textAlign: "center",
  },
  connectionCopy: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: typography.sizes.body,
    lineHeight: 20,
    textAlign: "center",
  },
  retryButton: {
    backgroundColor: colors.primary,
    borderRadius: 10,
    marginTop: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  retryButtonText: {
    color: colors.white,
    fontFamily: typography.baseFont,
    fontSize: typography.sizes.label,
    fontWeight: "700",
  },
  loaderText: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontWeight: "700",
  },
  content: {
    flex: 1,
  },
});
