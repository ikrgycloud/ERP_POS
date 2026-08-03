import React from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors, radii, spacing, typography } from "../constants/theme";

export function FilterBar({ count, label = "records", onClear }) {
  return (
    <View style={styles.wrap}>
      <Text style={styles.countText}>
        Showing <Text style={styles.count}>{count}</Text> {label}
      </Text>
      <TouchableOpacity activeOpacity={0.85} onPress={onClear} style={styles.clearButton}>
        <Text style={styles.clearText}>Clear filters</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    flexDirection: "row",
    justifyContent: "space-between",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  countText: {
    color: colors.muted,
    fontSize: typography.sizes.label,
    fontWeight: typography.weights.medium,
  },
  count: {
    color: colors.ink,
  },
  clearButton: {
    backgroundColor: colors.primarySoft,
    borderRadius: 99,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  clearText: {
    color: colors.primary,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
  },
});
