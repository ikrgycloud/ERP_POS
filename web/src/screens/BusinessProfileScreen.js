import React, { useEffect, useRef, useState } from "react";
import { Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { AppButton } from "../components/AppButton";
import { PaginationControls } from "../components/PaginationControls";
import { useModal } from "../components/ModalProvider";
import { ScreenHeader } from "../components/ScreenHeader";
import { colors, radii, spacing, typography } from "../constants/theme";
import { API_ROOT_URL } from "../config/apiConfig";
import { cleanDigits, firstError, isValidEmail, isValidGstin, isValidIndianMobile, isValidPan, isValidPincode, requiredErrors } from "../utils/validation";

const emptyOutletForm = {
  accountNumber: "",
  accessCode: "",
  address: "",
  bankName: "",
  businessType: "",
  city: "",
  cin: "",
  currency: "INR",
  email: "",
  financialYear: "2026-2027",
  ifsc: "",
  isActive: true,
  legalName: "",
  logoText: "ERP",
  managerName: "",
  mobile: "",
  name: "",
  ownerName: "",
  outletCode: "",
  pan: "",
  password: "",
  pincode: "",
  role: "outlet",
  state: "",
  taxType: "Regular GST",
  tradeName: "",
  upiId: "",
  gstin: "",
};

const PAGE_SIZE = 10;

const emptyProfileForm = {
  accessCode: "",
  accountNumber: "",
  bankName: "",
  billingAddress: "",
  businessType: "",
  city: "",
  cin: "",
  currency: "INR",
  email: "",
  financialYear: "2026-2027",
  gstin: "",
  ifsc: "",
  legalName: "",
  logoText: "ERP",
  mobile: "",
  ownerName: "",
  pan: "",
  password: "",
  pincode: "",
  role: "admin",
  shippingAddress: "",
  state: "",
  taxType: "Regular GST",
  tradeName: "",
  upiId: "",
};

const emptyPosStaffForm = { employeeCode: "", fullName: "", email: "", outletId: "", password: "", phone: "", role: "sales_person" };

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

function hasValue(value) {
  return String(value ?? "").trim().length > 0;
}

function countCompleted(values) {
  return values.filter(hasValue).length;
}

export function BusinessProfileScreen({
  businessProfile,
  activeOutlet,
  isBusy,
  onCreateOutlet,
  onDeleteOutlet,
  onSave,
  onUpdateOutlet,
  onUploadLogo,
  onCreatePosStaff,
  outlets = [],
  posStaff = [],
  sessionRole = "admin",
  viewMode = "business",
}) {
  const modal = useModal();
  const scrollRef = useRef(null);
  const hasMountedRef = useRef(false);
  const [outletForm, setOutletForm] = useState(emptyOutletForm);
  const [editingOutlet, setEditingOutlet] = useState(null);
  const [profileForm, setProfileForm] = useState(emptyProfileForm);
  const [profileLogoAsset, setProfileLogoAsset] = useState(null);
  const [showProfileForm, setShowProfileForm] = useState(false);
  const [showOutletForm, setShowOutletForm] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [formError, setFormError] = useState("");
  const [profileLogoFailed, setProfileLogoFailed] = useState(false);
  const [posStaffForm, setPosStaffForm] = useState(emptyPosStaffForm);
  const [showPosStaffForm, setShowPosStaffForm] = useState(false);
  const [posStaffError, setPosStaffError] = useState("");

  useEffect(() => {
    setProfileLogoFailed(false);
  }, [businessProfile?.id, businessProfile?.logoUrl, businessProfile?.logo_url, businessProfile?.updatedAt, businessProfile?.updated_at]);

  useEffect(() => {
    if (!businessProfile) {
      return;
    }
    setOutletForm((current) => ({
      ...current,
      legalName: current.legalName || businessProfile.legalName || "",
      logoText: current.logoText || businessProfile.logoText || "ERP",
      mobile: current.mobile || businessProfile.mobile || "",
      ownerName: current.ownerName || businessProfile.ownerName || "",
      tradeName: current.tradeName || `${businessProfile.tradeName || "Outlet"} Outlet`,
      businessType: current.businessType || businessProfile.businessType || "",
      city: current.city || businessProfile.city || "",
      state: current.state || businessProfile.state || "",
      pincode: current.pincode || businessProfile.pincode || "",
      bankName: current.bankName || businessProfile.bankName || "",
      accountNumber: current.accountNumber || businessProfile.accountNumber || "",
      ifsc: current.ifsc || businessProfile.ifsc || "",
      upiId: current.upiId || businessProfile.upiId || "",
      taxType: current.taxType || businessProfile.taxType || "Regular GST",
      currency: current.currency || businessProfile.currency || "INR",
      financialYear: current.financialYear || businessProfile.financialYear || "2026-2027",
    }));
    setProfileForm({
      accessCode: businessProfile.accessCode || "",
      accountNumber: businessProfile.accountNumber || "",
      bankName: businessProfile.bankName || "",
      billingAddress: businessProfile.billingAddress || "",
      businessType: businessProfile.businessType || "",
      city: businessProfile.city || "",
      cin: businessProfile.cin || "",
      currency: businessProfile.currency || "INR",
      email: businessProfile.email || "",
      financialYear: businessProfile.financialYear || "2026-2027",
      gstin: businessProfile.gstin || "",
      ifsc: businessProfile.ifsc || "",
      legalName: businessProfile.legalName || "",
      logoText: businessProfile.logoText || "ERP",
      mobile: businessProfile.mobile || "",
      ownerName: businessProfile.ownerName || "",
      pan: businessProfile.pan || "",
      password: "",
      pincode: businessProfile.pincode || "",
      role: "admin",
      shippingAddress: businessProfile.shippingAddress || "",
      state: businessProfile.state || "",
      taxType: businessProfile.taxType || "Regular GST",
      tradeName: businessProfile.tradeName || "",
      upiId: businessProfile.upiId || "",
    });
    setProfileLogoAsset(null);
  }, [businessProfile]);

  useEffect(() => {
    if (!posStaffForm.outletId && outlets[0]?.id) {
      setPosStaffForm((current) => ({ ...current, outletId: String(outlets[0].id) }));
    }
  }, [outlets, posStaffForm.outletId]);

  const totalPages = Math.max(1, Math.ceil(outlets.length / PAGE_SIZE));

  useEffect(() => {
    setCurrentPage((page) => Math.min(page, totalPages));
  }, [totalPages]);

  useEffect(() => {
    if (!hasMountedRef.current) {
      hasMountedRef.current = true;
      return;
    }
    scrollRef.current?.scrollTo({ animated: true, y: 0 });
  }, [currentPage]);

  const visibleOutlets = outlets.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE);
  const activeOutlets = outlets.filter((outlet) => outlet.isActive !== false).length;
  const inactiveOutlets = Math.max(0, outlets.length - activeOutlets);
  const missingOutletContacts = outlets.filter((outlet) => !hasValue(outlet.mobile) || !hasValue(outlet.email)).length;
  const contactCompleted = countCompleted([businessProfile?.ownerName, businessProfile?.mobile, businessProfile?.email]);
  const taxCompleted = countCompleted([businessProfile?.gstin, businessProfile?.pan, businessProfile?.taxType, businessProfile?.financialYear]);
  const addressCompleted = countCompleted([businessProfile?.billingAddress, businessProfile?.shippingAddress, businessProfile?.city, businessProfile?.state, businessProfile?.pincode]);
  const bankCompleted = countCompleted([businessProfile?.bankName, businessProfile?.accountNumber, businessProfile?.ifsc, businessProfile?.upiId]);
  const profileScore = Math.round(((contactCompleted / 3) + (taxCompleted / 4) + (addressCompleted / 5) + (bankCompleted / 4)) * 25);
  const hasLogo = Boolean(logoSourceFor(businessProfile) || businessProfile?.logoText);

  const updateOutletForm = (key, value) => {
    const sanitizedValue = ["mobile", "pincode", "accountNumber"].includes(key) ? cleanDigits(value) : value;
    setFormError("");
    setOutletForm((current) => ({ ...current, [key]: sanitizedValue }));
  };

  const updateProfileForm = (key, value) => {
    const sanitizedValue = ["mobile", "pincode", "accountNumber"].includes(key) ? cleanDigits(value) : value;
    setFormError("");
    setProfileForm((current) => ({ ...current, [key]: sanitizedValue }));
  };

  const pickProfileLogoFromGallery = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      mediaTypes: ["images"],
      quality: 0.82,
    });
    if (!result.canceled && result.assets?.[0]) {
      setProfileLogoAsset(result.assets[0]);
    }
  };

  const captureProfileLogoFromCamera = async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      mediaTypes: ["images"],
      quality: 0.82,
    });
    if (!result.canceled && result.assets?.[0]) {
      setProfileLogoAsset(result.assets[0]);
    }
  };

  const resetOutletForm = () => {
    setOutletForm({
      ...emptyOutletForm,
      legalName: businessProfile?.legalName || "",
      logoText: businessProfile?.logoText || "ERP",
      mobile: businessProfile?.mobile || "",
      ownerName: businessProfile?.ownerName || "",
      tradeName: `${businessProfile?.tradeName || "Outlet"} Outlet`,
      businessType: businessProfile?.businessType || "",
      city: businessProfile?.city || "",
      state: businessProfile?.state || "",
      pincode: businessProfile?.pincode || "",
      bankName: businessProfile?.bankName || "",
      accountNumber: businessProfile?.accountNumber || "",
      ifsc: businessProfile?.ifsc || "",
      upiId: businessProfile?.upiId || "",
      taxType: businessProfile?.taxType || "Regular GST",
      currency: businessProfile?.currency || "INR",
      financialYear: businessProfile?.financialYear || "2026-2027",
    });
    setEditingOutlet(null);
    setShowOutletForm(false);
  };

  const openCreateOutlet = () => {
    setFormError("");
    resetOutletForm();
    setShowOutletForm(true);
  };

  const openEditProfile = () => {
    setFormError("");
    setShowProfileForm(true);
    setProfileLogoAsset(null);
  };

  const cancelEditProfile = () => {
    setFormError("");
    setShowProfileForm(false);
    setProfileLogoAsset(null);
  };

  const validateBusinessFields = (form, required) => {
    const errors = requiredErrors(form, required);
    if (!errors.email && !isValidEmail(form.email)) {
      errors.email = "Enter a valid email address";
    }
    if (!errors.mobile && !isValidIndianMobile(form.mobile)) {
      errors.mobile = "Enter a valid 10 digit Indian mobile number";
    }
    if (!isValidPincode(form.pincode)) {
      errors.pincode = "Enter a valid 6 digit pincode";
    }
    if (!isValidPan(form.pan)) {
      errors.pan = "Enter a valid PAN number";
    }
    if (!isValidGstin(form.gstin)) {
      errors.gstin = "Enter a valid GSTIN";
    }
    if (form.accountNumber && !/^\d{6,18}$/.test(cleanDigits(form.accountNumber))) {
      errors.accountNumber = "Bank account number must be 6 to 18 digits";
    }
    if (form.password && form.password.trim().length < 6) {
      errors.password = "Password must be at least 6 characters";
    }
    return firstError(errors);
  };

  const submitProfile = async () => {
    if (!businessProfile?.id || !onSave) {
      return;
    }
    const payload = {
      ...businessProfile,
      accountNumber: profileForm.accountNumber.trim() || null,
      accessCode: profileForm.accessCode.trim() || null,
      bankName: profileForm.bankName.trim() || null,
      billingAddress: profileForm.billingAddress.trim() || null,
      businessType: profileForm.businessType.trim() || null,
      city: profileForm.city.trim() || null,
      cin: profileForm.cin.trim() || null,
      currency: profileForm.currency.trim() || "INR",
      email: profileForm.email.trim(),
      financialYear: profileForm.financialYear.trim() || "2026-2027",
      gstin: profileForm.gstin.trim() || null,
      ifsc: profileForm.ifsc.trim() || null,
      legalName: profileForm.legalName.trim(),
      logoText: profileForm.logoText.trim() || "ERP",
      mobile: profileForm.mobile.trim(),
      ownerName: profileForm.ownerName.trim(),
      pan: profileForm.pan.trim() || null,
      pincode: profileForm.pincode.trim() || null,
      role: "admin",
      shippingAddress: profileForm.shippingAddress.trim() || null,
      state: profileForm.state.trim() || null,
      taxType: profileForm.taxType.trim() || "Regular GST",
      tradeName: profileForm.tradeName.trim(),
      upiId: profileForm.upiId.trim() || null,
    };
    if (profileForm.password.trim()) {
      payload.password = profileForm.password.trim();
    }
    const validationError = validateBusinessFields(profileForm, [
      ["legalName", "Legal name"],
      ["tradeName", "Trade name"],
      ["ownerName", "Owner name"],
      ["mobile", "Mobile"],
      ["email", "Email"],
    ]);
    if (validationError) {
      setFormError(validationError);
      return;
    }
    const savedProfile = await onSave(payload);
    if (profileLogoAsset && onUploadLogo) {
      await onUploadLogo(savedProfile?.id || businessProfile.id, profileLogoAsset);
    }
    setShowProfileForm(false);
    setProfileLogoAsset(null);
    setFormError("");
    await modal.success("Business profile updated successfully", savedProfile?.tradeName || payload.tradeName);
  };

  const handlePageChange = (page) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
  };

  const openEditOutlet = (outlet) => {
    setEditingOutlet(outlet);
    setShowOutletForm(true);
    setOutletForm({
      accountNumber: outlet.accountNumber || "",
      accessCode: outlet.accessCode || "",
      address: outlet.address || "",
      bankName: outlet.bankName || "",
      businessType: outlet.businessType || "",
      city: outlet.city || "",
      cin: outlet.cin || "",
      currency: outlet.currency || "INR",
      email: outlet.email || "",
      financialYear: outlet.financialYear || "2026-2027",
      ifsc: outlet.ifsc || "",
      isActive: outlet.isActive ?? true,
      legalName: outlet.legalName || "",
      logoText: outlet.logoText || "ERP",
      managerName: outlet.managerName || "",
      mobile: outlet.mobile || "",
      name: outlet.name || "",
      ownerName: outlet.ownerName || "",
      outletCode: outlet.outletCode || "",
      pan: outlet.pan || "",
      password: "",
      pincode: outlet.pincode || "",
      role: outlet.role || "outlet",
      state: outlet.state || "",
      taxType: outlet.taxType || "Regular GST",
      tradeName: outlet.tradeName || "",
      upiId: outlet.upiId || "",
      gstin: outlet.gstin || "",
    });
  };

  const submitOutlet = async () => {
    if (!businessProfile?.id) {
      return;
    }

    const payload = {
      accountNumber: outletForm.accountNumber.trim() || null,
      accessCode: outletForm.accessCode.trim() || null,
      address: outletForm.address.trim() || null,
      bankName: outletForm.bankName.trim() || null,
      businessType: outletForm.businessType.trim() || null,
      city: outletForm.city.trim() || null,
      cin: outletForm.cin.trim() || null,
      currency: outletForm.currency.trim() || "INR",
      email: outletForm.email.trim(),
      financialYear: outletForm.financialYear.trim() || "2026-2027",
      ifsc: outletForm.ifsc.trim() || null,
      isActive: outletForm.isActive,
      legalName: outletForm.legalName.trim(),
      logoText: outletForm.logoText.trim() || "ERP",
      managerName: outletForm.managerName.trim() || null,
      mobile: outletForm.mobile.trim(),
      name: outletForm.name.trim(),
      ownerName: outletForm.ownerName.trim(),
      outletCode: outletForm.outletCode.trim(),
      pan: outletForm.pan.trim() || null,
      password: outletForm.password.trim() || null,
      pincode: outletForm.pincode.trim() || null,
      role: "outlet",
      state: outletForm.state.trim() || null,
      taxType: outletForm.taxType.trim() || "Regular GST",
      tradeName: outletForm.tradeName.trim(),
      upiId: outletForm.upiId.trim() || null,
      gstin: outletForm.gstin.trim() || null,
    };

    const validationError = validateBusinessFields(outletForm, [
      ["outletCode", "Outlet code"],
      ["name", "Outlet name"],
      ["legalName", "Legal name"],
      ["tradeName", "Trade name"],
      ["ownerName", "Owner name"],
      ["mobile", "Mobile"],
      ["email", "Email"],
      ...(editingOutlet ? [] : [["password", "Password"]]),
    ]);
    if (validationError) {
      setFormError(validationError);
      return;
    }

    const savedOutlet = editingOutlet
      ? await onUpdateOutlet(businessProfile.id, editingOutlet.id, payload)
      : await onCreateOutlet(businessProfile.id, payload);
    const successTitle = editingOutlet ? "Outlet updated successfully" : "Outlet created successfully";
    resetOutletForm();
    setFormError("");
    await modal.success(successTitle, savedOutlet?.tradeName || savedOutlet?.name || payload.tradeName || payload.name);
  };

  const deleteOutlet = async (outlet) => {
    if (!businessProfile?.id) {
      return;
    }
    const confirmed = await modal.confirm({
      cancelLabel: "Keep outlet",
      confirmLabel: "Delete",
      message: outlet.tradeName || outlet.name || "This outlet will be removed from the business profile.",
      title: "Delete outlet?",
      tone: "danger",
    });
    if (!confirmed) {
      return;
    }
    await onDeleteOutlet(businessProfile.id, outlet.id);
    if (editingOutlet?.id === outlet.id) {
      resetOutletForm();
    }
    await modal.success("Outlet deleted successfully", outlet.tradeName || outlet.name);
  };

  const submitPosStaff = async () => {
    const required = firstError(requiredErrors(posStaffForm, [["fullName", "Full name"], ["employeeCode", "Employee code"], ["outletId", "Outlet"], ["password", "Password"]]));
    if (required) { setPosStaffError(required); return; }
    if (posStaffForm.password.length < 8) { setPosStaffError("Password must contain at least 8 characters."); return; }
    try {
      const staff = await onCreatePosStaff(businessProfile.id, {
        employeeCode: posStaffForm.employeeCode,
        fullName: posStaffForm.fullName,
        email: posStaffForm.email || null,
        outletId: Number(posStaffForm.outletId),
        password: posStaffForm.password,
        phone: posStaffForm.phone || null,
        role: posStaffForm.role,
      });
      setPosStaffForm({ ...emptyPosStaffForm, outletId: outlets[0] ? String(outlets[0].id) : "" });
      setPosStaffError("");
      setShowPosStaffForm(false);
      await modal.success("POS user created", `${staff.fullName} can now sign in with ${staff.employeeCode}.`);
    } catch (error) {
      setPosStaffError(typeof error?.message === "string" ? error.message : "Could not create the POS user.");
    }
  };

  if (!businessProfile) {
    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>No business profile found</Text>
        <Text style={styles.emptyText}>Create a company profile from registration or insert one in the database.</Text>
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
      {viewMode === "business" ? (
        <>
          <ScreenHeader
            eyebrow="Registered ERP Profile"
            iconLabel="B"
            iconTone="primary"
            title="Business Setup"
            subtitle="Company details used for login, GST invoices, billing, shipping, and bank references."
          />

          <View style={styles.summaryGrid}>
            <MetricCard label="Profile health" value={`${profileScore}%`} detail={profileScore >= 85 ? "Ready for invoices" : "Needs profile details"} tone={profileScore >= 85 ? "success" : "warning"} />
            <MetricCard label="Outlets" value={outlets.length} detail={`${activeOutlets} active · ${inactiveOutlets} inactive`} />
            <MetricCard label="Tax setup" value={`${taxCompleted}/4`} detail={hasValue(businessProfile.gstin) ? businessProfile.gstin : "GSTIN not provided"} tone={taxCompleted >= 3 ? "success" : "warning"} />
            <MetricCard label="Bank setup" value={`${bankCompleted}/4`} detail={hasValue(businessProfile.accountNumber) ? "Payment details available" : "Bank account missing"} tone={bankCompleted >= 3 ? "success" : "warning"} />
          </View>

          {sessionRole === "admin" && (
            <View style={styles.posTeamCard}>
              <View style={styles.posTeamHeader}>
                <View><Text style={styles.sectionTitle}>POS Team</Text><Text style={styles.formHint}>Create staff accounts for this business. Each account sees only this business’s products and outlet.</Text></View>
                {!showPosStaffForm && <AppButton disabled={isBusy || !outlets.length} label="Add POS user" onPress={() => setShowPosStaffForm(true)} />}
              </View>
              {!outlets.length && <Text style={styles.formErrorText}>Create an outlet first, then add your POS team.</Text>}
              {showPosStaffForm && (
                <View style={styles.outletFormCard}>
                  <Text style={styles.formTitle}>New POS user</Text>
                  <View style={styles.formGrid}>
                    <Field label="Full name *" value={posStaffForm.fullName} onChangeText={(value) => setPosStaffForm((current) => ({ ...current, fullName: value }))} />
                    <Field label="Employee code *" value={posStaffForm.employeeCode} onChangeText={(value) => setPosStaffForm((current) => ({ ...current, employeeCode: value.toUpperCase() }))} />
                    <Field label="Email" value={posStaffForm.email} onChangeText={(value) => setPosStaffForm((current) => ({ ...current, email: value }))} />
                    <Field label="Mobile" keyboardType="phone-pad" maxLength={10} value={posStaffForm.phone} onChangeText={(value) => setPosStaffForm((current) => ({ ...current, phone: cleanDigits(value) }))} />
                    <Field label="Password *" value={posStaffForm.password} onChangeText={(value) => setPosStaffForm((current) => ({ ...current, password: value }))} />
                  </View>
                  <Text style={styles.fieldLabel}>Outlet *</Text><View style={styles.choiceRow}>{outlets.map((outlet) => <MiniButton key={outlet.id} label={outlet.tradeName || outlet.name} tone={String(outlet.id) === posStaffForm.outletId ? "primary" : "default"} onPress={() => setPosStaffForm((current) => ({ ...current, outletId: String(outlet.id) }))} />)}</View>
                  <Text style={styles.fieldLabel}>POS role *</Text><View style={styles.choiceRow}>{[["branch_manager", "Branch manager"], ["sales_manager", "Sales manager"], ["sales_person", "Sales person"]].map(([value, label]) => <MiniButton key={value} label={label} tone={value === posStaffForm.role ? "primary" : "default"} onPress={() => setPosStaffForm((current) => ({ ...current, role: value }))} />)}</View>
                  {!!posStaffError && <Text style={styles.formErrorText}>{posStaffError}</Text>}
                  <View style={styles.actionRow}><AppButton disabled={isBusy} label="Create POS user" onPress={submitPosStaff} /><AppButton disabled={isBusy} label="Cancel" variant="ghost" onPress={() => { setShowPosStaffForm(false); setPosStaffError(""); }} /></View>
                </View>
              )}
              <View style={styles.posStaffList}>{posStaff.map((staff) => <View key={staff.id} style={styles.posStaffRow}><View><Text style={styles.outletTitle}>{staff.fullName}</Text><Text style={styles.outletMeta}>{staff.employeeCode} · {staff.role.replace("_", " ")}</Text></View><Text style={styles.outletMeta}>{outlets.find((outlet) => outlet.id === staff.outletId)?.tradeName || "Outlet"} · {staff.isActive ? "Active" : "Inactive"}</Text></View>)}{!posStaff.length && outlets.length > 0 && <Text style={styles.formHint}>No POS users yet.</Text>}</View>
            </View>
          )}

          {sessionRole === "outlet" && activeOutlet ? (
            <View style={styles.outletOverviewCard}>
              <Text style={styles.sectionTitle}>Your outlet</Text>
              <Info label="Outlet code" value={activeOutlet.outletCode} />
              <Info label="Outlet name" value={activeOutlet.tradeName || activeOutlet.name} />
              <Info label="Outlet owner" value={activeOutlet.ownerName} />
              <Info label="Mobile" value={activeOutlet.mobile} />
              <Info label="Email" value={activeOutlet.email} />
              <Info label="City" value={activeOutlet.city} />
              <Info label="State" value={activeOutlet.state} />
            </View>
          ) : null}

          <View style={styles.profileCard}>
            <View style={styles.logo}>
              {logoSourceFor(businessProfile) && !profileLogoFailed ? (
                <Image
                  source={logoSourceFor(businessProfile)}
                  style={styles.profileLogoImage}
                  resizeMode="cover"
                  onError={() => setProfileLogoFailed(true)}
                />
              ) : (
                <Text style={styles.logoText}>{businessProfile.logoText || businessProfile.tradeName?.slice(0, 3)}</Text>
              )}
            </View>
            <View style={styles.profileInfo}>
              <Text style={styles.tradeName}>{businessProfile.tradeName}</Text>
              <Text style={styles.legalName}>{businessProfile.legalName}</Text>
              <Text style={styles.businessType}>{businessProfile.businessType}</Text>
              <View style={styles.profileQuickGrid}>
                <QuickInfo label="Owner" value={businessProfile.ownerName} />
                <QuickInfo label="Mobile" value={businessProfile.mobile} />
                <QuickInfo label="Email" value={businessProfile.email} />
                <QuickInfo label="Location" value={[businessProfile.city, businessProfile.state].filter(Boolean).join(", ")} />
              </View>
              <View style={styles.badgeRow}>
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{businessProfile.role || "admin"}</Text>
                </View>
                <View style={[styles.badge, styles.badgeSecondary]}>
                  <Text style={styles.badgeText}>{businessProfile.accessCode || "No access code"}</Text>
                </View>
              </View>
            </View>
          </View>

          {sessionRole === "admin" && !showProfileForm ? (
            <View style={styles.profileEditAction}>
              <AppButton disabled={isBusy} label="Edit business details" onPress={openEditProfile} />
            </View>
          ) : null}

          <View style={styles.readinessCard}>
            <View style={styles.readinessHeader}>
              <Text style={styles.sectionTitle}>Business readiness</Text>
              <Text style={styles.readinessScore}>{profileScore}% complete</Text>
            </View>
            <View style={styles.statusGrid}>
              <StatusLine label="Owner contact" done={contactCompleted === 3} detail={`${contactCompleted}/3 fields`} />
              <StatusLine label="Tax and compliance" done={taxCompleted >= 3} detail={`${taxCompleted}/4 fields`} />
              <StatusLine label="Address details" done={addressCompleted >= 4} detail={`${addressCompleted}/5 fields`} />
              <StatusLine label="Bank references" done={bankCompleted >= 3} detail={`${bankCompleted}/4 fields`} />
              <StatusLine label="Logo or initials" done={hasLogo} detail={hasLogo ? "Available" : "Missing"} />
            </View>
          </View>

          {sessionRole === "admin" && showProfileForm ? (
            <View style={styles.businessFormCard}>
              <Text style={styles.formTitle}>Edit business details</Text>
              <Text style={styles.formHint}>Update company details, bank/tax information, password, and logo image.</Text>
              <View style={styles.logoPickerCard}>
                <View style={styles.logoPreviewBox}>
                  {profileLogoAsset?.uri ? (
                    <Image source={{ uri: profileLogoAsset.uri }} style={styles.logoPreviewImage} resizeMode="cover" />
                  ) : logoSourceFor(businessProfile) && !profileLogoFailed ? (
                    <Image
                      source={logoSourceFor(businessProfile)}
                      style={styles.logoPreviewImage}
                      resizeMode="cover"
                      onError={() => setProfileLogoFailed(true)}
                    />
                  ) : (
                    <Text style={styles.logoPreviewText}>{profileForm.logoText || "LOGO"}</Text>
                  )}
                </View>
                <View style={styles.logoActionWrap}>
                  <AppButton disabled={isBusy} label="Select logo from gallery / PC" onPress={pickProfileLogoFromGallery} variant="ghost" />
                  <AppButton disabled={isBusy} label="Take logo photo now" onPress={captureProfileLogoFromCamera} variant="ghost" />
                  {profileLogoAsset ? (
                    <MiniButton disabled={isBusy} label="Remove selected" tone="danger" onPress={() => setProfileLogoAsset(null)} />
                  ) : null}
                </View>
              </View>
              <View style={styles.formGrid}>
                <Field label="Legal name *" value={profileForm.legalName} onChangeText={(value) => updateProfileForm("legalName", value)} />
                <Field label="Trade name *" value={profileForm.tradeName} onChangeText={(value) => updateProfileForm("tradeName", value)} />
                <Field label="Logo text" value={profileForm.logoText} onChangeText={(value) => updateProfileForm("logoText", value)} />
                <Field label="Owner name *" value={profileForm.ownerName} onChangeText={(value) => updateProfileForm("ownerName", value)} />
                <Field keyboardType="phone-pad" maxLength={10} label="Mobile *" value={profileForm.mobile} onChangeText={(value) => updateProfileForm("mobile", value)} />
                <Field label="Email *" value={profileForm.email} onChangeText={(value) => updateProfileForm("email", value)} />
                <Field label="New password (optional)" value={profileForm.password} onChangeText={(value) => updateProfileForm("password", value)} />
                <Field label="GSTIN" value={profileForm.gstin} onChangeText={(value) => updateProfileForm("gstin", value)} />
                <Field label="PAN" value={profileForm.pan} onChangeText={(value) => updateProfileForm("pan", value)} />
                <Field label="CIN" value={profileForm.cin} onChangeText={(value) => updateProfileForm("cin", value)} />
                <Field label="Business type" value={profileForm.businessType} onChangeText={(value) => updateProfileForm("businessType", value)} />
                <Field label="Tax type" value={profileForm.taxType} onChangeText={(value) => updateProfileForm("taxType", value)} />
                <Field label="Financial year" value={profileForm.financialYear} onChangeText={(value) => updateProfileForm("financialYear", value)} />
                <Field label="Currency" value={profileForm.currency} onChangeText={(value) => updateProfileForm("currency", value)} />
                <Field label="Billing address" multiline value={profileForm.billingAddress} onChangeText={(value) => updateProfileForm("billingAddress", value)} />
                <Field label="Shipping address" multiline value={profileForm.shippingAddress} onChangeText={(value) => updateProfileForm("shippingAddress", value)} />
                <Field label="City" value={profileForm.city} onChangeText={(value) => updateProfileForm("city", value)} />
                <Field label="State" value={profileForm.state} onChangeText={(value) => updateProfileForm("state", value)} />
                <Field keyboardType="numeric" maxLength={6} label="Pincode" value={profileForm.pincode} onChangeText={(value) => updateProfileForm("pincode", value)} />
                <Field label="Bank name" value={profileForm.bankName} onChangeText={(value) => updateProfileForm("bankName", value)} />
                <Field keyboardType="numeric" maxLength={18} label="Account number" value={profileForm.accountNumber} onChangeText={(value) => updateProfileForm("accountNumber", value)} />
                <Field label="IFSC" value={profileForm.ifsc} onChangeText={(value) => updateProfileForm("ifsc", value)} />
                <Field label="UPI ID" value={profileForm.upiId} onChangeText={(value) => updateProfileForm("upiId", value)} />
                <Field label="Access code" value={profileForm.accessCode} onChangeText={(value) => updateProfileForm("accessCode", value)} />
              </View>
              {!!formError && <Text style={styles.formErrorText}>{formError}</Text>}
              <View style={styles.actionRow}>
                <AppButton disabled={isBusy} label="Save business" onPress={submitProfile} />
                <AppButton disabled={isBusy} label="Cancel" onPress={cancelEditProfile} variant="ghost" />
              </View>
            </View>
          ) : null}

          <Section title="Owner and contact">
            <Info label="Owner / admin" value={businessProfile.ownerName} />
            <Info label="Mobile" value={businessProfile.mobile} />
            <Info label="Email" value={businessProfile.email} />
          </Section>

          <Section title="Tax and compliance">
            <Info label="GSTIN" value={businessProfile.gstin} />
            <Info label="PAN" value={businessProfile.pan} />
            <Info label="CIN" value={businessProfile.cin} />
            <Info label="Role" value={businessProfile.role} />
            <Info label="Access code" value={businessProfile.accessCode} />
            <Info label="Tax type" value={businessProfile.taxType} />
            <Info label="Financial year" value={businessProfile.financialYear} />
            <Info label="Currency" value={businessProfile.currency} />
          </Section>

          <Section title="Address">
            <Info label="Billing address" value={businessProfile.billingAddress} />
            <Info label="Shipping address" value={businessProfile.shippingAddress} />
            <Info label="City" value={businessProfile.city} />
            <Info label="State" value={businessProfile.state} />
            <Info label="Pincode" value={businessProfile.pincode} />
          </Section>

          <Section title="Bank details">
            <Info label="Bank name" value={businessProfile.bankName} />
            <Info label="Account number" value={businessProfile.accountNumber} />
            <Info label="IFSC" value={businessProfile.ifsc} />
            <Info label="UPI ID" value={businessProfile.upiId} />
          </Section>
        </>
      ) : (
        <>
          <ScreenHeader
            eyebrow="Outlet Management"
            iconLabel="S"
            iconTone="warning"
            title="Outlets"
            subtitle="Create outlets from the company profile, then edit outlet details anytime."
          />

          <View style={styles.summaryGrid}>
            <MetricCard label="Total outlets" value={outlets.length} detail="Branches in this business" />
            <MetricCard label="Active outlets" value={activeOutlets} detail="Available for operations" tone="success" />
            <MetricCard label="Inactive outlets" value={inactiveOutlets} detail="Currently paused" tone={inactiveOutlets ? "warning" : "default"} />
            <MetricCard label="Missing contacts" value={missingOutletContacts} detail="Mobile or email incomplete" tone={missingOutletContacts ? "danger" : "success"} />
          </View>

          <View style={styles.section}>
            {!showOutletForm ? (
              <View style={styles.outletActionsRow}>
                <AppButton disabled={isBusy} label="Create outlet" onPress={openCreateOutlet} />
              </View>
            ) : (
              <View style={styles.outletFormCard}>
                <Text style={styles.formTitle}>{editingOutlet ? "Edit outlet" : "Create outlet"}</Text>
                <Text style={styles.formHint}>Use the company details as the base, then customize this branch.</Text>

                <View style={styles.formGrid}>
                  <Field label="Outlet code *" value={outletForm.outletCode} onChangeText={(value) => updateOutletForm("outletCode", value)} />
                  <Field label="Outlet name *" value={outletForm.name} onChangeText={(value) => updateOutletForm("name", value)} />
                  <Field label="Legal name *" value={outletForm.legalName} onChangeText={(value) => updateOutletForm("legalName", value)} />
                  <Field label="Trade name *" value={outletForm.tradeName} onChangeText={(value) => updateOutletForm("tradeName", value)} />
                  <Field label="Owner name *" value={outletForm.ownerName} onChangeText={(value) => updateOutletForm("ownerName", value)} />
                  <Field keyboardType="phone-pad" maxLength={10} label="Mobile *" value={outletForm.mobile} onChangeText={(value) => updateOutletForm("mobile", value)} />
                  <Field label="Email *" value={outletForm.email} onChangeText={(value) => updateOutletForm("email", value)} />
                  <Field label="Manager name" value={outletForm.managerName} onChangeText={(value) => updateOutletForm("managerName", value)} />
                  <Field label="GSTIN" value={outletForm.gstin} onChangeText={(value) => updateOutletForm("gstin", value)} />
                  <Field label="PAN" value={outletForm.pan} onChangeText={(value) => updateOutletForm("pan", value)} />
                  <Field label="CIN" value={outletForm.cin} onChangeText={(value) => updateOutletForm("cin", value)} />
                  <Field label="Business type" value={outletForm.businessType} onChangeText={(value) => updateOutletForm("businessType", value)} />
                  <Field label="Tax type" value={outletForm.taxType} onChangeText={(value) => updateOutletForm("taxType", value)} />
                  <Field label="Currency" value={outletForm.currency} onChangeText={(value) => updateOutletForm("currency", value)} />
                  <Field label="Financial year" value={outletForm.financialYear} onChangeText={(value) => updateOutletForm("financialYear", value)} />
                  <Field label="City" value={outletForm.city} onChangeText={(value) => updateOutletForm("city", value)} />
                  <Field label="State" value={outletForm.state} onChangeText={(value) => updateOutletForm("state", value)} />
                  <Field keyboardType="numeric" maxLength={6} label="Pincode" value={outletForm.pincode} onChangeText={(value) => updateOutletForm("pincode", value)} />
                  <Field label="Address" multiline value={outletForm.address} onChangeText={(value) => updateOutletForm("address", value)} />
                  <Field label="Bank name" value={outletForm.bankName} onChangeText={(value) => updateOutletForm("bankName", value)} />
                  <Field keyboardType="numeric" maxLength={18} label="Account number" value={outletForm.accountNumber} onChangeText={(value) => updateOutletForm("accountNumber", value)} />
                  <Field label="IFSC" value={outletForm.ifsc} onChangeText={(value) => updateOutletForm("ifsc", value)} />
                  <Field label="UPI ID" value={outletForm.upiId} onChangeText={(value) => updateOutletForm("upiId", value)} />
                  <Field label="Logo text" value={outletForm.logoText} onChangeText={(value) => updateOutletForm("logoText", value)} />
                  <Field label="Access code" value={outletForm.accessCode} onChangeText={(value) => updateOutletForm("accessCode", value)} />
                  <Field
                    label={editingOutlet ? "New password (optional)" : "Password *"}
                    value={outletForm.password}
                    onChangeText={(value) => updateOutletForm("password", value)}
                  />
                </View>

                {!!formError && <Text style={styles.formErrorText}>{formError}</Text>}
                <View style={styles.actionRow}>
                  <AppButton
                    disabled={isBusy}
                    label={editingOutlet ? "Update outlet" : "Create outlet"}
                    onPress={submitOutlet}
                  />
                  <AppButton
                    disabled={isBusy}
                    label="Cancel"
                    onPress={resetOutletForm}
                    variant="ghost"
                  />
                </View>
              </View>
            )}

            <View style={styles.outletList}>
              {visibleOutlets.map((outlet) => (
                <View key={outlet.id} style={styles.outletCard}>
                  <View style={styles.outletTop}>
                    <View style={styles.outletAvatar}>
                      <Text style={styles.outletAvatarText}>{(outlet.tradeName || outlet.name || "O").slice(0, 1)}</Text>
                    </View>
                    <View style={styles.outletInfo}>
                      <View style={styles.outletTitleRow}>
                        <Text style={styles.outletTitle}>{outlet.tradeName || outlet.name}</Text>
                        <View style={[styles.statusPill, outlet.isActive === false && styles.statusPillMuted]}>
                          <Text style={[styles.statusPillText, outlet.isActive === false && styles.statusPillTextMuted]}>{outlet.isActive === false ? "Inactive" : "Active"}</Text>
                        </View>
                      </View>
                      <Text style={styles.outletMeta}>{outlet.outletCode || "No outlet code"}</Text>
                      <Text style={styles.outletMeta}>
                        {outlet.city || "No city"} · {outlet.state || "No state"}
                      </Text>
                      <Text style={styles.outletMeta}>{outlet.mobile || "No mobile"} · {outlet.email || "No email"}</Text>
                    </View>
                    <View style={styles.outletActions}>
                      <MiniButton disabled={isBusy} label="Edit" onPress={() => openEditOutlet(outlet)} />
                      <MiniButton disabled={isBusy} label="Delete" tone="danger" onPress={() => deleteOutlet(outlet)} />
                    </View>
                  </View>
                </View>
              ))}
              {!outlets.length && <Text style={styles.formHint}>No outlets created yet.</Text>}
            </View>
            {!!outlets.length && (
              <PaginationControls
                currentPage={currentPage}
                label="outlets"
                onPageChange={handlePageChange}
                pageSize={PAGE_SIZE}
                totalCount={outlets.length}
                totalPages={totalPages}
              />
            )}
          </View>
        </>
      )}
    </ScrollView>
  );
}

