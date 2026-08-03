import React, { useEffect, useState } from "react";
import { Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { AppButton } from "../components/AppButton";
import { colors, radii, spacing, typography } from "../constants/theme";
import { cleanDigits, firstError, isValidEmail, isValidGstin, isValidIndianMobile, isValidPan, isValidPincode, requiredErrors } from "../utils/validation";
import pudamiLogo from "../pudami logo_page-0001.jpg";

const initialForm = {
  legalName: "",
  tradeName: "",
  logoText: "",
  logoUrl: "",
  ownerName: "",
  mobile: "",
  email: "",
  password: "",
  gstin: "",
  pan: "",
  cin: "",
  businessType: "",
  taxType: "Regular GST",
  currency: "INR",
  financialYear: "2026-2027",
  billingAddress: "",
  shippingAddress: "",
  city: "",
  state: "",
  pincode: "",
  bankName: "",
  accountNumber: "",
  ifsc: "",
  upiId: "",
};
const requiredFields = [
  ["legalName", "Legal name"],
  ["tradeName", "Trade name"],
  ["ownerName", "Owner name"],
  ["mobile", "Mobile"],
  ["email", "Email"],
  ["password", "Password"],
];

export function RegisterScreen({ onBackToLogin, onRegister }) {
  const [registerKey, setRegisterKey] = useState("");
  const [isKeyAccepted, setIsKeyAccepted] = useState(false);
  const [form, setForm] = useState(initialForm);
  const [showPassword, setShowPassword] = useState(false);
  const [logoAsset, setLogoAsset] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const { width } = useWindowDimensions();
  const isWide = width >= 960;

  const updateForm = (key, value) => {
    setError("");
    const sanitizedValue = ["mobile", "pincode", "accountNumber"].includes(key) ? cleanDigits(value) : value;
    setForm((current) => ({ ...current, [key]: sanitizedValue }));
  };

  useEffect(() => {
    if (!error) {
      return undefined;
    }
    const timer = setTimeout(() => setError(""), 5000);
    return () => clearTimeout(timer);
  }, [error]);

  const pickLogoFromGallery = async () => {
    setError("");
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setError("Gallery permission is required to select a logo");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      allowsEditing: true,
      aspect: [1, 1],
      mediaTypes: ["images"],
      quality: 0.82,
    });
    if (!result.canceled && result.assets?.[0]) {
      setLogoAsset(result.assets[0]);
      updateForm("logoUrl", "");
    }
  };

  const captureLogoFromCamera = async () => {
    setError("");
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setError("Camera permission is required to capture a logo");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      aspect: [1, 1],
      mediaTypes: ["images"],
      quality: 0.82,
    });
    if (!result.canceled && result.assets?.[0]) {
      setLogoAsset(result.assets[0]);
      updateForm("logoUrl", "");
    }
  };

  const unlockRegister = () => {
    if (!registerKey.trim()) {
      setError("Enter the registration key");
      return;
    }
    setError("");
    setIsKeyAccepted(true);
  };

  const submit = async () => {
    setError("");
    setMessage("");
    const errors = requiredErrors(form, requiredFields);
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
    if (!errors.password && form.password.trim().length < 6) {
      errors.password = "Password must be at least 6 characters";
    }
    const validationError = firstError(errors);
    if (validationError) {
      setError(validationError);
      return;
    }
    setIsLoading(true);
    try {
      const payload = {
        ...form,
        logoText: (form.logoText || form.tradeName?.slice(0, 8) || "ERP").trim().slice(0, 20),
        registerKey,
        role: "admin",
      };
      const result = await onRegister(payload, logoAsset);
      setMessage(
        result.logoUploadWarning ||
          `${result.tradeName || result.legalName} admin created successfully. Login with the registered email.`
      );
      setForm(initialForm);
      setLogoAsset(null);
      setRegisterKey("");
      setIsKeyAccepted(false);
    } catch (err) {
      setError(err.message || "Registration failed");
    } finally {
      setIsLoading(false);
    }
  };

  const fields = [
    ["legalName", "Legal company name", "WIEE TECH"],
    ["tradeName", "Trade name", "WIEE"],
    ["logoText", "Logo text", "WIEE"],
    ["ownerName", "Owner / admin name", "Owner name"],
    ["mobile", "Mobile", "Mobile number"],
    ["email", "Email", "admin@company.com"],
    ["gstin", "GSTIN", "GST number"],
    ["pan", "PAN", "PAN number"],
    ["cin", "CIN", "CIN if available"],
    ["businessType", "Business type", "Retailer / Manufacturer"],
    ["taxType", "Tax type", "Regular GST"],
    ["currency", "Currency", "INR"],
    ["financialYear", "Financial year", "2026-2027"],
    ["billingAddress", "Billing address", "Full billing address"],
    ["shippingAddress", "Shipping address", "Full shipping address"],
    ["city", "City", "City"],
    ["state", "State", "State"],
    ["pincode", "Pincode", "Pincode"],
    ["bankName", "Bank name", "Bank name"],
    ["accountNumber", "Account number", "Account number"],
    ["ifsc", "IFSC", "IFSC code"],
    ["upiId", "UPI ID", "UPI ID"],
  ];

  return (
    <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
      <View style={[styles.shell, isWide && styles.shellWide]}>
        <View style={styles.heroCard}>
          <View style={styles.brandRow}>
            <View style={styles.logo}>
              <Image source={pudamiLogo} style={styles.logoImage} resizeMode="contain" />
            </View>
            <View>
              <Text style={styles.brandName}>ERP Admin Register</Text>
              <Text style={styles.brandTag}>Create a new company workspace</Text>
            </View>
          </View>
          <Text style={styles.title}>New Company Setup</Text>
          <Text style={styles.subtitle}>Enter the private key first. After that, add complete admin, tax, address, and bank details.</Text>
        </View>

        <View style={styles.card}>
          {onBackToLogin && (
            <TouchableOpacity activeOpacity={0.85} onPress={onBackToLogin} style={styles.backButton}>
              <Text style={styles.backText}>Back to login</Text>
            </TouchableOpacity>
          )}
          {!isKeyAccepted ? (
            <>
              <Text style={styles.formTitle}>Registration Key</Text>
              <Text style={styles.formSubTitle}>Enter the secure key to continue. It is verified by the server when you create the admin.</Text>
              <TextInput
                onChangeText={setRegisterKey}
                placeholder="Enter registration key"
                placeholderTextColor="#94A3B8"
                secureTextEntry
                style={styles.input}
                value={registerKey}
              />
              {!!error && <Text style={styles.errorText}>{error}</Text>}
              {!!message && <Text style={styles.successText}>{message}</Text>}
              <AppButton label="Continue" onPress={unlockRegister} />
            </>
          ) : (
            <>
              <View style={styles.formHeading}>
                <Text style={styles.formTitle}>Company Admin Details</Text>
                <Text style={styles.formSubTitle}>This creates one isolated company account with its own outlets, products, orders, invoices, and reports.</Text>
              </View>

              <View style={styles.fieldWrap}>
                <Text style={styles.label}>Company logo</Text>
                <View style={styles.logoPickerCard}>
                  <View style={styles.logoPreviewBox}>
                    {logoAsset?.uri ? (
                      <Image source={{ uri: logoAsset.uri }} style={styles.logoPreviewImage} resizeMode="cover" />
                    ) : (
                      <Text style={styles.logoPreviewText}>{form.logoText || "LOGO"}</Text>
                    )}
                  </View>
                  <View style={styles.logoActionWrap}>
                    <AppButton label="Select from gallery / PC" onPress={pickLogoFromGallery} variant="ghost" />
                    <AppButton label="Take photo now" onPress={captureLogoFromCamera} variant="ghost" />
                    {logoAsset && (
                      <TouchableOpacity activeOpacity={0.85} onPress={() => setLogoAsset(null)} style={styles.removeLogoButton}>
                        <Text style={styles.removeLogoText}>Remove selected logo</Text>
                      </TouchableOpacity>
                    )}
                  </View>
                </View>
              </View>

              {fields.map(([key, label, placeholder]) => (
                <View key={key} style={styles.fieldWrap}>
                  <Text style={styles.label}>{label}</Text>
                  <TextInput
                    autoCapitalize={key === "email" ? "none" : "sentences"}
                    keyboardType={key === "email" ? "email-address" : ["mobile", "pincode", "accountNumber"].includes(key) ? "numeric" : "default"}
                    maxLength={key === "logoText" ? 20 : key === "mobile" ? 10 : key === "pincode" ? 6 : key === "accountNumber" ? 18 : undefined}
                    multiline={key.includes("Address")}
                    onChangeText={(value) => updateForm(key, value)}
                    placeholder={placeholder}
                    placeholderTextColor="#94A3B8"
                    style={[styles.input, key.includes("Address") && styles.textArea]}
                    value={form[key]}
                  />
                </View>
              ))}

              <View style={styles.fieldWrap}>
                <Text style={styles.label}>Password</Text>
                <View style={styles.passwordInputWrap}>
                  <TextInput
                    onChangeText={(value) => updateForm("password", value)}
                    placeholder="Admin password"
                    placeholderTextColor="#94A3B8"
                    secureTextEntry={!showPassword}
                    style={styles.passwordInput}
                    value={form.password}
                  />
                  <TouchableOpacity activeOpacity={0.85} onPress={() => setShowPassword((value) => !value)} style={styles.eyeButton}>
                    <Text style={styles.eyeText}>{showPassword ? "Hide" : "Show"}</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {!!error && <Text style={styles.errorText}>{error}</Text>}
              {!!message && <Text style={styles.successText}>{message}</Text>}
              <AppButton label={isLoading ? "Creating admin..." : "Create Admin"} onPress={submit} disabled={isLoading} />
            </>
          )}
        </View>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 1,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  shell: {
    alignItems: "stretch",
    gap: spacing.md,
  },
  shellWide: {
    flexDirection: "row",
    gap: spacing.lg,
    justifyContent: "center",
    marginHorizontal: "auto",
    maxWidth: 1240,
    width: "100%",
  },
  heroCard: {
    backgroundColor: colors.primaryDark,
    borderColor: colors.border,
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.lg,
    flex: 1,
  },
  brandRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  logo: {
    alignItems: "center",
    backgroundColor: colors.white,
    borderRadius: 22,
    height: 58,
    justifyContent: "center",
    overflow: "hidden",
    width: 58,
  },
  logoImage: {
    height: 52,
    width: 52,
  },
  brandName: {
    color: colors.white,
    fontFamily: typography.headingFont,
    fontSize: 18,
    fontWeight: "700",
  },
  brandTag: {
    color: "#CBD5E1",
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: "700",
    marginTop: 2,
  },
  title: {
    color: colors.white,
    fontFamily: typography.headingFont,
    fontSize: typography.sizes.pageTitle,
    fontWeight: "700",
    lineHeight: typography.lineHeights.title,
  },
  subtitle: {
    color: "#CBD5E1",
    fontFamily: typography.baseFont,
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radii.xl,
    gap: spacing.md,
    padding: spacing.md,
    flex: 1,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.08,
    shadowRadius: 18,
  },
  formHeading: {
    gap: spacing.xs,
  },
  formTitle: {
    color: colors.ink,
    fontFamily: typography.headingFont,
    fontSize: typography.sizes.sectionTitle,
    fontWeight: typography.weights.semibold,
  },
  formSubTitle: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 13,
    lineHeight: 19,
  },
  fieldWrap: {
    gap: spacing.xs,
  },
  label: {
    color: colors.ink,
    fontFamily: typography.baseFont,
    fontSize: typography.sizes.label,
    fontWeight: typography.weights.semibold,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: typography.baseFont,
    fontSize: typography.sizes.input,
    minHeight: 44,
    paddingHorizontal: spacing.md,
  },
  textArea: {
    minHeight: 86,
    paddingTop: spacing.sm,
  },
  passwordInputWrap: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    minHeight: 44,
  },
  passwordInput: {
    color: colors.ink,
    flex: 1,
    fontFamily: typography.baseFont,
    fontSize: typography.sizes.input,
    paddingHorizontal: spacing.md,
  },
  eyeButton: {
    backgroundColor: colors.primarySoft,
    borderRadius: 12,
    marginRight: spacing.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  eyeText: {
    color: colors.primary,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: "700",
  },
  errorText: {
    color: colors.danger,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  successText: {
    color: colors.success,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: "700",
    textAlign: "center",
  },
  logoPickerCard: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  logoPreviewBox: {
    alignItems: "center",
    alignSelf: "flex-start",
    backgroundColor: colors.white,
    borderColor: colors.border,
    borderRadius: 18,
    borderWidth: 1,
    height: 86,
    justifyContent: "center",
    overflow: "hidden",
    width: 86,
  },
  logoPreviewImage: {
    height: "100%",
    width: "100%",
  },
  logoPreviewText: {
    color: colors.primary,
    fontFamily: typography.headingFont,
    fontSize: 16,
    fontWeight: "700",
  },
  logoActionWrap: {
    gap: spacing.sm,
  },
  removeLogoButton: {
    alignSelf: "flex-start",
    paddingVertical: spacing.xs,
  },
  removeLogoText: {
    color: colors.danger,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: "700",
  },
  backButton: {
    alignSelf: "flex-start",
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  backText: {
    color: colors.primary,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: "700",
  },
});
