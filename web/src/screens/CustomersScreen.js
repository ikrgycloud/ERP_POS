import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
  useWindowDimensions,
} from "react-native";
import { AdvancedFilterPanel } from "../components/AdvancedFilterPanel";
import { AppButton } from "../components/AppButton";
import { FilterChips } from "../components/FilterChips";
import { PaginationControls } from "../components/PaginationControls";
import { useModal } from "../components/ModalProvider";
import { ScreenHeader } from "../components/ScreenHeader";
import { SearchInput } from "../components/SearchInput";
import { colors, radii, responsiveCardBasis, spacing, typography } from "../constants/theme";
import { useCreateCustomer, useCustomerList, useDeleteCustomer, useUpdateCustomer } from "../features/customers/hooks";
import { formatCurrency, formatDate, formatNumber } from "../utils/formatters";
import { isValidEmail, isValidIndianMobile, isValidPincode } from "../utils/validation";

const emptyForm = {
  address: "",
  city: "",
  email: "",
  name: "",
  notes: "",
  phone: "",
  pincode: "",
  state: "",
};

const PAGE_SIZE = 10;

export function CustomersScreen({
  businessProfile,
  activeOutlet,
  sessionRole = "admin",
  outlets = [],
}) {
  const modal = useModal();
  const { width } = useWindowDimensions();
  const summaryCardBasis = responsiveCardBasis(width, 2);
  const scrollRef = useRef(null);
  const hasMountedRef = useRef(false);
  const [selectedOutletLabel, setSelectedOutletLabel] = useState("");
  const [isFiltersOpen, setIsFiltersOpen] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [form, setForm] = useState(emptyForm);
  const [editingCustomer, setEditingCustomer] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [formError, setFormError] = useState("");

  const selectedOutlet = useMemo(
    () =>
      activeOutlet ||
      outlets.find((outlet) => outlet.outletCode === selectedOutletLabel) ||
      outlets[0] ||
      null,
    [activeOutlet, outlets, selectedOutletLabel]
  );
  const customerFilters = useMemo(
    () => ({ endDate: endDate || undefined, search: search || undefined, startDate: startDate || undefined }),
    [endDate, search, startDate]
  );
  const customersQuery = useCustomerList(businessProfile?.id, selectedOutlet?.id, customerFilters);
  const customers = customersQuery.data || [];
  const createCustomerMutation = useCreateCustomer();
  const updateCustomerMutation = useUpdateCustomer();
  const deleteCustomerMutation = useDeleteCustomer();
  const isLoading = customersQuery.isLoading || customersQuery.isFetching;
  const isBusy = createCustomerMutation.isPending || updateCustomerMutation.isPending || deleteCustomerMutation.isPending;

  useEffect(() => {
    if (!selectedOutletLabel && outlets.length > 0) {
      setSelectedOutletLabel(outlets[0].outletCode);
    }
  }, [outlets, selectedOutletLabel]);

  useEffect(() => {
    const timer = setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const totalPages = Math.max(1, Math.ceil(customers.length / PAGE_SIZE));

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  useEffect(() => {
    setCurrentPage(1);
  }, [endDate, search, selectedOutlet?.id, startDate]);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    scrollRef.current?.scrollTo({ animated: true, y: 0 });
  }, [currentPage]);

  const visibleCustomers = useMemo(() => {
    const startIndex = (currentPage - 1) * PAGE_SIZE;
    return customers.slice(startIndex, startIndex + PAGE_SIZE);
  }, [currentPage, customers]);

  const resetForm = () => {
    setForm(emptyForm);
    setEditingCustomer(null);
    setFormError("");
  };

  const updateForm = (key, value) => {
    setFormError("");
    setForm((current) => ({ ...current, [key]: value }));
  };

  const openEdit = (customer) => {
    setEditingCustomer(customer);
    setForm({
      address: customer.address || "",
      city: customer.city || "",
      email: customer.email || "",
      name: customer.name || "",
      notes: customer.notes || "",
      phone: customer.phone || "",
      pincode: customer.pincode || "",
      state: customer.state || "",
    });
  };

  const submitCustomer = async () => {
    if (!businessProfile?.id || !selectedOutlet?.id) {
      return;
    }

    const payload = {
      address: form.address.trim() || null,
      city: form.city.trim() || null,
      email: form.email.trim() || null,
      name: form.name.trim() || null,
      notes: form.notes.trim() || null,
      phone: form.phone.trim(),
      pincode: form.pincode.trim() || null,
      state: form.state.trim() || null,
    };

    if (!payload.phone || !isValidIndianMobile(payload.phone)) {
      setFormError("Enter a valid 10 digit Indian mobile number");
      return;
    }
    if (payload.email && !isValidEmail(payload.email)) {
      setFormError("Enter a valid email address");
      return;
    }
    if (payload.pincode && !isValidPincode(payload.pincode)) {
      setFormError("Enter a valid 6 digit pincode");
      return;
    }

    const savedCustomer = editingCustomer
      ? await updateCustomerMutation.mutateAsync({
          profileId: businessProfile.id,
          outletId: selectedOutlet.id,
          customerId: editingCustomer.id,
          payload,
        })
      : await createCustomerMutation.mutateAsync({ profileId: businessProfile.id, outletId: selectedOutlet.id, payload });
    const successTitle = editingCustomer ? "Customer updated successfully" : "Customer created successfully";

    resetForm();
    await modal.success(successTitle, savedCustomer?.name || payload.name || payload.phone);
  };

  const deleteCustomer = async (customer) => {
    if (!businessProfile?.id || !selectedOutlet?.id) {
      return;
    }
    await deleteCustomerMutation.mutateAsync({
      profileId: businessProfile.id,
      outletId: selectedOutlet.id,
      customerId: customer.id,
    });
    if (editingCustomer?.id === customer.id) {
      resetForm();
    }
    await modal.success("Customer deleted successfully", customer.name || customer.phone);
  };

  const activeFilterCount = [search, startDate, endDate].filter(Boolean).length;

  const resetFilters = () => {
    setSearchInput("");
    setSearch("");
    setStartDate("");
    setEndDate("");
    setCurrentPage(1);
  };

  const handlePageChange = (page) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  if (!outlets.length) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>No outlet found</Text>
        <Text style={styles.emptyText}>
          Create at least one outlet first, then store customer phone numbers and purchase history here.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      ref={scrollRef}
      style={styles.screen}
      contentContainerStyle={styles.content}
      showsVerticalScrollIndicator={false}
    >
      <ScreenHeader
        eyebrow={sessionRole === "admin" ? "Customer directory" : "Outlet customers"}
        iconLabel="C"
        iconTone="success"
        title="Customer Records"
        subtitle={
          sessionRole === "admin"
            ? "Choose an outlet, then add and maintain its customers in one clean directory."
            : "Store only the phone number if needed, then grow the profile with purchase history and loyalty later."
        }
      />

      {sessionRole === "admin" ? (
        <View style={styles.outletWrap}>
          <Text style={styles.sectionTitle}>Customer outlet</Text>
          <Text style={styles.helperText}>Customers stay linked to their outlet, so they are available during sales and invoicing from that outlet.</Text>
          <FilterChips
            activeValue={selectedOutletLabel}
            disabled={isBusy || isLoading}
            onChange={setSelectedOutletLabel}
            options={outlets.map((outlet) => outlet.outletCode || outlet.name)}
          />
        </View>
      ) : (
        <View style={styles.outletDetailsCard}>
          <Text style={styles.sectionTitle}>Outlet details</Text>
          <InfoRow label="Outlet code" value={activeOutlet?.outletCode} />
          <InfoRow label="Outlet name" value={activeOutlet?.tradeName || activeOutlet?.name} />
          <InfoRow label="Owner" value={activeOutlet?.ownerName} />
          <InfoRow label="Email" value={activeOutlet?.email} />
          <InfoRow label="Mobile" value={activeOutlet?.mobile} />
          <InfoRow label="City" value={activeOutlet?.city} />
          <InfoRow label="State" value={activeOutlet?.state} />
        </View>
      )}

        <AdvancedFilterPanel
          activeCount={activeFilterCount}
          isOpen={isFiltersOpen}
          onClear={resetFilters}
          onToggle={() => setIsFiltersOpen((current) => !current)}
          title="Customer Filters"
        >
        <SearchInput
          disabled={isBusy || isLoading}
          onChangeText={setSearchInput}
          placeholder="Search by name or phone"
          value={searchInput}
        />
        <View style={styles.dateRow}>
          <DateField
            disabled={isBusy || isLoading}
            label="From"
            onChangeText={setStartDate}
            value={startDate}
          />
          <DateField
            disabled={isBusy || isLoading}
            label="To"
            onChangeText={setEndDate}
            value={endDate}
          />
        </View>
      </AdvancedFilterPanel>

      <View style={styles.formCard}>
        <Text style={styles.sectionTitle}>{editingCustomer ? "Edit customer" : "Add customer"}</Text>
        <Text style={styles.helperText}>Phone number is mandatory. Everything else can be filled later.</Text>

        <View style={styles.formGrid}>
          <Field label="Phone *" value={form.phone} onChangeText={(value) => updateForm("phone", value)} />
          <Field label="Name" value={form.name} onChangeText={(value) => updateForm("name", value)} />
          <Field label="Email" value={form.email} onChangeText={(value) => updateForm("email", value)} />
          <Field label="State" value={form.state} onChangeText={(value) => updateForm("state", value)} />
          <Field label="City" value={form.city} onChangeText={(value) => updateForm("city", value)} />
          <Field label="Pincode" value={form.pincode} onChangeText={(value) => updateForm("pincode", value)} />
          <Field label="Address" multiline value={form.address} onChangeText={(value) => updateForm("address", value)} />
          <Field label="Notes" multiline value={form.notes} onChangeText={(value) => updateForm("notes", value)} />
        </View>

        {!!formError && <Text style={styles.formErrorText}>{formError}</Text>}
        <View style={styles.actionRow}>
          <AppButton
            disabled={isBusy || isLoading}
            label={editingCustomer ? "Update customer" : "Save customer"}
            onPress={submitCustomer}
          />
          <AppButton
            disabled={isBusy || isLoading}
            label="Clear"
            onPress={resetForm}
            variant="ghost"
          />
        </View>
      </View>

      <View style={styles.summaryRow}>
        <SummaryCard basis={summaryCardBasis} label="Customers" value={formatNumber(customers.length)} />
        <SummaryCard
          basis={summaryCardBasis}
          label="Lifetime spend"
          value={formatCurrency(
            customers.reduce((total, customer) => total + Number(customer.totalSpent || 0), 0)
          )}
        />
      </View>

      <View style={styles.listCard}>
        <View style={styles.listHeader}>
          <Text style={styles.sectionTitle}>Customer list</Text>
          {!!isLoading && <ActivityIndicator color={colors.primary} size="small" />}
        </View>

        {visibleCustomers.map((customer) => (
          <View key={customer.id} style={styles.customerCard}>
            <View style={styles.customerTop}>
              <View style={styles.customerAvatar}>
                <Text style={styles.customerAvatarText}>{(customer.name || customer.phone || "?").slice(0, 1)}</Text>
              </View>
              <View style={styles.customerInfo}>
                <Text style={styles.customerName}>{customer.name || "Unnamed customer"}</Text>
                <Text style={styles.customerPhone}>{customer.phone}</Text>
                {!!customer.lastPurchaseAt && (
                  <Text style={styles.customerMeta}>Last purchase {formatDate(customer.lastPurchaseAt)}</Text>
                )}
              </View>
              <View style={styles.customerActions}>
                <MiniButton disabled={isBusy || isLoading} label="Edit" onPress={() => openEdit(customer)} />
                <MiniButton
                  disabled={isBusy || isLoading}
                  label="Delete"
                  tone="danger"
                  onPress={() => deleteCustomer(customer)}
                />
              </View>
            </View>

            <View style={styles.metricsRow}>
              <Metric label="Spent" value={formatCurrency(customer.totalSpent)} />
              <Metric label="Purchases" value={formatNumber(customer.purchaseCount)} />
              <Metric label="Loyalty" value={formatNumber(customer.loyaltyPoints)} />
              <Metric label="Last bill" value={formatCurrency(customer.lastPurchaseAmount)} />
            </View>
          </View>
        ))}

        {!customers.length && !isLoading && (
          <View style={styles.emptyList}>
            <Text style={styles.emptyTitle}>No customers yet</Text>
            <Text style={styles.emptyText}>Start with a phone number, then add more details when needed.</Text>
          </View>
        )}

        {!!customers.length && (
          <PaginationControls
            currentPage={currentPage}
            label="customers"
            onPageChange={handlePageChange}
            pageSize={PAGE_SIZE}
            totalCount={customers.length}
            totalPages={totalPages}
          />
        )}
      </View>
    </ScrollView>
  );
}

