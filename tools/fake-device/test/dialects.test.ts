import { test } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { WebSocketServer } from "ws";
import Ajv2020 from "ajv/dist/2020.js";
import { FakeDevice, speakableVersions, loadProtocolVersions, defaultProtocolVersion } from "../src/index.js";

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
  const wss = new WebSocketServer({ noServer: true, handleProtocols: () => "droidthumb.v1" });
  server.on("upgrade", (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws)));
  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as Record<string, unknown>;
      if (msg["type"] === "hello") {
        hellos.push(msg);
        ws.send(JSON.stringify({ type: "challenge", nonce: Buffer.from("nonce").toString("base64") }));
      } else if (msg["type"] === "challenge_response") {
        ws.send(JSON.stringify({ type: "welcome", accepted: true, protocol_version: hellos[0]?.["protocol_version"] }));
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

  test(`v${version}: legacyHello omits android_version and device_model and still validates`, async () => {
    await withStubServer(async (url, hellos) => {
      const device = new FakeDevice({ url, protocolVersion: version, legacyHello: true });
      await device.connect();
      device.close();
      const hello = hellos[0] as Record<string, unknown>;
      assert.equal(validateHello(hello), true, JSON.stringify(validateHello.errors));
      assert.ok(!("android_version" in hello) && !("device_model" in hello));
      const legacy = readProtocolJson(`droidthumb-protocol/examples/v${version}/hello.valid.legacy.json`);
      assert.deepEqual(Object.keys(hello).sort(), Object.keys(legacy).sort());
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
    const device = new FakeDevice({ url, deviceId: "phone-1" });
    await device.connect();
    device.close();
    await device.connect();
    device.close();
    assert.equal(hellos.length, 2);
    assert.deepEqual(hellos.map((h) => h["device_id"]), ["phone-1", "phone-1"]);
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
  const wss = new WebSocketServer({ noServer: true, handleProtocols: () => "droidthumb.v1" });
  server.on("upgrade", (req, socket, head) => wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws)));
  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      const msg = JSON.parse(String(raw)) as Record<string, unknown>;
      if (msg["type"] === "hello") ws.send(JSON.stringify({ type: "challenge", nonce: "AAAA" }));
      else if (msg["type"] === "challenge_response") ws.send(JSON.stringify({ type: "welcome", accepted: true, protocol_version: 1 }));
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
