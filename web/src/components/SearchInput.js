import React from "react";
import { StyleSheet, TextInput, View } from "react-native";
import { colors, radii, spacing, typography } from "../constants/theme";

export function SearchInput({ disabled = false, placeholder = "Search", value, onChangeText }) {
  return (
    <View style={styles.wrap}>
      <TextInput
        editable={!disabled}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#94A3B8"
        style={[styles.input, disabled && styles.disabledInput]}
        value={value}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    width: "100%",
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    color: colors.ink,
    fontFamily: typography.baseFont,
    fontSize: typography.sizes.input,
    minHeight: 44,
    outlineColor: "transparent",
    outlineStyle: "none",
    outlineWidth: 0,
    paddingHorizontal: spacing.md,
  },
  disabledInput: {
    color: colors.muted,
    opacity: 0.65,
  },
});
