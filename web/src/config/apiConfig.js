const DEFAULT_API_PORT = process.env.EXPO_PUBLIC_API_PORT || "8001";
const DEFAULT_API_VERSION_PATH = process.env.EXPO_PUBLIC_API_VERSION_PATH || "/api/v1";

function cleanUrl(value) {
  return String(value || "").trim().replace(/\/$/, "");
}

function isLoopbackHost(host) {
  return ["localhost", "127.0.0.1", "0.0.0.0"].includes(host);
}

function isLanHost(host) {
  return /^(10|172\.(1[6-9]|2\d|3[0-1])|192\.168)\./.test(host);
}

function resolveApiBaseUrl() {
  const configured = cleanUrl(process.env.EXPO_PUBLIC_API_URL);
  if (["same-origin", "relative", "/"].includes(configured.toLowerCase())) {
    return "";
  }
  if (configured && configured.toLowerCase() !== "auto") {
    return configured.replace(/\/api\/v1\/?$/, "");
  }
  if (typeof window !== "undefined") {
    const queryApi = new URLSearchParams(window.location.search).get("api");
    if (queryApi) {
      return cleanUrl(queryApi).replace(/\/api\/v1\/?$/, "");
    }
    if (!isLoopbackHost(window.location.hostname) && !isLanHost(window.location.hostname)) {
      return "";
    }
    return `${window.location.protocol}//${window.location.hostname}:${DEFAULT_API_PORT}`;
  }
  return `http://localhost:${DEFAULT_API_PORT}`;
}

export const API_ROOT_URL = resolveApiBaseUrl();
export const API_BASE_URL = `${API_ROOT_URL}${DEFAULT_API_VERSION_PATH}`.replace(/\/$/, "");
