import React from "react";
import { Platform } from "react-native";
import {
  QueryCache,
  QueryClient,
  QueryClientProvider,
  MutationCache,
  focusManager,
  onlineManager,
} from "@tanstack/react-query";

const QUERY_ERROR_EVENT = "erp:query-error";

function emitQueryError(error, context = {}) {
  if (typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(
    new CustomEvent(QUERY_ERROR_EVENT, {
      detail: {
        message: error?.message || "Request failed",
        status: error?.status || null,
        ...context,
      },
    })
  );
}

function shouldRetry(failureCount, error) {
  const status = error?.status;
  if (status === 401 || status === 403 || status === 404 || status === 422) {
    return false;
  }
  return failureCount < 2;
}

function retryDelay(attemptIndex) {
  return Math.min(1000 * 2 ** attemptIndex, 8000);
}

function installOnlineManager() {
  if (typeof window === "undefined") {
    return;
  }
  onlineManager.setEventListener((setOnline) => {
    const update = () => setOnline(window.navigator.onLine !== false);
    window.addEventListener("online", update, false);
    window.addEventListener("offline", update, false);
    update();
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  });
}

function installFocusManager() {
  if (typeof window === "undefined" || Platform.OS !== "web") {
    return;
  }
  focusManager.setEventListener((handleFocus) => {
    const onVisibilityChange = () => handleFocus(document.visibilityState === "visible");
    const onFocus = () => handleFocus(true);
    window.addEventListener("visibilitychange", onVisibilityChange, false);
    window.addEventListener("focus", onFocus, false);
    return () => {
      window.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("focus", onFocus);
    };
  });
}

installOnlineManager();
installFocusManager();

export const queryClient = new QueryClient({
  queryCache: new QueryCache({
    onError: (error, query) => emitQueryError(error, { queryKey: query?.queryKey }),
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) =>
      emitQueryError(error, { mutationKey: mutation?.options?.mutationKey }),
  }),
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: shouldRetry,
      retryDelay,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
      refetchOnMount: false,
      networkMode: "online",
    },
    mutations: {
      retry: false,
      networkMode: "online",
    },
  },
});

export function AppQueryProvider({ children }) {
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}