function Field({ keyboardType, label, maxLength, multiline = false, onChangeText, value }) {
  const isPasswordField = label.toLowerCase().includes("password");
  const [passwordVisible, setPasswordVisible] = useState(false);
  return (
    <View style={[styles.field, multiline && styles.wideField]}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.passwordInputWrap}>
        <TextInput
          multiline={multiline}
          onChangeText={onChangeText}
          keyboardType={keyboardType}
          maxLength={maxLength}
          placeholder={label}
          placeholderTextColor="#94A3B8"
          secureTextEntry={isPasswordField && !passwordVisible}
          style={[styles.input, isPasswordField && styles.passwordInput, multiline && styles.multilineInput]}
          value={value}
        />
        {isPasswordField && <TouchableOpacity accessibilityLabel={passwordVisible ? "Hide password" : "Show password"} onPress={() => setPasswordVisible((visible) => !visible)} style={styles.passwordToggle}><Text style={styles.passwordToggleText}>{passwordVisible ? "Hide" : "Show"}</Text></TouchableOpacity>}
      </View>
    </View>
  );
}

function MetricCard({ detail, label, tone = "default", value }) {
  return (
    <View style={[styles.metricCard, tone === "success" && styles.metricSuccess, tone === "warning" && styles.metricWarning, tone === "danger" && styles.metricDanger]}>
      <Text style={styles.metricLabel}>{label}</Text>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricDetail}>{detail}</Text>
    </View>
  );
}

