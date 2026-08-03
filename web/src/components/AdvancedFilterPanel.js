import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors, radii, spacing, typography } from "../constants/theme";

export function AdvancedFilterPanel({
  activeCount = 0,
  children,
  clearLabel = "Clear all",
  isOpen,
  onClear,
  onToggle,
  title = "Advanced Filters",
}) {
  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={styles.titleWrap}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.subtitle}>
            {activeCount > 0 ? `${activeCount} active` : "No filters active"}
          </Text>
        </View>
        <View style={styles.actions}>
          <TouchableOpacity activeOpacity={0.85} onPress={onClear} style={styles.clearButton}>
            <Text style={styles.clearText}>{clearLabel}</Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.85} onPress={onToggle} style={styles.toggleButton}>
            <Text style={styles.toggleText}>{isOpen ? "Hide" : "Show"}</Text>
          </TouchableOpacity>
        </View>
      </View>
      {isOpen && <View style={styles.body}>{children}</View>}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    gap: spacing.md,
    padding: spacing.md,
  },
  header: {
    alignItems: "flex-start",
    flexDirection: "row",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  titleWrap: {
    flex: 1,
  },
  title: {
    color: colors.ink,
    fontSize: typography.sizes.cardTitle,
    fontWeight: typography.weights.semibold,
  },
  subtitle: {
    color: colors.muted,
    fontSize: typography.sizes.caption,
    marginTop: 4,
  },
  actions: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.xs,
  },
  clearButton: {
    backgroundColor: colors.dangerSoft,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  clearText: {
    color: colors.danger,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
  },
  toggleButton: {
    backgroundColor: colors.primarySoft,
    borderRadius: 999,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  toggleText: {
    color: colors.primary,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
  },
  body: {
    gap: spacing.md,
  },
});
