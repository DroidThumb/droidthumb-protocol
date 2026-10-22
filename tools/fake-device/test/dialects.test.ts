import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { WebSocketServer } from "ws";
import Ajv2020 from "ajv/dist/2020.js";
import { FakeDevice, speakableVersions, loadProtocolVersions, defaultProtocolVersion, defaultCannedResponses } from "../src/index.js";
import { SUBPROTOCOL } from "droidthumb-protocol";

const require = createRequire(import.meta.url);

function readProtocolJson(spec: string): Record<string, unknown> {
  return JSON.parse(readFileSync(require.resolve(spec), "utf-8")) as Record<string, unknown>;
}

const validateHello = new Ajv2020({ strict: true }).compile(readProtocolJson("droidthumb-protocol/schema/hello.schema.json"));

/** A stand-in for droidthumb-server: accepts registration, records `hello`, completes the handshake. */
async function withStubServer<T>(fn: (url: string, hellos: Record<string, unknown>[]) => Promise<T>): Promise<T> {
  const hellos: Record<string, unknown>[] = [];
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/devices/register") {
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true, handleProtocols: () => SUBPROTOCOL });
  server.on("upgrade", (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws)));
  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as Record<string, unknown>;
      if (msg["type"] === "hello") {
        hellos.push(msg);
        ws.send(JSON.stringify({ type: "challenge", nonce: Buffer.from("nonce").toString("base64") }));
      } else if (msg["type"] === "challenge_response") {
        ws.send(JSON.stringify({ type: "welcome", accepted: true, protocol_version: hellos[0]?.["protocol_version"], accounts: true, account_id: null }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (typeof addr !== "object" || addr === null) throw new Error("expected AddressInfo");
  try {
    return await fn(`ws://127.0.0.1:${addr.port}/device`, hellos);
  } finally {
    wss.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("the fake device can speak every supported protocol version", () => {
  const { supported } = loadProtocolVersions();
  const speakable = speakableVersions();
  for (const version of supported) {
    assert.ok(speakable.includes(version), `no fake-device dialect for supported protocol_version ${version}`);
  }
});

for (const version of loadProtocolVersions().supported) {
  test(`v${version}: hello on the wire validates and matches the protocol's own example`, async () => {
    await withStubServer(async (url, hellos) => {
      const device = new FakeDevice({ url, protocolVersion: version, apkVersion: "1.2.3", androidVersion: 34, deviceModel: "Test Phone" });
      await device.connect();
      device.close();
      const hello = hellos[0] as Record<string, unknown>;
      assert.equal(validateHello(hello), true, JSON.stringify(validateHello.errors));
      assert.equal(hello["protocol_version"], version);
      assert.equal(hello["android_version"], 34);
      assert.equal(hello["device_model"], "Test Phone");
      const example = readProtocolJson(`droidthumb-protocol/examples/v${version}/hello.valid.json`);
      assert.deepEqual(Object.keys(hello).sort(), Object.keys(example).sort());
    });
  });
}

test("an unknown protocol version is sent as asked, in the newest dialect's shape (for negative tests)", async () => {
  await withStubServer(async (url, hellos) => {
    const device = new FakeDevice({ url, protocolVersion: 99 });
    await device.connect();
    device.close();
    assert.equal(hellos[0]?.["protocol_version"], 99);
  });
});

test("DROIDTHUMB_FAKE_PROTOCOL_VERSION sets the default; without it the default is the protocol's current", () => {
  const saved = process.env["DROIDTHUMB_FAKE_PROTOCOL_VERSION"];
  try {
    delete process.env["DROIDTHUMB_FAKE_PROTOCOL_VERSION"];
    assert.equal(defaultProtocolVersion(), loadProtocolVersions().current);
    process.env["DROIDTHUMB_FAKE_PROTOCOL_VERSION"] = "7";
    assert.equal(defaultProtocolVersion(), 7);
    process.env["DROIDTHUMB_FAKE_PROTOCOL_VERSION"] = "banana";
    assert.throws(() => defaultProtocolVersion(), /positive integer/);
  } finally {
    if (saved === undefined) delete process.env["DROIDTHUMB_FAKE_PROTOCOL_VERSION"];
    else process.env["DROIDTHUMB_FAKE_PROTOCOL_VERSION"] = saved;
  }
});

test("connect() can be called again after close(), reusing the same identity", async () => {
  await withStubServer(async (url, hellos) => {
    const device = new FakeDevice({ url });
    await device.connect();
    device.close();
    await device.connect();
    device.close();
    assert.equal(hellos.length, 2);
    assert.deepEqual(hellos.map((h) => h["device_id"]), [device.deviceId, device.deviceId]);
  });
});

test("registration returns the connector URL once; regenerateSecret() replaces it over the open connection", async () => {
  const registered: string[] = [];
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/devices/register") {
      registered.push("x");
      const body = registered.length === 1 ? { device_id: "p", connector_url: "https://example.test/d/dtk_first/mcp" } : { device_id: "p" };
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true, handleProtocols: () => SUBPROTOCOL });
  server.on("upgrade", (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws)));
  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as Record<string, unknown>;
      if (msg["type"] === "hello") ws.send(JSON.stringify({ type: "challenge", nonce: "AAAA" }));
      else if (msg["type"] === "challenge_response") ws.send(JSON.stringify({ type: "welcome", accepted: true, protocol_version: 2, accounts: true, account_id: null }));
      else if (msg["type"] === "regenerate_secret") {
        ws.send(JSON.stringify({ type: "secret_regenerated", connector_url: "https://example.test/d/dtk_second/mcp" }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (typeof addr !== "object" || addr === null) throw new Error("expected AddressInfo");
  try {
    const device = new FakeDevice({ url: `ws://127.0.0.1:${addr.port}/device` });
    await device.connect();
    assert.equal(device.connectorUrl, "https://example.test/d/dtk_first/mcp");
    assert.equal(await device.regenerateSecret(), "https://example.test/d/dtk_second/mcp");
    assert.equal(device.connectorUrl, "https://example.test/d/dtk_second/mcp");
    device.close();
  } finally {
    wss.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("regenerateSecret() rejects when not connected", async () => {
  const device = new FakeDevice({ url: "ws://127.0.0.1:1/device" });
  await assert.rejects(device.regenerateSecret(), /not connected/);
});

test("signIn() resolves with account_id on `signed_in`, rejects with the reason on `sign_in_rejected`", async () => {
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/devices/register") {
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true, handleProtocols: () => SUBPROTOCOL });
  server.on("upgrade", (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws)));
  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as Record<string, unknown>;
      if (msg["type"] === "hello") ws.send(JSON.stringify({ type: "challenge", nonce: "AAAA" }));
      else if (msg["type"] === "challenge_response") ws.send(JSON.stringify({ type: "welcome", accepted: true, protocol_version: 2, accounts: true, account_id: null }));
      else if (msg["type"] === "sign_in") {
        const token = msg["account_token"] as string;
        if (token === "good-token") ws.send(JSON.stringify({ type: "signed_in", account_id: "acc_test" }));
        else ws.send(JSON.stringify({ type: "sign_in_rejected", reason: "invalid_token" }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (typeof addr !== "object" || addr === null) throw new Error("expected AddressInfo");
  try {
    const device = new FakeDevice({ url: `ws://127.0.0.1:${addr.port}/device` });
    await device.connect();
    assert.equal(device.signedInAccountId, null);
    assert.equal(await device.signIn("good-token", "hint-1"), "acc_test");
    assert.equal(device.signedInAccountId, "acc_test");

    const other = new FakeDevice({ url: `ws://127.0.0.1:${addr.port}/device` });
    await other.connect();
    await assert.rejects(other.signIn("bad-token", "hint-2"), /invalid_token/);
    assert.equal(other.signedInAccountId, null);
    other.close();
    device.close();
  } finally {
    wss.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("signIn() rejects when not connected", async () => {
  const device = new FakeDevice({ url: "ws://127.0.0.1:1/device" });
  await assert.rejects(device.signIn("x", "hint"), /not connected/);
});

test("signOut() resolves on `signed_out` and clears the signed-in account", async () => {
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/devices/register") {
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true, handleProtocols: () => SUBPROTOCOL });
  server.on("upgrade", (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws)));
  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as Record<string, unknown>;
      if (msg["type"] === "hello") ws.send(JSON.stringify({ type: "challenge", nonce: "AAAA" }));
      else if (msg["type"] === "challenge_response") ws.send(JSON.stringify({ type: "welcome", accepted: true, protocol_version: 2, accounts: true, account_id: null }));
      else if (msg["type"] === "sign_in") ws.send(JSON.stringify({ type: "signed_in", account_id: "acc_test" }));
      else if (msg["type"] === "sign_out") ws.send(JSON.stringify({ type: "signed_out" }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (typeof addr !== "object" || addr === null) throw new Error("expected AddressInfo");
  try {
    const device = new FakeDevice({ url: `ws://127.0.0.1:${addr.port}/device` });
    await device.connect();
    await device.signIn("good-token", "hint-1");
    assert.equal(device.signedInAccountId, "acc_test");
    await device.signOut();
    assert.equal(device.signedInAccountId, null);
    // Already signed out: the server still replies `signed_out`, and signOut() succeeds.
    await device.signOut();
    assert.equal(device.signedInAccountId, null);
    device.close();
  } finally {
    wss.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("signOut() rejects when not connected", async () => {
  const device = new FakeDevice({ url: "ws://127.0.0.1:1/device" });
  await assert.rejects(device.signOut(), /not connected/);
});

test("a server without accounts (welcome accounts: false) rejects sign_in with accounts_unsupported", async () => {
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/devices/register") {
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true, handleProtocols: () => SUBPROTOCOL });
  server.on("upgrade", (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws)));
  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as Record<string, unknown>;
      if (msg["type"] === "hello") ws.send(JSON.stringify({ type: "challenge", nonce: "AAAA" }));
      else if (msg["type"] === "challenge_response")
        ws.send(JSON.stringify({ type: "welcome", accepted: true, protocol_version: 2, accounts: false, account_id: null }));
      else if (msg["type"] === "sign_in") ws.send(JSON.stringify({ type: "sign_in_rejected", reason: "accounts_unsupported" }));
      else if (msg["type"] === "sign_out") ws.send(JSON.stringify({ type: "signed_out" }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (typeof addr !== "object" || addr === null) throw new Error("expected AddressInfo");
  try {
    const device = new FakeDevice({ url: `ws://127.0.0.1:${addr.port}/device` });
    await device.connect();
    await assert.rejects(device.signIn("good-token", "hint-1"), /accounts_unsupported/);
    assert.equal(device.signedInAccountId, null);
    // Sign-out still works on a server without accounts: the server replies `signed_out`.
    await device.signOut();
    device.close();
  } finally {
    wss.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("signIn() sends install_hint always and replace_device_id when given; list/revoke AI connections round-trip", async () => {
  const sent: Record<string, unknown>[] = [];
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/devices/register") {
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true, handleProtocols: () => SUBPROTOCOL });
  server.on("upgrade", (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws)));
  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as Record<string, unknown>;
      sent.push(msg);
      if (msg["type"] === "hello") ws.send(JSON.stringify({ type: "challenge", nonce: "AAAA" }));
      else if (msg["type"] === "challenge_response")
        ws.send(JSON.stringify({ type: "welcome", accepted: true, protocol_version: 2, accounts: true, account_id: null }));
      else if (msg["type"] === "sign_in") {
        if (msg["replace_device_id"] === "dt_missing")
          ws.send(JSON.stringify({ type: "sign_in_rejected", reason: "unknown_device" }));
        else if (msg["replace_device_id"] === "dt_at_limit")
          ws.send(
            JSON.stringify({
              type: "sign_in_rejected",
              reason: "device_limit_reached",
              devices: [{ device_id: "dt_x", name: "Old phone", model: "OnePlus Nord", last_seen: "2026-10-21T09:30:00Z" }],
            }),
          );
        else ws.send(JSON.stringify({ type: "signed_in", account_id: "acc_test" }));
      } else if (msg["type"] === "list_ai_connections") {
        if (msg["type"] === "list_ai_connections" && ws === null) return;
        ws.send(
          JSON.stringify({
            type: "ai_connections_list",
            ok: true,
            connections: [
              {
                client_id: "cl_1",
                client_name: "Claude",
                display_name: "Claude",
                image_url: null,
                connected_at: "2026-09-30T12:00:00Z",
                last_used_at: null,
              },
            ],
          }),
        );
      } else if (msg["type"] === "revoke_ai_connection") {
        if (msg["connection_id"] === "cl_1") ws.send(JSON.stringify({ type: "ai_connection_revoked", ok: true }));
        else if (msg["connection_id"] === "cl_signed_out")
          ws.send(JSON.stringify({ type: "ai_connection_revoked", ok: false, error: { code: "not_signed_in" } }));
        else ws.send(JSON.stringify({ type: "ai_connection_revoked", ok: false, error: { code: "not_found" } }));
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (typeof addr !== "object" || addr === null) throw new Error("expected AddressInfo");
  try {
    const device = new FakeDevice({ url: `ws://127.0.0.1:${addr.port}/device` });
    await device.connect();

    // sign_in: install_hint always present; replace_device_id only when asked.
    await device.signIn("good-token", "hint-1");
    const plainSignIn = sent.find((m) => m["type"] === "sign_in" && m["install_hint"] === "hint-1");
    assert.ok(plainSignIn, "sign_in sent with install_hint");
    assert.ok(!("replace_device_id" in (plainSignIn as object)), "no replace_device_id unless asked");

    // device_limit_rejected carries devices; unknown_device for a bad replace id.
    await assert.rejects(device.signIn("t", "h", 5000, "dt_at_limit"), /device_limit_reached/);
    await assert.rejects(device.signIn("t", "h", 5000, "dt_missing"), /unknown_device/);

    // AI connections: list, revoke ok, not_found, not_signed_in.
    const connections = await device.listAiConnections();
    assert.equal(connections.length, 1);
    assert.equal(connections[0]?.client_id, "cl_1");
    assert.equal(connections[0]?.last_used_at, null);
    await device.revokeAiConnection("cl_1");
    await assert.rejects(device.revokeAiConnection("cl_nope"), /not_found/);
    await assert.rejects(device.revokeAiConnection("cl_signed_out"), /not_signed_in/);
    device.close();
  } finally {
    wss.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("a locked device answers device_locked for every step; type_text without a submit action answers submit_unsupported", async () => {
  const server = http.createServer((req, res) => {
    if (req.method === "POST" && req.url === "/devices/register") {
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
      return;
    }
    res.writeHead(404).end();
  });
  const wss = new WebSocketServer({ noServer: true, handleProtocols: () => SUBPROTOCOL });
  server.on("upgrade", (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws)));
  const steps: { step_id: string; op: string }[] = [];
  const responses: Record<string, unknown>[] = [];
  let serverWs: import("ws").WebSocket | undefined;
  wss.on("connection", (ws) => {
    serverWs = ws;
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as Record<string, unknown>;
      if (msg["type"] === "hello") ws.send(JSON.stringify({ type: "challenge", nonce: "AAAA" }));
      else if (msg["type"] === "challenge_response")
        ws.send(JSON.stringify({ type: "welcome", accepted: true, protocol_version: 2, accounts: true, account_id: null }));
      else if (msg["type"] === "result" || msg["type"] === "error") responses.push(msg);
    });
  });
  const sendStep = (id: string, op: string, params: Record<string, unknown>) =>
    serverWs?.send(JSON.stringify({ type: "step", step_id: id, op, params }));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (typeof addr !== "object" || addr === null) throw new Error("expected AddressInfo");
  try {
    const lockedDevice = new FakeDevice({ url: `ws://127.0.0.1:${addr.port}/device`, locked: true });
    await lockedDevice.connect();
    if (!serverWs) throw new Error("no server websocket");
    sendStep("s1", "read_screen", {});
    sendStep("s2", "tap", { selector: { text: "x" } });
    sendStep("s3", "launch_app", { package: "com.example" });
    await new Promise((r) => setTimeout(r, 300));
    const errors = responses.filter((r) => r["type"] === "error");
    assert.equal(errors.length, 3, "every step errored while locked");
    for (const e of errors) assert.equal(e["code"], "device_locked");
    lockedDevice.close();

    responses.length = 0;
    const noSubmit = new FakeDevice({ url: `ws://127.0.0.1:${addr.port}/device`, typeTextSupportsSubmit: false });
    await noSubmit.connect();
    sendStep("s4", "type_text", { text: "hello", submit: true });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(responses[0]?.["type"], "error");
    assert.equal(responses[0]?.["code"], "submit_unsupported");
    noSubmit.close();

    responses.length = 0;
    const device = new FakeDevice({ url: `ws://127.0.0.1:${addr.port}/device` });
    await device.connect();
    sendStep("s5", "type_text", { text: "hello", submit: true });
    await new Promise((r) => setTimeout(r, 300));
    assert.equal(responses[0]?.["type"], "result");
    device.close();
  } finally {
    wss.close();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

test("read_screen's canned output carries locked: false when unlocked", async () => {
  const canned = defaultCannedResponses();
  const output = canned["read_screen"]?.({}) as { locked?: boolean };
  assert.equal(output?.locked, false);
});

test("the device id is derived from the key: dt_ + hex SHA-256 of the SPKI DER, and registration sends only the key", async () => {
  const { createHash } = await import("node:crypto");
  const bodies: Record<string, unknown>[] = [];
  const server = http.createServer((req, res) => {
    let raw = "";
    req.on("data", (c) => (raw += c));
    req.on("end", () => {
      bodies.push(JSON.parse(raw) as Record<string, unknown>);
      res.writeHead(200, { "content-type": "application/json" }).end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  if (typeof addr !== "object" || addr === null) throw new Error("expected AddressInfo");
  try {
    const device = new FakeDevice({ url: `ws://127.0.0.1:${addr.port}/device` });
    await device.register();
    const body = bodies[0] as { public_key: string; device_id?: string };
    assert.deepEqual(Object.keys(body), ["public_key"], "the request must not carry a device id");
    const expected = `dt_${createHash("sha256").update(Buffer.from(body.public_key, "base64")).digest("hex")}`;
    assert.equal(device.deviceId, expected);
    assert.notEqual(new FakeDevice({ url: "ws://x/device" }).deviceId, device.deviceId, "each key has its own id");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