function QuickInfo({ label, value }) {
  return (
    <View style={styles.quickInfo}>
      <Text style={styles.quickInfoLabel}>{label}</Text>
      <Text style={styles.quickInfoValue} numberOfLines={1}>{value || "Not provided"}</Text>
    </View>
  );
}

function StatusLine({ detail, done, label }) {
  return (
    <View style={styles.statusLine}>
      <View style={[styles.statusDot, done && styles.statusDotDone]} />
      <View style={styles.statusLineText}>
        <Text style={styles.statusLabel}>{label}</Text>
        <Text style={styles.statusDetail}>{detail}</Text>
      </View>
    </View>
  );
}

function MiniButton({ disabled = false, label, onPress, tone = "default" }) {
  return (
    <TouchableOpacity
      activeOpacity={disabled ? 1 : 0.85}
      disabled={disabled}
      onPress={onPress}
      style={[styles.miniButton, tone === "primary" && styles.miniPrimary, tone === "danger" && styles.miniDanger, disabled && styles.miniDisabled]}
    >
      <Text style={[styles.miniButtonText, tone === "primary" && styles.miniPrimaryText, tone === "danger" && styles.miniDangerText]}>{label}</Text>
    </TouchableOpacity>
  );
}

function Section({ children, title }) {
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>{title}</Text>
      <View style={styles.sectionCard}>{children}</View>
    </View>
  );
}

