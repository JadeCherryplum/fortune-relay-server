import assert from "node:assert/strict";
import test from "node:test";
import { ClientStore, StateConflictError } from "../src/store.js";

const clientConfig = [
  {
    clientId: "client-1",
    stationId: "station-1",
    displayName: "Display 1",
    apiKey: "secret",
  },
];

test("starts unavailable until the Unity client reports idle", () => {
  const store = new ClientStore(clientConfig);
  assert.equal(store.publicStatus("station-1").status, "unknown");
  assert.equal(store.publicStatus("station-1").available, false);

  const client = store.authenticate("client-1", "secret");
  store.heartbeat(client, "idle");
  assert.equal(store.publicStatus("station-1").available, true);
});

test("accepts only the first claim while a client is idle", () => {
  const store = new ClientStore(clientConfig);
  const client = store.authenticate("client-1", "secret");
  store.heartbeat(client, "idle");

  const first = store.claim("station-1", "1995-08-21");
  const second = store.claim("station-1", "2000-01-01");

  assert.equal(first.ok, true);
  assert.deepEqual(second, { ok: false, reason: "CLIENT_BUSY" });
  assert.equal(store.current(client).year, 1995);
});

test("idle heartbeat cannot erase a newly reserved claim", () => {
  const store = new ClientStore(clientConfig);
  const client = store.authenticate("client-1", "secret");
  store.heartbeat(client, "idle");
  store.claim("station-1", "1995-08-21");

  store.heartbeat(client, "idle");
  assert.equal(store.current(client).hasData, true);
  assert.equal(store.current(client).serverStatus, "reserved");
});

test("explicit idle state cannot erase a newly reserved claim", () => {
  const store = new ClientStore(clientConfig);
  const client = store.authenticate("client-1", "secret");
  store.heartbeat(client, "idle");
  store.claim("station-1", "1995-08-21");

  assert.throws(() => store.setState(client, "idle"), StateConflictError);
  assert.equal(store.current(client).hasData, true);
});

test("normal state sequence clears personal data on idle", () => {
  const store = new ClientStore(clientConfig);
  const client = store.authenticate("client-1", "secret");
  store.heartbeat(client, "idle");
  store.claim("station-1", "1995-08-21");

  store.setState(client, "loading");
  store.setState(client, "showing");
  store.setState(client, "idle");

  assert.equal(store.current(client).hasData, false);
  assert.equal(store.publicStatus("station-1").available, true);
});

test("rejects invalid state transitions", () => {
  const store = new ClientStore(clientConfig);
  const client = store.authenticate("client-1", "secret");
  store.heartbeat(client, "idle");

  assert.throws(() => store.setState(client, "showing"), StateConflictError);
});

test("marks a silent client offline", () => {
  let now = 1_000;
  const store = new ClientStore(clientConfig, {
    offlineAfterMs: 20_000,
    now: () => now,
  });
  const client = store.authenticate("client-1", "secret");
  store.heartbeat(client, "idle");
  now += 20_001;

  assert.equal(store.publicStatus("station-1").status, "offline");
  assert.equal(store.claim("station-1", "1995-08-21").ok, false);
});
