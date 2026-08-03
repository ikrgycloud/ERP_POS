import React, { useMemo } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors, radii, spacing, typography } from "../constants/theme";

export function PaginationControls({
  currentPage,
  onPageChange,
  pageSize = 10,
  totalCount,
  totalPages,
  label = "records",
}) {
  const pages = useMemo(() => {
    const safeTotalPages = Math.max(1, totalPages || 1);
    if (safeTotalPages <= 7) {
      return Array.from({ length: safeTotalPages }, (_, index) => index + 1);
    }

    const visible = [];
    const pushUnique = (value) => {
      if (!visible.includes(value)) {
        visible.push(value);
      }
    };

    pushUnique(1);

    const start = Math.max(2, currentPage - 1);
    const end = Math.min(safeTotalPages - 1, currentPage + 1);

    if (start > 2) {
      visible.push("ellipsis-start");
    }

    for (let page = start; page <= end; page += 1) {
      pushUnique(page);
    }

    if (end < safeTotalPages - 1) {
      visible.push("ellipsis-end");
    }

    pushUnique(safeTotalPages);
    return visible;
  }, [currentPage, totalPages]);

  if (!totalCount) {
    return null;
  }

  const safeTotalPages = Math.max(1, totalPages || 1);

  if (safeTotalPages <= 1) {
    return null;
  }

  const start = totalCount ? (currentPage - 1) * pageSize + 1 : 0;
  const end = Math.min(totalCount, currentPage * pageSize);

  return (
    <View style={styles.wrap}>
      <Text style={styles.summary}>
        Showing <Text style={styles.summaryStrong}>{start}</Text>-<Text style={styles.summaryStrong}>{end}</Text>{" "}
        of <Text style={styles.summaryStrong}>{totalCount}</Text> {label}
      </Text>

      <View style={styles.row}>
        <PagerButton disabled={currentPage <= 1} label="Prev" onPress={() => onPageChange(currentPage - 1)} />

        <View style={styles.pages}>
          {pages.map((page) =>
            page === "ellipsis-start" || page === "ellipsis-end" ? (
              <View key={page} style={styles.ellipsisWrap}>
                <Text style={styles.ellipsis}>...</Text>
              </View>
            ) : (
              <PagerButton
                key={page}
                active={page === currentPage}
                label={String(page)}
                onPress={() => onPageChange(page)}
              />
            )
          )}
        </View>

        <PagerButton
          disabled={currentPage >= safeTotalPages}
          label="Next"
          onPress={() => onPageChange(currentPage + 1)}
        />
      </View>
    </View>
  );
}

function PagerButton({ active = false, disabled = false, label, onPress }) {
  return (
    <TouchableOpacity
      activeOpacity={disabled ? 1 : 0.85}
      disabled={disabled}
      onPress={onPress}
      style={[styles.button, active && styles.activeButton, disabled && styles.disabledButton]}
    >
      <Text style={[styles.buttonText, active && styles.activeButtonText]}>{label}</Text>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
  },
  summary: {
    color: colors.muted,
    fontSize: typography.sizes.label,
    fontWeight: typography.weights.medium,
  },
  summaryStrong: {
    color: colors.ink,
    fontWeight: typography.weights.semibold,
  },
  row: {
    alignItems: "center",
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "space-between",
  },
  pages: {
    flex: 1,
    flexDirection: "row",
    gap: spacing.xs,
    justifyContent: "center",
  },
  ellipsisWrap: {
    alignItems: "center",
    justifyContent: "center",
    minWidth: 28,
  },
  ellipsis: {
    color: colors.muted,
    fontSize: 18,
    fontWeight: typography.weights.semibold,
  },
  button: {
    alignItems: "center",
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    minHeight: 36,
    minWidth: 36,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  activeButton: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  disabledButton: {
    opacity: 0.45,
  },
  buttonText: {
    color: colors.ink,
    fontSize: typography.sizes.label,
    fontWeight: typography.weights.semibold,
  },
  activeButtonText: {
    color: colors.white,
  },
});
