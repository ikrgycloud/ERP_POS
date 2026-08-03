import React, { useMemo, useRef, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, TextInput, TouchableOpacity, useWindowDimensions, View } from "react-native";
import { colors, radii, spacing, typography } from "../constants/theme";

export function FormField({
  disabled = false,
  error,
  helperText,
  keyboardType,
  label,
  maxLength,
  multiline,
  placeholder,
  secureTextEntry,
  state = "default",
  value,
  onChangeText,
  type,
}) {
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  const inputRef = useRef(null);
  const [calendarAnchor, setCalendarAnchor] = useState(null);
  const [showCalendar, setShowCalendar] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => monthStart(value || new Date()));
  const isDateField = type === "date" || placeholder === "YYYY-MM-DD";
  const calendarDays = useMemo(() => buildCalendarDays(visibleMonth), [visibleMonth]);
  const todayValue = toDateInputValue(new Date());
  const popoverWidth = Math.min(320, Math.max(280, windowWidth - spacing.md * 2));
  const popoverLeft = calendarAnchor
    ? clamp(calendarAnchor.x + calendarAnchor.width - popoverWidth, spacing.md, windowWidth - popoverWidth - spacing.md)
    : spacing.md;
  const preferredPopoverTop = calendarAnchor ? calendarAnchor.y + calendarAnchor.height + spacing.xs : 120;
  const popoverTop = clamp(preferredPopoverTop, spacing.md, Math.max(spacing.md, windowHeight - 380));
  const openDatePicker = () => {
    if (disabled) return;
    if (showCalendar) {
      setShowCalendar(false);
      return;
    }

    setVisibleMonth(monthStart(value || new Date()));
    setCalendarAnchor(null);
    inputRef.current?.focus?.();
    inputRef.current?.measureInWindow?.((x, y, width, height) => {
      setCalendarAnchor({ height, width, x, y });
    });
    setShowCalendar(true);
  };
  const selectDate = (date) => {
    onChangeText?.(toDateInputValue(date));
    setShowCalendar(false);
  };

  return (
    <View style={styles.wrap}>
      <Text style={[styles.label, !!error && styles.labelError]}>{label}</Text>
      <View style={styles.inputShell}>
        <TextInput
          ref={inputRef}
          editable={!disabled}
          multiline={multiline}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor="#94A3B8"
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          maxLength={maxLength}
          style={[
            styles.input,
            isDateField && styles.dateInput,
            multiline && styles.multiline,
            disabled && styles.disabledInput,
            state === "success" && styles.inputSuccess,
            state === "warning" && styles.inputWarning,
            !!error && styles.inputError,
          ]}
          value={value}
        />
        {isDateField ? (
          <TouchableOpacity
            accessibilityLabel={`Open ${label} calendar`}
            activeOpacity={0.85}
            disabled={disabled}
            onPress={openDatePicker}
            style={[styles.calendarButton, disabled && styles.disabledCalendarButton]}
          >
            <CalendarGlyph />
          </TouchableOpacity>
        ) : null}
      </View>
      {isDateField ? (
        <Modal animationType="fade" onRequestClose={() => setShowCalendar(false)} transparent visible={showCalendar}>
          <View style={styles.calendarOverlay}>
            <Pressable accessibilityLabel="Close calendar" onPress={() => setShowCalendar(false)} style={StyleSheet.absoluteFill} />
            <View style={[styles.calendarPopover, { left: popoverLeft, top: popoverTop, width: popoverWidth }]}>
              <View style={styles.calendarHeader}>
                <TouchableOpacity
                  accessibilityLabel="Previous month"
                  activeOpacity={0.85}
                  onPress={() => setVisibleMonth(addMonths(visibleMonth, -1))}
                  style={styles.monthButton}
                >
                  <Text style={styles.monthButtonText}>{"<"}</Text>
                </TouchableOpacity>
                <Text style={styles.calendarTitle}>
                  {visibleMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" })}
                </Text>
                <TouchableOpacity
                  accessibilityLabel="Next month"
                  activeOpacity={0.85}
                  onPress={() => setVisibleMonth(addMonths(visibleMonth, 1))}
                  style={styles.monthButton}
                >
                  <Text style={styles.monthButtonText}>{">"}</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.weekHeader}>
                {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => (
                  <Text key={day} style={styles.weekDay}>{day}</Text>
                ))}
              </View>
              <View style={styles.calendarGrid}>
                {calendarDays.map((day) => {
                  const dayValue = toDateInputValue(day.date);
                  const isSelected = value === dayValue;
                  const isToday = dayValue === todayValue;
                  const isPast = dayValue < todayValue;
                  return (
                    <TouchableOpacity
                      key={dayValue}
                      activeOpacity={0.82}
                      disabled={isPast}
                      onPress={() => selectDate(day.date)}
                      style={[
                        styles.calendarDay,
                        !day.inMonth && styles.calendarDayMuted,
                        isToday && styles.calendarDayToday,
                        isPast && styles.calendarDayDisabled,
                        isSelected && styles.calendarDaySelected,
                      ]}
                    >
                      <Text
                        style={[
                          styles.calendarDayText,
                          isToday && styles.calendarDayTextToday,
                          isPast && styles.calendarDayTextDisabled,
                          isSelected && styles.calendarDayTextSelected,
                        ]}
                      >
                        {day.date.getDate()}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <View style={styles.calendarFooter}>
                <TouchableOpacity activeOpacity={0.85} onPress={() => selectDate(new Date())} style={styles.todayButton}>
                  <Text style={styles.todayButtonText}>Today</Text>
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={0.85} onPress={() => setShowCalendar(false)} style={styles.closeCalendarButton}>
                  <Text style={styles.closeCalendarText}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      ) : null}
      {!!(helperText || error) && (
        <Text style={[styles.helperText, !!error && styles.errorText, state === "warning" && styles.warningText, state === "success" && styles.successText]}>
          {error || helperText}
        </Text>
      )}
    </View>
  );
}

function clamp(value, min, max) {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

function toDateInputValue(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function monthStart(value) {
  const date = value instanceof Date ? value : new Date(value);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return new Date(safeDate.getFullYear(), safeDate.getMonth(), 1);
}

function addMonths(date, offset) {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

function buildCalendarDays(monthDate) {
  const first = monthStart(monthDate);
  const start = new Date(first);
  start.setDate(first.getDate() - first.getDay());
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return { date, inMonth: date.getMonth() === first.getMonth() };
  });
}

function CalendarGlyph() {
  return (
    <View style={styles.calendarGlyph}>
      <View style={styles.calendarGlyphTop} />
      <View style={styles.calendarGlyphGrid}>
        <View style={styles.calendarGlyphDot} />
        <View style={styles.calendarGlyphDot} />
        <View style={styles.calendarGlyphDot} />
        <View style={styles.calendarGlyphDot} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    gap: spacing.xs,
    minWidth: 220,
  },
  inputShell: {
    position: "relative",
    zIndex: 1,
  },
  label: {
    color: colors.ink,
    fontFamily: typography.baseFont,
    fontSize: typography.sizes.label,
    fontWeight: typography.weights.semibold,
  },
  input: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
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
  dateInput: {
    paddingRight: 58,
  },
  calendarButton: {
    alignItems: "center",
    backgroundColor: colors.primarySoft,
    borderColor: colors.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    bottom: 6,
    justifyContent: "center",
    position: "absolute",
    right: 6,
    top: 6,
    width: 42,
  },
  disabledCalendarButton: {
    opacity: 0.55,
  },
  calendarGlyph: {
    backgroundColor: colors.surface,
    borderColor: colors.primaryDark,
    borderRadius: 4,
    borderWidth: 1.4,
    height: 18,
    overflow: "hidden",
    width: 18,
  },
  calendarGlyphTop: {
    backgroundColor: colors.primaryDark,
    height: 5,
    width: "100%",
  },
  calendarGlyphGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 2,
    paddingHorizontal: 3,
    paddingTop: 3,
  },
  calendarGlyphDot: {
    backgroundColor: colors.primaryDark,
    borderRadius: 99,
    height: 3,
    width: 3,
  },
  calendarOverlay: {
    backgroundColor: "rgba(34, 48, 58, 0.08)",
    flex: 1,
  },
  calendarPopover: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.md,
    borderWidth: 1,
    elevation: 16,
    gap: spacing.sm,
    padding: spacing.md,
    position: "absolute",
    shadowColor: colors.shadow,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.18,
    shadowRadius: 22,
    zIndex: 100,
  },
  calendarHeader: {
    alignItems: "center",
    flexDirection: "row",
    justifyContent: "space-between",
  },
  calendarTitle: {
    color: colors.ink,
    fontFamily: typography.headingFont,
    fontSize: 15,
    fontWeight: typography.weights.bold,
  },
  monthButton: {
    alignItems: "center",
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: 99,
    borderWidth: 1,
    height: 32,
    justifyContent: "center",
    width: 32,
  },
  monthButtonText: {
    color: colors.primaryDark,
    fontFamily: typography.baseFont,
    fontSize: 16,
    fontWeight: typography.weights.bold,
  },
  weekHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
  },
  weekDay: {
    color: colors.muted,
    flex: 1,
    fontFamily: typography.baseFont,
    fontSize: 10,
    fontWeight: typography.weights.bold,
    textAlign: "center",
    textTransform: "uppercase",
  },
  calendarGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
  },
  calendarDay: {
    alignItems: "center",
    borderRadius: 8,
    height: 34,
    justifyContent: "center",
    width: "14.2857%",
  },
  calendarDayMuted: {
    opacity: 0.34,
  },
  calendarDayToday: {
    borderColor: colors.primary,
    borderWidth: 1,
  },
  calendarDayDisabled: {
    backgroundColor: colors.background,
    opacity: 0.42,
  },
  calendarDaySelected: {
    backgroundColor: colors.primary,
  },
  calendarDayText: {
    color: colors.ink,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: typography.weights.semibold,
  },
  calendarDayTextToday: {
    color: colors.primaryDark,
    fontWeight: typography.weights.bold,
  },
  calendarDayTextDisabled: {
    color: colors.muted,
  },
  calendarDayTextSelected: {
    color: colors.white,
  },
  calendarFooter: {
    borderTopColor: colors.border,
    borderTopWidth: 1,
    flexDirection: "row",
    gap: spacing.sm,
    justifyContent: "flex-end",
    paddingTop: spacing.sm,
  },
  todayButton: {
    backgroundColor: colors.primarySoft,
    borderRadius: 99,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  todayButtonText: {
    color: colors.primaryDark,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: typography.weights.bold,
  },
  closeCalendarButton: {
    backgroundColor: colors.background,
    borderRadius: 99,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  closeCalendarText: {
    color: colors.muted,
    fontFamily: typography.baseFont,
    fontSize: 12,
    fontWeight: typography.weights.bold,
  },
  multiline: {
    minHeight: 86,
    paddingTop: spacing.md,
    textAlignVertical: "top",
  },
  disabledInput: {
    opacity: 0.6,
  },
  inputError: {
    borderColor: colors.danger,
  },
  inputSuccess: {
    borderColor: colors.success,
  },
  inputWarning: {
    borderColor: colors.warning,
  },
  labelError: {
    color: colors.danger,
  },
  helperText: {
    color: colors.muted,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.medium,
    marginTop: spacing.xs,
  },
  warningText: {
    color: colors.warning,
  },
  successText: {
    color: colors.success,
  },
  errorText: {
    color: colors.danger,
  },
  errorText: {
    color: colors.danger,
    fontFamily: typography.baseFont,
    fontSize: typography.sizes.caption,
    fontWeight: typography.weights.semibold,
  },
});
