import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { colors, radii, spacing } from "../constants/theme";

const ModalContext = createContext(null);

const toneMap = {
  danger: {
    accent: colors.danger,
    background: colors.dangerSoft,
    confirmBackground: colors.danger,
    confirmText: colors.white,
  },
  info: {
    accent: colors.primary,
    background: colors.primarySoft,
    confirmBackground: colors.primary,
    confirmText: colors.white,
  },
  success: {
    accent: colors.success,
    background: colors.successSoft,
    confirmBackground: colors.success,
    confirmText: colors.white,
  },
  warning: {
    accent: colors.warning,
    background: colors.warningSoft,
    confirmBackground: colors.warning,
    confirmText: colors.white,
  },
};

function fallbackResolver(kind) {
  return kind === "confirm" ? false : undefined;
}

export function ModalProvider({ children }) {
  const [request, setRequest] = useState(null);
  const resolverRef = useRef(null);

  const close = useCallback((value) => {
    const resolver = resolverRef.current;
    resolverRef.current = null;
    setRequest(null);
    resolver?.(value);
  }, []);

  const open = useCallback(
    (options) =>
      new Promise((resolve) => {
        resolverRef.current?.(fallbackResolver(request?.kind));
        resolverRef.current = resolve;
        setRequest({
          cancelLabel: "Cancel",
          confirmLabel: "OK",
          dismissible: true,
          kind: "info",
          message: "",
          title: "",
          tone: "info",
          ...options,
        });
      }),
    [request?.kind]
  );

  const modal = useMemo(
    () => ({
      confirm: (options) =>
        open({
          confirmLabel: "Confirm",
          kind: "confirm",
          tone: "warning",
          ...options,
        }),
      deleteConfirm: (options) =>
        open({
          cancelLabel: "Keep",
          confirmLabel: "Delete",
          kind: "confirm",
          tone: "danger",
          title: "Delete record?",
          ...options,
        }),
      error: (title, message) => open({ kind: "info", tone: "danger", title, message }),
      info: (title, message) => open({ kind: "info", tone: "info", title, message }),
      notification: (options) => open({ confirmLabel: "Done", kind: "info", tone: "info", ...options }),
      progress: (options) => open({ dismissible: false, kind: "progress", tone: "info", ...options }),
      success: (title, message) => open({ kind: "info", tone: "success", title, message }),
      warning: (title, message) => open({ kind: "info", tone: "warning", title, message }),
      withLoading: async (options, task) => {
        const loading = open({ dismissible: false, kind: "loading", tone: "info", ...options });
        try {
          return await task();
        } finally {
          close(undefined);
          loading.catch(() => undefined);
        }
      },
    }),
    [close, open]
  );

  useEffect(() => {
    if (!request || Platform.OS !== "web" || typeof window === "undefined") {
      return undefined;
    }
    const handleKeyDown = (event) => {
      if (event.key === "Escape" && request.dismissible) {
        close(fallbackResolver(request.kind));
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [close, request]);

  return (
    <ModalContext.Provider value={modal}>
      {children}
      <EnterpriseModal request={request} onClose={close} />
    </ModalContext.Provider>
  );
}

export function useModal() {
  const modal = useContext(ModalContext);
  if (!modal) {
    throw new Error("useModal must be used inside ModalProvider");
  }
  return modal;
}

function EnterpriseModal({ request, onClose }) {
  if (!request) {
    return null;
  }
  const tone = toneMap[request.tone] || toneMap.info;
  const isConfirm = request.kind === "confirm";
  const isLoading = request.kind === "loading";
  const isProgress = request.kind === "progress";
  const dismissValue = fallbackResolver(request.kind);
  const progressValue = Math.max(0, Math.min(100, Number(request.progress || 0)));

  return (
    <Modal
      animationType="fade"
      transparent
      visible
      onRequestClose={() => request.dismissible && onClose(dismissValue)}
    >
      <View
        style={styles.overlay}
        accessible
        accessibilityRole="alert"
        accessibilityViewIsModal
        {...(Platform.OS === "web" ? { role: "dialog", "aria-modal": true } : {})}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss dialog"
          disabled={!request.dismissible}
          onPress={() => request.dismissible && onClose(dismissValue)}
          style={StyleSheet.absoluteFill}
        />
        <View style={styles.dialog}>
          <View style={[styles.iconCircle, { backgroundColor: tone.background }]}>
            {isLoading ? (
              <ActivityIndicator color={tone.accent} />
            ) : (
              <Text style={[styles.iconText, { color: tone.accent }]}>
                {request.iconLabel || (isConfirm ? "!" : tone === toneMap.success ? "✓" : "i")}
              </Text>
            )}
          </View>
          <Text style={styles.title}>{request.title}</Text>
          {!!request.message && <Text style={styles.message}>{request.message}</Text>}
          {isProgress && (
            <View style={styles.progressTrack}>
              <View style={[styles.progressFill, { backgroundColor: tone.accent, width: `${progressValue}%` }]} />
            </View>
          )}
          {!isLoading && !isProgress && (
            <View style={styles.actions}>
              {isConfirm && (
                <TouchableOpacity activeOpacity={0.85} onPress={() => onClose(false)} style={styles.cancelButton}>
                  <Text style={styles.cancelText}>{request.cancelLabel}</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => onClose(isConfirm ? true : undefined)}
                style={[styles.confirmButton, { backgroundColor: tone.confirmBackground }]}
              >
                <Text style={[styles.confirmText, { color: tone.confirmText }]}>{request.confirmLabel}</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  actions: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: spacing.sm,
    justifyContent: "flex-end",
    marginTop: spacing.lg,
  },
  cancelButton: {
    backgroundColor: colors.background,
    borderColor: colors.border,
    borderRadius: radii.sm,
    borderWidth: 1,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  cancelText: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: "700",
  },
  confirmButton: {
    borderRadius: radii.sm,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
  },
  confirmText: {
    fontSize: 13,
    fontWeight: "700",
  },
  dialog: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderRadius: radii.lg,
    borderWidth: 1,
    maxWidth: 440,
    padding: spacing.lg,
    shadowColor: colors.shadow,
    shadowOpacity: 0.22,
    shadowRadius: 20,
    width: "92%",
  },
  iconCircle: {
    alignItems: "center",
    borderRadius: 999,
    height: 42,
    justifyContent: "center",
    marginBottom: spacing.md,
    width: 42,
  },
  iconText: {
    fontSize: 18,
    fontWeight: "700",
  },
  message: {
    color: colors.muted,
    fontSize: 14,
    lineHeight: 21,
    marginTop: spacing.sm,
  },
  overlay: {
    alignItems: "center",
    backgroundColor: "rgba(34, 48, 58, 0.38)",
    flex: 1,
    justifyContent: "center",
    padding: spacing.md,
  },
  progressFill: {
    borderRadius: 999,
    height: "100%",
  },
  progressTrack: {
    backgroundColor: colors.background,
    borderRadius: 999,
    height: 10,
    marginTop: spacing.lg,
    overflow: "hidden",
    width: "100%",
  },
  title: {
    color: colors.ink,
    fontSize: 19,
    fontWeight: "700",
  },
});