function Info({ label, value }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value || "Not provided"}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
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
  content: {
    paddingBottom: spacing.xl,
  },
  summaryGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  metricCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexBasis: 220,
    flexGrow: 1,
    gap: 6,
    minWidth: 190,
    padding: spacing.md,
  },
  metricSuccess: {
    backgroundColor: colors.successSoft,
    borderColor: "#B9E6C8",
  },
  metricWarning: {
    backgroundColor: colors.warningSoft,
    borderColor: "#E7C98F",
  },
  metricDanger: {
    backgroundColor: colors.dangerSoft,
    borderColor: "#F0B9AE",
  },
  metricLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "700",
  },
  metricValue: {
    color: colors.ink,
    fontSize: 24,
    fontWeight: "800",
    lineHeight: 29,
  },
  metricDetail: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
    lineHeight: 17,
  },
  profileCard: {
    alignItems: "flex-start",
    backgroundColor: colors.primaryDark,
    borderRadius: radii.lg,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    margin: spacing.md,
    padding: spacing.lg,
  },
  logo: {
    alignItems: "center",
    backgroundColor: "rgba(255,255,255,0.12)",
    borderColor: "rgba(255,255,255,0.18)",
    borderRadius: 24,
    borderWidth: 1,
    height: 72,
    justifyContent: "center",
    width: 72,
  },
  logoText: {
    color: colors.white,
    fontSize: 22,
    fontWeight: "700",
  },
  profileLogoImage: {
    height: "100%",
    width: "100%",
  },
  profileInfo: {
    gap: spacing.sm,
    flex: 1,
    minWidth: 240,
  },
  profileEditAction: {
    paddingHorizontal: spacing.md,
  },
  businessFormCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  logoPickerCard: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    padding: spacing.md,
  },
  logoPreviewBox: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    height: 92,
    justifyContent: "center",
    overflow: "hidden",
    width: 92,
  },
  logoPreviewImage: {
    height: "100%",
    width: "100%",
  },
  logoPreviewText: {
    color: colors.primary,
    fontSize: 16,
    fontWeight: "700",
  },
  logoActionWrap: {
    flex: 1,
    gap: spacing.sm,
    minWidth: 220,
  },
  tradeName: {
    color: colors.white,
    fontSize: 20,
    fontWeight: "700",
  },
  legalName: {
    color: "#CBD5E1",
    fontSize: 13,
    lineHeight: 19,
    marginTop: spacing.xs,
  },
  businessType: {
    color: colors.white,
    fontSize: 12,
    fontWeight: "700",
  },
  profileQuickGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  quickInfo: {
    backgroundColor: "rgba(255,255,255,0.1)",
    borderColor: "rgba(255,255,255,0.12)",
    borderRadius: radii.sm,
    borderWidth: 1,
    flexBasis: 150,
    flexGrow: 1,
    gap: 3,
    minWidth: 130,
    paddingHorizontal: spacing.sm,
    paddingVertical: 8,
  },
  quickInfoLabel: {
    color: "#CBD5E1",
    fontSize: 10,
    fontWeight: "700",
    textTransform: "uppercase",
  },
  quickInfoValue: {
    color: colors.white,
    fontSize: 12,
    fontWeight: "700",
  },
  badgeRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginTop: spacing.md,
  },
  badge: {
    backgroundColor: "rgba(255,255,255,0.14)",
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
  },
  badgeSecondary: {
    backgroundColor: "rgba(255,255,255,0.1)",
  },
  badgeText: {
    color: colors.white,
    fontSize: 11,
    fontWeight: "700",
  },
  section: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
  },
  sectionTitle: {
    color: colors.ink,
    fontSize: 17,
    fontWeight: "700",
  },
  posTeamCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.md,
    margin: spacing.md,
    padding: spacing.md,
  },
  posTeamHeader: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.md,
    justifyContent: "space-between",
  },
  posStaffList: {
    gap: spacing.sm,
  },
  posStaffRow: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "space-between",
    padding: spacing.sm,
  },
  choiceRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
    marginBottom: spacing.sm,
  },
  passwordInputWrap: {
    position: "relative",
  },
  passwordInput: {
    paddingRight: 58,
  },
  passwordToggle: {
    alignItems: "center",
    height: "100%",
    justifyContent: "center",
    paddingHorizontal: spacing.sm,
    position: "absolute",
    right: 0,
  },
  passwordToggleText: {
    color: colors.primary,
    fontSize: 12,
    fontWeight: "700",
  },
  sectionCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    flexWrap: "wrap",
    overflow: "hidden",
  },
  readinessCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.md,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  readinessHeader: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  readinessScore: {
    color: colors.primary,
    fontSize: 13,
    fontWeight: "800",
  },
  statusGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  statusLine: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    flexBasis: 210,
    flexDirection: "row",
    flexGrow: 1,
    gap: spacing.sm,
    minWidth: 180,
    padding: spacing.sm,
  },
  statusDot: {
    backgroundColor: colors.warning,
    borderRadius: 999,
    height: 10,
    width: 10,
  },
  statusDotDone: {
    backgroundColor: colors.success,
  },
  statusLineText: {
    flex: 1,
    gap: 2,
  },
  statusLabel: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "700",
  },
  statusDetail: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "600",
  },
  outletOverviewCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.sm,
    marginHorizontal: spacing.md,
    marginTop: spacing.md,
    padding: spacing.md,
  },
  infoRow: {
    borderBottomColor: colors.border,
    borderBottomWidth: 1,
    borderRightColor: colors.border,
    borderRightWidth: 1,
    flexBasis: 230,
    flexGrow: 1,
    gap: spacing.xs,
    minHeight: 82,
    minWidth: 180,
    padding: spacing.md,
  },
  infoLabel: {
    color: colors.muted,
    fontSize: 12,
    fontWeight: "600",
  },
  infoValue: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "600",
    lineHeight: 21,
  },
  outletActionsRow: {
    alignItems: "flex-start",
  },
  outletFormCard: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  formTitle: {
    color: colors.ink,
    fontSize: 16,
    fontWeight: "700",
  },
  formHint: {
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
  formGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  field: {
    flexBasis: 250,
    flexGrow: 1,
    gap: 6,
    minWidth: 210,
  },
  wideField: {
    flexBasis: 430,
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
  actionRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  outletList: {
    gap: spacing.sm,
  },
  outletCard: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  outletTop: {
    alignItems: "flex-start",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
  },
  outletAvatar: {
    alignItems: "center",
    backgroundColor: colors.primarySoft,
    borderRadius: 18,
    height: 42,
    justifyContent: "center",
    width: 42,
  },
  outletAvatarText: {
    color: colors.primary,
    fontSize: 15,
    fontWeight: "700",
  },
  outletInfo: {
    flex: 1,
    gap: 2,
    minWidth: 220,
  },
  outletTitleRow: {
    alignItems: "center",
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.xs,
  },
  outletTitle: {
    color: colors.ink,
    fontSize: 15,
    fontWeight: "700",
  },
  outletMeta: {
    color: colors.muted,
    fontSize: 11,
    fontWeight: "700",
  },
  outletActions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
  },
  statusPill: {
    backgroundColor: colors.successSoft,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
  },
  statusPillMuted: {
    backgroundColor: colors.warningSoft,
  },
  statusPillText: {
    color: colors.success,
    fontSize: 10,
    fontWeight: "800",
  },
  statusPillTextMuted: {
    color: colors.warning,
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
  miniPrimary: {
    backgroundColor: colors.primary,
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
  miniPrimaryText: {
    color: colors.white,
  },
});
