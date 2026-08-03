import React from "react";
import { ScrollView, StyleSheet, Text, TouchableOpacity } from "react-native";
import { colors, radii, spacing, typography } from "../constants/theme";

export function FilterChips({ activeValue, disabled = false, options, onChange }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.wrap}
    >
      {options.map((option) => {
        const isActive = activeValue === option;

        return (
          <TouchableOpacity
            key={option}
            activeOpacity={disabled ? 1 : 0.8}
            disabled={disabled}
            onPress={() => onChange(option)}
            style={[styles.chip, isActive && styles.activeChip, disabled && styles.disabledChip]}
          >
            <Text style={[styles.label, isActive && styles.activeLabel, disabled && styles.disabledLabel]}>{option}</Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
    paddingRight: spacing.md,
  },
  chip: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: 999,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  activeChip: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  disabledChip: {
    opacity: 0.55,
  },
  label: {
    color: colors.muted,
    fontSize: typography.sizes.label,
    fontWeight: typography.weights.semibold,
  },
  activeLabel: {
    color: colors.white,
  },
  disabledLabel: {
    color: colors.muted,
  },
});
