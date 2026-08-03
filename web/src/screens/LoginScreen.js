import React, { useState } from "react";
import { Image, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from "react-native";
import { AppButton } from "../components/AppButton";
import { colors, radii, spacing, typography } from "../constants/theme";
import { isValidEmail } from "../utils/validation";
import pudamiLogo from "../pudami logo_page-0001.jpg";

export function LoginScreen({ error, isLoading, onContinue, onOpenRegister }) {
  const [loginForm, setLoginForm] = useState({ email: "", password: "" });
  const [localError, setLocalError] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [secretTapCount, setSecretTapCount] = useState(0);
  const { width } = useWindowDimensions();
  const isWide = width >= 960;

  const updateLogin = (key, value) => {
    setLocalError("");
    setLoginForm((current) => ({ ...current, [key]: value }));
  };

  const submitLogin = () => {
    if (!isValidEmail(loginForm.email)) {
      setLocalError("Enter a valid email address");
      return;
    }
    if (!loginForm.password.trim()) {
      setLocalError("Password is required");
      return;
    }
    onContinue(loginForm);
  };

  const handleSecretLogoTap = () => {
    const nextCount = secretTapCount + 1;
    setSecretTapCount(nextCount >= 5 ? 0 : nextCount);
    if (nextCount >= 5 && onOpenRegister) {
      onOpenRegister();
    }
  };

  return (
    <View style={styles.page}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <View style={[styles.shell, isWide && styles.shellWide]}>
          <View style={styles.heroCard}>
            <View style={styles.brandRow}>
              <TouchableOpacity activeOpacity={0.9} onPress={handleSecretLogoTap} style={styles.logo}>
                <Image source={pudamiLogo} style={styles.logoImage} resizeMode="contain" />
              </TouchableOpacity>
              <View>
                <Text style={styles.brandName}>ERP Manager</Text>
                <Text style={styles.brandTag}>Business operations suite</Text>
              </View>
            </View>
            <Text style={styles.title}>Welcome back</Text>
            <Text style={styles.subtitle}>Sign in to manage inventory, orders, invoices, taxes, and reports from one elegant workspace.</Text>
          </View>

          <View style={styles.card}>
            <View style={styles.formHeading}>
              <Text style={styles.formTitle}>Secure Login</Text>
              <Text style={styles.formSubTitle}>Use your registered admin or outlet credentials.</Text>
            </View>

            <View style={styles.fieldWrap}>
              <Text style={styles.label}>Email</Text>
              <TextInput
                autoCapitalize="none"
                keyboardType="email-address"
                onChangeText={(value) => updateLogin("email", value)}
                placeholder="Enter registered email"
                placeholderTextColor="#94A3B8"
                style={[styles.input, !!localError && !isValidEmail(loginForm.email) && styles.inputError]}
                value={loginForm.email}
              />
            </View>

            <View style={styles.fieldWrap}>
              <Text style={styles.label}>Password</Text>
              <View style={styles.passwordInputWrap}>
                <TextInput
                  onChangeText={(value) => updateLogin("password", value)}
                  placeholder="Enter password"
                  placeholderTextColor="#94A3B8"
                  secureTextEntry={!showPassword}
                  style={styles.passwordInput}
                  value={loginForm.password}
                />
                <TouchableOpacity activeOpacity={0.85} onPress={() => setShowPassword((value) => !value)} style={styles.eyeButton}>
                  <Text style={styles.eyeText}>{showPassword ? "Hide" : "Show"}</Text>
                </TouchableOpacity>
              </View>
            </View>

            {!!(localError || error) && <Text style={styles.errorText}>{localError || error}</Text>}

            <AppButton label={isLoading ? "Signing in..." : "Sign In"} onPress={submitLogin} disabled={isLoading} />

            <View style={styles.securityNote}>
              <Text style={styles.securityTitle}>Protected workspace</Text>
              <Text style={styles.securityText}>Your ERP opens only after successful email and password verification.</Text>
            </View>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  page: {
    flex: 1,
    backgroundColor: colors.background,
    justifyContent: "center",
  },
  scroll: {
    flexGrow: 1,
    justifyContent: "center",
    padding: spacing.lg,
    paddingBottom: spacing.xl,
  },
  shell: {
    alignItems: "stretch",
    alignSelf: "center",
    gap: spacing.md,
    justifyContent: "center",
    maxWidth: 1180,
    width: "100%",
  },
  shellWide: {
    flexDirection: "row",
    gap: spacing.lg,
    justifyContent: "center",
    marginHorizontal: "auto",
    maxWidth: 1180,
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
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.1,
    shadowRadius: 14,
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
    borderColor: colors.border,
    borderRadius: radii.xl,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
    flex: 1,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 12,
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
  inputError: {
    borderColor: colors.danger,
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
  securityNote: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    padding: spacing.md,
  },
  securityTitle: {
    color: colors.primary,
    fontFamily: typography.baseFont,
    fontSize: 13,
    fontWeight: "700",
  },
  securityText: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 12,
    lineHeight: 18,
    marginTop: spacing.xs,
  },
});
