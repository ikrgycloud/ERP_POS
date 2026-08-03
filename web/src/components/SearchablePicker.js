import React, { useMemo, useRef, useState } from "react";
import { Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View, useWindowDimensions } from "react-native";
import { colors, radii, spacing, typography } from "../constants/theme";

export function SearchablePicker({
  label,
  placeholder = "Search",
  options = [],
  activeValue,
  inputValue,
  allowCustomValue = false,
  disabled = false,
  onChange,
  onInputChange,
  searchKeys = ["label", "hint"],
  emptyText = "No results found",
  dropdownTitle = "Saved options",
  helperText,
  overlayDropdown = false,
  selectMode = false,
  showDropdownIndicator = false,
}) {
  const inputRef = useRef(null);
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [overlayAnchor, setOverlayAnchor] = useState(null);
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const usesPortalOverlay = overlayDropdown && Platform.OS === "web";
  const selectedOption = options.find((option) => String(option.value) === String(activeValue));
  const searchValue = allowCustomValue
    ? String(inputValue ?? activeValue ?? "")
    : isOpen
      ? query
      : String(selectedOption?.label || "");
  const normalizedSearchValue = searchValue.trim().toLowerCase();

  const filteredOptions = useMemo(() => {
    const normalizedQuery = normalizedSearchValue;
    if (!normalizedQuery) {
      return options;
    }
    return options.filter((option) =>
      searchKeys.some((key) => String(option[key] || "").toLowerCase().includes(normalizedQuery))
    );
  }, [normalizedSearchValue, options, searchKeys]);

  const hasExactMatch = useMemo(
    () => options.some((option) => String(option.label || "").trim().toLowerCase() === normalizedSearchValue),
    [normalizedSearchValue, options]
  );

  const closeDropdown = () => {
    setQuery("");
    setIsOpen(false);
  };

  const openDropdown = () => {
    if (disabled) return;
    setIsOpen(true);
    if (usesPortalOverlay) {
      inputRef.current?.measureInWindow?.((x, y, width, height) => {
        setOverlayAnchor({ x, y, width, height });
      });
    }
  };

  const handleSearchChange = (value) => {
    setIsOpen(true);
    if (allowCustomValue) {
      if (onInputChange) {
        onInputChange(value);
      } else {
        onChange(value);
      }
    } else {
      setQuery(value);
    }
  };

  const selectOption = (option) => {
    onChange(option.value);
    if (!allowCustomValue) {
      setQuery("");
    }
    setIsOpen(false);
  };

  const popoverWidth = Math.min(Math.max(280, overlayAnchor?.width || 320), windowWidth - spacing.md * 2);
  const popoverLeft = Math.min(Math.max(spacing.md, overlayAnchor?.x || spacing.md), windowWidth - popoverWidth - spacing.md);
  const popoverHeight = 260;
  const preferredTop = (overlayAnchor?.y || 96) + (overlayAnchor?.height || 44) + spacing.xs;
  const popoverTop = preferredTop + popoverHeight > windowHeight - spacing.md && (overlayAnchor?.y || 0) > popoverHeight
    ? Math.max(spacing.md, (overlayAnchor?.y || 0) - popoverHeight - spacing.xs)
    : preferredTop;

  const optionList = (
    <ScrollView horizontal={false} nestedScrollEnabled showsVerticalScrollIndicator={false} style={styles.list}>
      <View style={styles.optionStack}>
        {filteredOptions.length ? (
          filteredOptions.map((option) => {
            const isActive = String(option.value) === String(activeValue);
            return (
              <TouchableOpacity key={String(option.value)} activeOpacity={0.85} onPress={() => selectOption(option)} style={[styles.option, isActive && styles.activeOption]}>
                <Text style={[styles.optionLabel, isActive && styles.activeOptionLabel]} numberOfLines={1}>{option.label}</Text>
                {!!option.hint && <Text style={[styles.optionHint, isActive && styles.activeOptionHint]} numberOfLines={1}>{option.hint}</Text>}
              </TouchableOpacity>
            );
          })
        ) : (
          <View style={styles.empty}><Text style={styles.emptyText}>{emptyText}</Text></View>
        )}
        {allowCustomValue && normalizedSearchValue && !hasExactMatch ? (
          <TouchableOpacity activeOpacity={0.85} onPress={closeDropdown} style={styles.createOption}>
            <Text style={styles.createOptionText}>Use “{searchValue.trim()}” when saving</Text>
          </TouchableOpacity>
        ) : null}
      </View>
    </ScrollView>
  );

  if (selectMode && Platform.OS === "web") {
    return (
      <View style={styles.wrap}>
        {label ? <Text style={styles.label}>{label}</Text> : null}
        {React.createElement(
          "select",
          {
            "aria-label": label || placeholder,
            disabled,
            onChange: (event) => onChange(event.target.value),
            style: {
              backgroundColor: colors.background,
              border: `1px solid ${colors.border}`,
              borderRadius: radii.md,
              color: colors.ink,
              cursor: disabled ? "not-allowed" : "pointer",
              fontFamily: "inherit",
              fontSize: typography.sizes.input,
              fontWeight: 500,
              minHeight: 44,
              opacity: disabled ? 0.65 : 1,
              outline: "none",
              padding: `0 ${spacing.md}px`,
              width: "100%",
            },
            value: String(activeValue ?? ""),
          },
          options.map((option) =>
            React.createElement("option", { key: String(option.value), value: String(option.value) }, option.label)
          )
        )}
      </View>
    );
  }

  return (
    <View style={[styles.wrap, isOpen && overlayDropdown && styles.wrapOpen]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        ref={inputRef}
        editable={!disabled}
        onFocus={openDropdown}
        onChangeText={handleSearchChange}
        placeholder={placeholder}
        placeholderTextColor="#94A3B8"
        style={[styles.search, showDropdownIndicator && styles.searchWithIndicator, disabled && styles.disabled]}
        value={searchValue}
      />
      {showDropdownIndicator ? (
        <Text style={[styles.dropdownIndicator, { pointerEvents: "none" }]}>{isOpen ? "▲" : "▼"}</Text>
      ) : null}
      {helperText ? <Text style={styles.helperText}>{helperText}</Text> : null}
      {isOpen && !disabled && !usesPortalOverlay ? (
        <View style={[styles.dropdown, overlayDropdown && styles.dropdownOverlay, overlayDropdown && { top: label ? 72 : 52 }]}>
          <View style={styles.dropdownHeader}>
            <Text style={styles.dropdownTitle}>{dropdownTitle}</Text>
            <TouchableOpacity activeOpacity={0.85} onPress={closeDropdown}>
              <Text style={styles.closeText}>Close</Text>
            </TouchableOpacity>
          </View>
          {optionList}
        </View>
      ) : null}
      {isOpen && !disabled && usesPortalOverlay ? (
        <Modal transparent visible onRequestClose={closeDropdown}>
          <View style={styles.portalOverlay}>
            <Pressable accessibilityLabel="Close dropdown" onPress={closeDropdown} style={StyleSheet.absoluteFill} />
            <View style={[styles.portalPopover, { left: popoverLeft, top: popoverTop, width: popoverWidth }]}>
              <View style={styles.dropdownHeader}>
                <Text style={styles.dropdownTitle}>{dropdownTitle}</Text>
                <TouchableOpacity activeOpacity={0.85} onPress={closeDropdown}><Text style={styles.closeText}>Close</Text></TouchableOpacity>
              </View>
              <TextInput autoFocus onChangeText={handleSearchChange} placeholder="Search or type a new value" placeholderTextColor="#94A3B8" style={styles.portalSearch} value={searchValue} />
              {optionList}
            </View>
          </View>
        </Modal>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    gap: spacing.sm,
    position: "relative",
    zIndex: 1,
  },
  wrapOpen: {
    zIndex: 100,
  },
  label: {
    color: colors.muted,
    fontSize: typography.sizes.label,
    fontWeight: typography.weights.semibold,
  },
  search: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    color: colors.ink,
    fontSize: typography.sizes.input,
    minHeight: 44,
    outlineColor: "transparent",
    outlineStyle: "none",
    outlineWidth: 0,
    paddingHorizontal: spacing.md,
  },
  disabled: {
    opacity: 0.65,
  },
  searchWithIndicator: {
    paddingRight: 42,
  },
  dropdownIndicator: {
    color: colors.primaryDark,
    fontSize: 10,
    fontWeight: typography.weights.semibold,
    position: "absolute",
    right: spacing.md,
    top: 47,
    zIndex: 2,
  },
  helperText: {
    color: colors.muted,
    fontSize: 11,
    lineHeight: 15,
    marginTop: -2,
  },
  list: {
    maxHeight: 190,
  },
  dropdown: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    boxShadow: "0 16px 38px rgba(15, 23, 42, 0.18)",
    gap: spacing.sm,
    padding: spacing.sm,
    zIndex: 100,
  },
  dropdownOverlay: {
    left: 0,
    minWidth: "100%",
    position: "absolute",
    right: 0,
  },
  portalOverlay: {
    flex: 1,
  },
  portalPopover: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    boxShadow: "0 18px 44px rgba(15, 23, 42, 0.24)",
    gap: spacing.sm,
    maxHeight: 260,
    padding: spacing.sm,
    position: "absolute",
  },
  portalSearch: {
    backgroundColor: colors.background,
    borderColor: colors.primary,
    borderRadius: radii.sm,
    borderWidth: 1,
    color: colors.ink,
    fontSize: typography.sizes.input,
    minHeight: 42,
    paddingHorizontal: spacing.sm,
  },
  dropdownHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  dropdownTitle: {
    color: colors.muted,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
  },
  closeText: {
    color: colors.primary,
    fontSize: typography.sizes.label,
    fontWeight: typography.weights.semibold,
  },
  optionStack: {
    gap: spacing.xs,
  },
  option: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    width: "100%",
  },
  activeOption: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  disabledOption: {
    opacity: 0.5,
  },
  optionLabel: {
    color: colors.ink,
    fontSize: typography.sizes.label,
    fontWeight: typography.weights.medium,
  },
  optionHint: {
    color: colors.muted,
    fontSize: 10,
    marginTop: 2,
  },
  activeOptionLabel: {
    color: colors.white,
  },
  activeOptionHint: {
    color: "rgba(255,255,255,0.85)",
  },
  empty: {
    paddingVertical: spacing.md,
  },
  emptyText: {
    color: colors.muted,
    fontSize: typography.sizes.label,
    fontWeight: typography.weights.medium,
  },
  createOption: {
    backgroundColor: colors.primarySoft,
    borderColor: colors.primary,
    borderRadius: radii.md,
    borderWidth: 1,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
  },
  createOptionText: {
    color: colors.primary,
    fontSize: typography.sizes.label,
    fontWeight: typography.weights.semibold,
  },
});
