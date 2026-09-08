import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createApp } from "../src/app.js";

const config = {
  clients: [
    {
      clientId: "client-1",
      stationId: "station-1",
      displayName: "Display 1",
      apiKey: "secret",
    },
  ],
  offlineAfterMs: 20_000,
  maxBodyBytes: 16_384,
};

async function withServer(run) {
  const { handler } = createApp(config);
  const server = createServer(handler);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();

  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

async function clientRequest(baseUrl, path, options = {}) {
  return fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      Authorization: "Bearer secret",
      "Content-Type": "application/json",
      ...options.headers,
    },
  });
}

test("runs the complete web-to-Unity lifecycle", async () => {
  await withServer(async (baseUrl) => {
    let response = await fetch(`${baseUrl}/api/stations/station-1/status`);
    let payload = await response.json();
    assert.equal(payload.station.status, "unknown");

    response = await clientRequest(baseUrl, "/api/clients/client-1/heartbeat", {
      method: "POST",
      body: JSON.stringify({ status: "idle" }),
    });
    assert.equal(response.status, 200);

    const claims = await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        fetch(`${baseUrl}/api/stations/station-1/claim`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            birthDate: `1995-08-${String(index + 1).padStart(2, "0")}`,
          }),
        }),
      ),
    );
    assert.equal(claims.filter((claim) => claim.status === 200).length, 1);
    assert.equal(claims.filter((claim) => claim.status === 409).length, 11);

    response = await clientRequest(baseUrl, "/api/clients/client-1/current");
    payload = await response.json();
    assert.equal(payload.hasData, true);
    assert.equal(payload.serverStatus, "reserved");

    for (const status of ["loading", "showing", "idle"]) {
      response = await clientRequest(baseUrl, "/api/clients/client-1/state", {
        method: "POST",
        body: JSON.stringify({ status }),
      });
      assert.equal(response.status, 200);
    }

    response = await clientRequest(baseUrl, "/api/clients/client-1/current");
    payload = await response.json();
    assert.equal(payload.hasData, false);
    assert.equal(payload.serverStatus, "idle");
  });
});

test("rejects invalid credentials and invalid birth dates", async () => {
  await withServer(async (baseUrl) => {
    const unauthorized = await fetch(`${baseUrl}/api/clients/client-1/current`);
    assert.equal(unauthorized.status, 401);

    const invalidBirthDate = await fetch(`${baseUrl}/api/stations/station-1/claim`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ birthDate: "2025-02-30" }),
    });
    assert.equal(invalidBirthDate.status, 422);
  });
});

test("serves the station page from short QR paths", async () => {
  await withServer(async (baseUrl) => {
    for (const stationNumber of [1, 2, 3, 4]) {
      const response = await fetch(`${baseUrl}/${stationNumber}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type"), /^text\/html/);
      assert.match(await response.text(), /shortStationMatch/);
    }
  });
});
