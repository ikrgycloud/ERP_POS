import React from "react";
import { StyleSheet, Text, TouchableOpacity } from "react-native";
import { colors, radii, spacing, typography } from "../constants/theme";

export function AppButton({ disabled = false, label, onPress, variant = "primary" }) {
  const isGhost = variant === "ghost";

  return (
    <TouchableOpacity
      activeOpacity={disabled ? 1 : 0.85}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, isGhost && styles.ghostButton, disabled && styles.disabledButton]}
    >
      <Text style={[styles.label, isGhost && styles.ghostLabel, disabled && styles.disabledLabel]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    alignItems: "center",
    backgroundColor: colors.primary,
    borderColor: colors.primarySoft,
    borderRadius: radii.md,
    borderWidth: 1,
    justifyContent: "center",
    minHeight: 44,
    paddingHorizontal: spacing.md,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 3 },
    shadowOpacity: 0.07,
    shadowRadius: 7,
  },
  ghostButton: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.border,
    shadowOpacity: 0,
  },
  disabledButton: {
    opacity: 0.55,
  },
  label: {
    color: colors.white,
    fontFamily: typography.baseFont,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
  },
  ghostLabel: {
    color: colors.primary,
  },
  disabledLabel: {
    color: colors.muted,
  },
});
