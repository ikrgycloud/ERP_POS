import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { colors, radii, spacing, typography } from "../constants/theme";

export function FilterSection({ children, hint, title }) {
  return (
    <View style={styles.section}>
      <View style={styles.header}>
        <Text style={styles.title}>{title}</Text>
        {!!hint && <Text style={styles.hint}>{hint}</Text>}
      </View>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.sm,
    padding: spacing.md,
  },
  header: {
    gap: 4,
  },
  title: {
    color: colors.ink,
    fontSize: typography.sizes.cardTitle,
    fontWeight: typography.weights.semibold,
  },
  hint: {
    color: colors.muted,
    fontSize: typography.sizes.label,
    lineHeight: typography.lineHeights.body,
  },
});
