import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const root = process.env.ERP_STATIC_ROOT || join(fileURLToPath(new URL(".", import.meta.url)), "dist");
const upstream = new URL(process.env.ERP_API_UPSTREAM || "http://erp-backend:8001");
const port = Number(process.env.PORT || 80);
const maxBodyBytes = parseSize(process.env.ERP_CLIENT_MAX_BODY_SIZE || "10m");

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".eot": "application/vnd.ms-fontobject",
};

const blockedPrefixes = [
  "/cgi-bin/",
  "/wp-admin",
  "/wp-content",
  "/wp-includes",
  "/wordpress",
  "/phpmyadmin",
  "/pma",
  "/vendor",
  "/boaform",
  "/hudson",
  "/jenkins",
  "/manager",
  "/solr",
  "/geoserver",
  "/actuator",
];
const blockedExact = new Set(["/console"]);
const assetExtensions = new Set([
  ".js",
  ".css",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".map",
  ".txt",
  ".xml",
  ".json",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".axd",
  ".cc",
  ".php",
  ".asp",
  ".aspx",
  ".jsp",
]);

createServer((req, res) => {
  const url = new URL(req.url || "/", "http://localhost");
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/uploads/")) {
    proxy(req, res, url);
    return;
  }
  serveStatic(res, url.pathname);
}).listen(port, "0.0.0.0", () => {
  console.log(`ERP frontend server listening on ${port}`);
});

function proxy(req, res, url) {
  let received = 0;
  const requestModule = upstream.protocol === "https:" ? httpsRequest : httpRequest;
  const headers = {
    ...req.headers,
    host: upstream.host,
    "x-forwarded-host": req.headers.host || "",
    "x-forwarded-proto": req.headers["x-forwarded-proto"] || "http",
  };
  const proxyReq = requestModule(
    {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port || (upstream.protocol === "https:" ? 443 : 80),
      method: req.method,
      path: `${url.pathname}${url.search}`,
      headers,
      timeout: 60_000,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res);
    },
  );
  proxyReq.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(502, { "content-type": "application/json" });
    }
    res.end(JSON.stringify({ detail: "ERP backend is unavailable" }));
  });
  req.on("data", (chunk) => {
    received += chunk.length;
    if (received > maxBodyBytes) {
      proxyReq.destroy();
      res.writeHead(413, { "content-type": "application/json" });
      res.end(JSON.stringify({ detail: "Request body is too large" }));
      req.destroy();
      return;
    }
    proxyReq.write(chunk);
  });
  req.on("end", () => proxyReq.end());
}

function serveStatic(res, pathname) {
  if (isBlocked(pathname)) {
    notFound(res);
    return;
  }
  const safePath = normalize(decodeURIComponent(pathname)).replace(/^(\.\.[/\\])+/, "");
  const requested = join(root, safePath);
  const filePath = resolveFile(requested);
  if (filePath) {
    sendFile(res, filePath);
    return;
  }
  if (assetExtensions.has(extname(pathname).toLowerCase())) {
    notFound(res);
    return;
  }
  sendFile(res, join(root, "index.html"));
}

function resolveFile(path) {
  if (existsSync(path) && statSync(path).isFile()) {
    return path;
  }
  const indexPath = join(path, "index.html");
  if (existsSync(indexPath) && statSync(indexPath).isFile()) {
    return indexPath;
  }
  return null;
}

function sendFile(res, path) {
  const extension = extname(path).toLowerCase();
  const headers = {
    "content-type": mimeTypes[extension] || "application/octet-stream",
    "x-content-type-options": "nosniff",
  };
  if (extension && path.includes(`${join(root, "_expo")}`)) {
    headers["cache-control"] = "public, max-age=31536000, immutable";
  }
  res.writeHead(200, headers);
  createReadStream(path).pipe(res);
}

function notFound(res) {
  res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  res.end("Not Found");
}

function isBlocked(pathname) {
  const lower = pathname.toLowerCase();
  if (lower.startsWith("/.") && !lower.startsWith("/.well-known")) return true;
  if (blockedExact.has(lower)) return true;
  return blockedPrefixes.some((prefix) => lower === prefix || lower.startsWith(`${prefix}/`) || lower.startsWith(prefix));
}

function parseSize(value) {
  const match = String(value).trim().toLowerCase().match(/^(\d+)([kmg])?b?$/);
  if (!match) return 10 * 1024 * 1024;
  const amount = Number(match[1]);
  const unit = match[2];
  if (unit === "g") return amount * 1024 * 1024 * 1024;
  if (unit === "m") return amount * 1024 * 1024;
  if (unit === "k") return amount * 1024;
  return amount;
}
