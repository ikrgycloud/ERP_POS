import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, radii, spacing, typography } from "../constants/theme";

const toneColors = {
  danger: colors.dangerSoft,
  primary: colors.primarySoft,
  success: colors.successSoft,
  warning: colors.warningSoft,
};

const toneTextColors = {
  danger: colors.danger,
  primary: colors.primary,
  success: colors.success,
  warning: colors.warning,
};

const iconLabels = {
  "alert-circle-outline": "!",
  "analytics-outline": "A",
  "cash-outline": "₹",
  "layers-outline": "L",
  "receipt-outline": "R",
  "trending-up-outline": "↑",
  "wallet-outline": "W",
};

export function MetricCard({ basis = "100%", caption, icon = "analytics-outline", label, tone = "primary", value }) {
  return (
    <View style={[styles.card, { flexBasis: basis }]}>
      <View style={[styles.dot, { backgroundColor: toneColors[tone] }]}>
        <Text style={[styles.iconFallback, { color: toneTextColors[tone] }]}>
          {iconLabels[icon] || label?.slice(0, 1) || "•"}
        </Text>
      </View>
      <Text style={styles.label}>{label}</Text>
      <Text adjustsFontSizeToFit minimumFontScale={0.78} numberOfLines={1} style={styles.value}>{value}</Text>
      {!!caption && <Text style={styles.caption}>{caption}</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    flexGrow: 0,
    minHeight: 140,
    minWidth: 0,
    padding: spacing.md,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
  },
  dot: {
    alignItems: "center",
    borderRadius: 12,
    height: 24,
    justifyContent: "center",
    marginBottom: spacing.sm,
    width: 24,
  },
  iconFallback: {
    fontFamily: typography.baseFont,
    fontSize: typography.sizes.body,
    fontWeight: typography.weights.semibold,
    lineHeight: 16,
  },
  label: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: typography.sizes.label,
    fontWeight: typography.weights.medium,
  },
  value: {
    color: colors.ink,
    fontFamily: typography.headingFont,
    fontSize: 20,
    fontWeight: typography.weights.bold,
    marginTop: spacing.xs,
  },
  caption: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: typography.sizes.caption,
    marginTop: spacing.xs,
  },
});