function Field({ label, multiline = false, onChangeText, value }) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        multiline={multiline}
        onChangeText={onChangeText}
        placeholder={label}
        placeholderTextColor="#94A3B8"
        style={[styles.input, multiline && styles.multilineInput]}
        value={value}
      />
    </View>
  );
}

function DateField({ disabled = false, label, onChangeText, value }) {
  const webInputProps = Platform.OS === "web" ? { type: "date" } : {};
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <TextInput
        editable={!disabled}
        onChangeText={onChangeText}
        placeholder="YYYY-MM-DD"
        placeholderTextColor="#94A3B8"
        style={[styles.input, disabled && styles.disabledInput]}
        value={value}
        {...webInputProps}
      />
    </View>
  );
}

function SummaryCard({ basis, label, value }) {
  return (
    <View style={[styles.summaryCard, { flexBasis: basis }]}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text adjustsFontSizeToFit minimumFontScale={0.78} numberOfLines={1} style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function InfoRow({ label, value }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value || "Not provided"}</Text>
    </View>
  );
}

function Metric({ label, value }) {
  return (
    <View style={styles.metric}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
    </View>
  );
}

function MiniButton({ disabled = false, label, onPress, tone = "default" }) {
  return (
    <TouchableOpacity
      activeOpacity={disabled ? 1 : 0.85}
      disabled={disabled}
      onPress={onPress}
      style={[styles.miniButton, tone === "danger" && styles.miniDanger, disabled && styles.miniDisabled]}
    >
      <Text style={[styles.miniButtonText, tone === "danger" && styles.miniDangerText]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
  },
  content: {
    gap: spacing.md,
    paddingBottom: spacing.xl,
  },
  emptyState: {
    alignItems: "center",
    flex: 1,
    gap: spacing.sm,
    justifyContent: "center",
    padding: spacing.lg,
  },
  emptyTitle: {
    color: colors.ink,
    fontSize: 20,
    fontWeight: "700",
    textAlign: "center",
  },
  emptyText: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 20,
    textAlign: "center",
  },
  outletWrap: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  outletDetailsCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    padding: spacing.md,
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "700",
  },
  helperText: {
    color: colors.muted,
    fontSize: 12,
    lineHeight: 18,
  },
  formErrorText: {
    color: colors.danger,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: "600",
  },
  formCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.md,
    marginHorizontal: spacing.md,
    padding: spacing.md,
  },
  formGrid: {
    gap: spacing.sm,
  },
  field: {
    gap: 6,
  },
  fieldLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
  },
  input: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.ink,
    fontSize: 14,
    minHeight: 48,
    paddingHorizontal: spacing.md,
  },
  multilineInput: {
    minHeight: 74,
    paddingTop: spacing.sm,
    textAlignVertical: "top",
  },
  disabledInput: {
    opacity: 0.65,
  },
  actionRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  summaryRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  summaryCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    flexGrow: 0,
    minHeight: 86,
    minWidth: 0,
    gap: 4,
    padding: spacing.md,
  },
  summaryLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "600",
  },
  summaryValue: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "700",
  },
  infoRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    gap: 4,
    paddingVertical: spacing.xs,
  },
  infoLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "600",
  },
  infoValue: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "600",
  },
  listCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.md,
    marginHorizontal: spacing.md,
    padding: spacing.md,
  },
  listHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  customerCard: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  customerTop: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  customerAvatar: {
    alignItems: "center",
    backgroundColor: colors.primarySoft,
    borderRadius: 18,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  customerAvatarText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: "700",
  },
  customerInfo: {
    flex: 1,
    gap: 2,
  },
  customerName: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "700",
  },
  customerPhone: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  customerMeta: {
    color: colors.muted,
    fontSize: 11,
  },
  customerActions: {
    gap: 8,
  },
  miniButton: {
    alignItems: "center",
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  miniDanger: {
    backgroundColor: colors.dangerSoft,
  },
  miniDisabled: {
    opacity: 0.55,
  },
  miniButtonText: {
    color: colors.primary,
    fontSize: 11,
    fontWeight: "700",
  },
  miniDangerText: {
    color: colors.danger,
  },
  metricsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  metric: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 14,
    borderWidth: 1,
    flexGrow: 1,
    minWidth: "47%",
    padding: spacing.sm,
  },
  metricLabel: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "600",
  },
  metricValue: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: "700",
    marginTop: 4,
  },
  emptyList: {
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.md,
  },
  dateRow: {
    flexDirection: "row",
    gap: spacing.sm,
  },
});
