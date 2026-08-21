import { randomUUID, timingSafeEqual } from "node:crypto";

export const CLIENT_STATES = new Set([
  "unknown",
  "idle",
  "reserved",
  "loading",
  "showing",
  "error",
]);

function safeKeyEquals(actual, expected) {
  const actualBuffer = Buffer.from(actual ?? "");
  const expectedBuffer = Buffer.from(expected ?? "");
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

export class ClientStore {
  constructor(clientConfigs, { offlineAfterMs = 20_000, now = Date.now } = {}) {
    this.offlineAfterMs = offlineAfterMs;
    this.now = now;
    this.byClientId = new Map();
    this.byStationId = new Map();

    for (const config of clientConfigs) {
      const client = {
        ...config,
        status: "unknown",
        reportedStatus: "unknown",
        birthDate: null,
        inputId: null,
        acceptedAt: null,
        lastSeenAt: null,
      };
      this.byClientId.set(client.clientId, client);
      this.byStationId.set(client.stationId, client);
    }
  }

  authenticate(clientId, apiKey) {
    const client = this.byClientId.get(clientId);
    return client && safeKeyEquals(apiKey, client.apiKey) ? client : null;
  }

  publicStatus(stationId) {
    const client = this.byStationId.get(stationId);
    if (!client) return null;

    const status = this.effectiveStatus(client);
    return {
      stationId: client.stationId,
      displayName: client.displayName,
      status,
      available: status === "idle",
    };
  }

  effectiveStatus(client) {
    if (
      client.lastSeenAt !== null &&
      this.now() - client.lastSeenAt > this.offlineAfterMs
    ) {
      return "offline";
    }
    return client.status;
  }

  claim(stationId, birthDate) {
    const client = this.byStationId.get(stationId);
    if (!client) return { ok: false, reason: "STATION_NOT_FOUND" };

    // This check-and-set block must remain synchronous. Node executes it without
    // interleaving another request, so only the first idle claim can succeed.
    if (this.effectiveStatus(client) !== "idle" || client.birthDate !== null) {
      return { ok: false, reason: "CLIENT_BUSY" };
    }

    client.status = "reserved";
    client.birthDate = birthDate;
    client.inputId = randomUUID();
    client.acceptedAt = this.now();

    return {
      ok: true,
      inputId: client.inputId,
      stationId: client.stationId,
      displayName: client.displayName,
      status: client.status,
    };
  }

  heartbeat(client, reportedStatus) {
    client.lastSeenAt = this.now();
    client.reportedStatus = reportedStatus;

    if (client.status === "reserved" && reportedStatus === "idle") {
      return this.clientSnapshot(client);
    }

    this.applyReportedState(client, reportedStatus);
    return this.clientSnapshot(client);
  }

  setState(client, nextState) {
    client.lastSeenAt = this.now();
    client.reportedStatus = nextState;
    this.applyReportedState(client, nextState);
    return this.clientSnapshot(client);
  }

  applyReportedState(client, nextState) {
    if (client.status === nextState) {
      return;
    }

    if (nextState === "idle") {
      if (client.status === "reserved") {
        throw new StateConflictError(client.status, nextState);
      }
      client.status = "idle";
      client.birthDate = null;
      client.inputId = null;
      client.acceptedAt = null;
      return;
    }

    if (nextState === "loading" && client.status !== "reserved") {
      throw new StateConflictError(client.status, nextState);
    }

    if (nextState === "showing" && client.status !== "loading") {
      throw new StateConflictError(client.status, nextState);
    }

    if (nextState === "unknown" || nextState === "reserved") {
      throw new StateConflictError(client.status, nextState);
    }

    client.status = nextState;
  }

  current(client) {
    const snapshot = this.clientSnapshot(client);
    if (!client.birthDate) {
      return { ...snapshot, hasData: false };
    }

    const [year, month, day] = client.birthDate.split("-").map(Number);
    return {
      ...snapshot,
      hasData: true,
      inputId: client.inputId,
      year,
      month,
      day,
    };
  }

  clientSnapshot(client) {
    return {
      clientId: client.clientId,
      stationId: client.stationId,
      status: this.effectiveStatus(client),
      serverStatus: client.status,
      lastSeenAt:
        client.lastSeenAt === null ? null : new Date(client.lastSeenAt).toISOString(),
    };
  }
}

export class StateConflictError extends Error {
  constructor(currentState, requestedState) {
    super(`Cannot move from ${currentState} to ${requestedState}.`);
    this.name = "StateConflictError";
    this.currentState = currentState;
    this.requestedState = requestedState;
  }
}
