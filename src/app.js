import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { CLIENT_STATES, ClientStore, StateConflictError } from "./store.js";

const PUBLIC_DIR = fileURLToPath(new URL("../public/", import.meta.url));
const MIME_TYPES = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".otf": "font/otf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ttf": "font/ttf",
  ".webp": "image/webp",
};

function json(res, statusCode, payload) {
  res.writeHead(statusCode, {
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(payload));
}

function error(res, statusCode, code, message) {
  json(res, statusCode, { ok: false, error: { code, message } });
}

async function readJson(req, maxBodyBytes) {
  const chunks = [];
  let length = 0;

  for await (const chunk of req) {
    length += chunk.length;
    if (length > maxBodyBytes) {
      const bodyError = new Error("Request body is too large.");
      bodyError.statusCode = 413;
      throw bodyError;
    }
    chunks.push(chunk);
  }

  if (chunks.length === 0) return {};

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    const bodyError = new Error("Request body must be valid JSON.");
    bodyError.statusCode = 400;
    throw bodyError;
  }
}

function validateBirthDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  if (year < 1900 || year > new Date().getUTCFullYear()) return false;
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function clientKey(req) {
  const authorization = req.headers.authorization ?? "";
  if (authorization.startsWith("Bearer ")) return authorization.slice(7);
  return req.headers["x-client-key"] ?? "";
}

async function serveStatic(pathname, res) {
  const isShortStationPath = /^\/[1-4]\/?$/.test(pathname);
  const requestedPath =
    pathname === "/" || isShortStationPath
      ? "thelightofwisdom.html"
      : pathname.slice(1);
  const normalizedPath = normalize(requestedPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = join(PUBLIC_DIR, normalizedPath);

  if (!filePath.startsWith(PUBLIC_DIR)) return false;

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return false;
  } catch {
    return false;
  }

  const extension = extname(filePath).toLowerCase();
  res.writeHead(200, {
    "Cache-Control": extension === ".html" ? "no-cache" : "public, max-age=3600",
    "Content-Type": MIME_TYPES[extension] ?? "application/octet-stream",
    "X-Content-Type-Options": "nosniff",
  });
  createReadStream(filePath).pipe(res);
  return true;
}

export function createApp(config) {
  const store = new ClientStore(config.clients, {
    offlineAfterMs: config.offlineAfterMs,
  });

  async function handler(req, res) {
    const url = new URL(req.url, "http://localhost");
    const path = decodeURIComponent(url.pathname);

    try {
      if (req.method === "GET" && path === "/api/health") {
        return json(res, 200, {
          ok: true,
          service: "fortunelight-server",
          serverTime: new Date().toISOString(),
        });
      }

      let match = path.match(/^\/api\/stations\/([^/]+)\/status$/);
      if (req.method === "GET" && match) {
        const station = store.publicStatus(match[1]);
        if (!station) return error(res, 404, "STATION_NOT_FOUND", "Unknown station.");
        return json(res, 200, {
          ok: true,
          station,
          pollAfterMs: 1500,
          serverTime: new Date().toISOString(),
        });
      }

      match = path.match(/^\/api\/stations\/([^/]+)\/claim$/);
      if (req.method === "POST" && match) {
        const body = await readJson(req, config.maxBodyBytes);
        if (!validateBirthDate(body.birthDate)) {
          return error(res, 422, "INVALID_BIRTH_DATE", "Enter a valid birth date.");
        }

        const result = store.claim(match[1], body.birthDate);
        if (!result.ok) {
          const status = result.reason === "STATION_NOT_FOUND" ? 404 : 409;
          return error(res, status, result.reason, "This display is not available.");
        }
        return json(res, 200, { ok: true, accepted: true, ...result });
      }

      match = path.match(/^\/api\/clients\/([^/]+)\/(heartbeat|current|state)$/);
      if (match) {
        const client = store.authenticate(match[1], clientKey(req));
        if (!client) return error(res, 401, "UNAUTHORIZED", "Invalid client credentials.");

        if (req.method === "GET" && match[2] === "current") {
          return json(res, 200, {
            ok: true,
            ...store.current(client),
            serverTime: new Date().toISOString(),
          });
        }

        if (req.method === "POST" && (match[2] === "heartbeat" || match[2] === "state")) {
          const body = await readJson(req, config.maxBodyBytes);
          if (!CLIENT_STATES.has(body.status) || ["unknown", "reserved"].includes(body.status)) {
            return error(res, 422, "INVALID_STATUS", "Unsupported client status.");
          }
          const snapshot =
            match[2] === "heartbeat"
              ? store.heartbeat(client, body.status)
              : store.setState(client, body.status);
          return json(res, 200, {
            ok: true,
            client: snapshot,
            serverTime: new Date().toISOString(),
          });
        }
      }

      if (path.startsWith("/api/")) {
        return error(res, 404, "NOT_FOUND", "API endpoint not found.");
      }

      if (req.method === "GET" && (await serveStatic(path, res))) return;
      error(res, 404, "NOT_FOUND", "Resource not found.");
    } catch (requestError) {
      if (requestError instanceof StateConflictError) {
        return error(res, 409, "INVALID_STATE_TRANSITION", requestError.message);
      }
      if (requestError.statusCode) {
        return error(res, requestError.statusCode, "INVALID_REQUEST", requestError.message);
      }
      console.error(requestError);
      return error(res, 500, "INTERNAL_ERROR", "Unexpected server error.");
    }
  }

  return { handler, store };
}
