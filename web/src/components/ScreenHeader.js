import React from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { colors, spacing, typography } from "../constants/theme";

const iconToneStyles = {
  danger: { background: colors.dangerSoft, text: colors.danger },
  neutral: { background: colors.primarySoft, text: colors.primary },
  primary: { background: colors.primarySoft, text: colors.primary },
  success: { background: colors.successSoft, text: colors.success },
  warning: { background: colors.warningSoft, text: colors.warning },
};

export function ScreenHeader({ eyebrow, title, subtitle, iconLabel = "ERP", iconTone = "primary" }) {
  const { width } = useWindowDimensions();
  const isDesktop = width >= 960;
  const toneStyle = iconToneStyles[iconTone] || iconToneStyles.primary;

  return (
    <View style={[styles.wrap, isDesktop && styles.wrapDesktop]}>
      <View style={styles.headerRow}>
        <View style={[styles.iconBadge, { backgroundColor: toneStyle.background }]}>
          <Text style={[styles.iconText, { color: toneStyle.text }]}>{iconLabel}</Text>
        </View>
        <View style={styles.textWrap}>
          {!!eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
          <Text style={[styles.title, isDesktop && styles.titleDesktop]}>{title}</Text>
          {!!subtitle && <Text style={styles.subtitle}>{subtitle}</Text>}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  wrapDesktop: {
    paddingHorizontal: spacing.lg,
  },
  headerRow: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.md,
  },
  iconBadge: {
    alignItems: "center",
    borderRadius: 18,
    height: 46,
    justifyContent: "center",
    minWidth: 46,
    overflow: "hidden",
    paddingHorizontal: spacing.sm,
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.08,
    shadowRadius: 10,
  },
  iconText: {
    fontFamily: typography.headingFont,
    fontSize: 17,
    fontWeight: typography.weights.bold,
    letterSpacing: 0.5,
  },
  textWrap: {
    flex: 1,
    gap: spacing.xs,
  },
  eyebrow: {
    color: colors.primary,
    fontFamily: typography.baseFont,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
    letterSpacing: 0.8,
    textTransform: "uppercase",
  },
  title: {
    color: colors.ink,
    fontFamily: typography.headingFont,
    fontSize: 22,
    fontWeight: typography.weights.bold,
    lineHeight: typography.lineHeights.title,
  },
  titleDesktop: {
    fontSize: typography.sizes.pageTitle,
  },
  subtitle: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: typography.sizes.body,
    lineHeight: typography.lineHeights.body,
  },
});
