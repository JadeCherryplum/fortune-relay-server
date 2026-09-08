const DEFAULT_CLIENTS = [
  {
    clientId: "by-fortune-light-01",
    stationId: "by-fortune-light-01",
    displayName: "Fortune Light 1",
    apiKey: "development-key-01",
  },
  {
    clientId: "by-fortune-light-02",
    stationId: "by-fortune-light-02",
    displayName: "Fortune Light 2",
    apiKey: "development-key-02",
  },
  {
    clientId: "by-fortune-light-03",
    stationId: "by-fortune-light-03",
    displayName: "Fortune Light 3",
    apiKey: "development-key-03",
  },
  {
    clientId: "by-fortune-light-04",
    stationId: "by-fortune-light-04",
    displayName: "Fortune Light 4",
    apiKey: "development-key-04",
  },
];

function parsePositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseClients(raw) {
  if (!raw) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("CLIENTS_JSON must be set in production.");
    }
    return DEFAULT_CLIENTS;
  }

  let clients;
  try {
    clients = JSON.parse(raw);
  } catch {
    throw new Error("CLIENTS_JSON is not valid JSON.");
  }

  if (!Array.isArray(clients) || clients.length === 0) {
    throw new Error("CLIENTS_JSON must contain at least one client.");
  }

  const clientIds = new Set();
  const stationIds = new Set();

  return clients.map((client) => {
    const normalized = {
      clientId: String(client.clientId ?? "").trim(),
      stationId: String(client.stationId ?? "").trim(),
      displayName: String(client.displayName ?? client.stationId ?? "").trim(),
      apiKey: String(client.apiKey ?? "").trim(),
    };

    if (!normalized.clientId || !normalized.stationId || !normalized.apiKey) {
      throw new Error("Every client needs clientId, stationId, and apiKey.");
    }
    if (clientIds.has(normalized.clientId) || stationIds.has(normalized.stationId)) {
      throw new Error("clientId and stationId must be unique.");
    }
    if (process.env.NODE_ENV === "production" && normalized.apiKey.length < 24) {
      throw new Error(`API key for ${normalized.clientId} must be at least 24 characters.`);
    }

    clientIds.add(normalized.clientId);
    stationIds.add(normalized.stationId);
    return normalized;
  });
}

export function loadConfig() {
  return {
    port: parsePositiveInteger(process.env.PORT, 3000),
    host: process.env.HOST || "127.0.0.1",
    trustProxy: process.env.TRUST_PROXY === "true",
    offlineAfterMs: parsePositiveInteger(process.env.OFFLINE_AFTER_MS, 20_000),
    maxBodyBytes: parsePositiveInteger(process.env.MAX_BODY_BYTES, 16_384),
    clients: parseClients(process.env.CLIENTS_JSON),
  };
}
