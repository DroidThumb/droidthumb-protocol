import { WebSocket } from "ws";
import { randomUUID, generateKeyPairSync, sign as cryptoSign, type KeyObject } from "node:crypto";
import type { Welcome, Step, Result, Error as ErrorMessage } from "droidthumb-protocol";
import { buildHello, defaultProtocolVersion } from "./dialects.js";
import { defaultCannedResponses, type CannedResponses } from "./canned.js";
import type { Override } from "./scenarios.js";

export interface FakeDeviceOptions {
  url: string;
  deviceId?: string;
  apkVersion?: string;
  /** Android API level reported in `hello`. Default 34. */
  androidVersion?: number;
  /** Hardware model reported in `hello`. Default "Fake Device". */
  deviceModel?: string;
  /**
   * Speak `hello` the way an app built before android_version/device_model existed did (omit
   * them). Such apps are still in the field, so the server must keep accepting them.
   */
  legacyHello?: boolean;
  mode?: "live" | "unattended";
  capabilities?: string[];
  /**
   * The protocol_version to speak. Defaults to `DROIDTHUMB_FAKE_PROTOCOL_VERSION` if set, else the
   * protocol's current version (`examples/protocol-versions.json`).
   */
  protocolVersion?: number;
  /** Send a message other than `hello` first, or omit fields — for negative handshake tests. */
  helloOverride?: Record<string, unknown>;
  /** Skip offering the `droidthumb.v1` subprotocol — for negative handshake tests. */
  omitSubprotocol?: boolean;
  /**
   * Skip the HTTP device-registration call before connecting (device-registration.schema.json) —
   * for testing the server's "unknown device_id" rejection path.
   */
  skipRegistration?: boolean;
  /** Override where registration is POSTed; defaults to derived from `url` (…/device -> …/devices/register). */
  registerUrl?: string;
  /** Flip a byte of the signed challenge response before sending it — for testing bad-signature rejection. */
  corruptChallengeResponse?: boolean;
}

export interface CloseInfo {
  code: number;
  reason: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function deriveRegisterUrl(wsUrl: string): string {
  return wsUrl.replace(/^ws/, "http").replace(/\/device$/, "/devices/register");
}

/**
 * A scriptable stand-in for a real DroidThumb device (plan 01 §5.4). Connects out to the
 * server's device WebSocket endpoint, performs the full device-identity handshake — HTTP
 * registration of a real EC key pair, then hello -> challenge -> challenge_response -> welcome
 * (design doc D-27) — and answers every `step` it receives with either a canned per-op result or
 * a queued scenario override.
 */
export class FakeDevice {
  private ws?: WebSocket;
  private readonly overrides = new Map<string, Override[]>();
  private readonly canned: CannedResponses;
  private readonly privateKey: KeyObject;
  private readonly publicKeyBase64: string;
  readonly deviceId: string;
  private welcomed = false;
  private registered = false;
  private connectorUrlValue: string | null = null;
  private pendingRegenerate: { resolve: (url: string) => void; reject: (err: Error) => void; timer: NodeJS.Timeout } | null = null;
  private closedInfo: CloseInfo | null = null;

  constructor(private readonly options: FakeDeviceOptions) {
    this.deviceId = options.deviceId ?? `fake-${randomUUID()}`;
    this.canned = defaultCannedResponses();
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKey = privateKey;
    this.publicKeyBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  }

  get isWelcomed(): boolean {
    return this.welcomed;
  }

  get closeInfo(): CloseInfo | null {
    return this.closedInfo;
  }

  /**
   * The phone's secret MCP connector URL: set from the registration response the one time the
   * server returns it (a device's first registration), and from every `regenerateSecret()` after.
   * Null if this device registered before and never learned it.
   */
  get connectorUrl(): string | null {
    return this.connectorUrlValue;
  }

  /**
   * Asks the server (over the authenticated connection) for a new connector secret; resolves with
   * the new URL. The previous URL stops working as soon as the server has processed the request.
   * Rejects if there is no reply within `timeoutMs` (the server ignores rate-limited requests).
   */
  regenerateSecret(timeoutMs = 5000): Promise<string> {
    const ws = this.ws;
    if (!this.welcomed || !ws) return Promise.reject(new Error("not connected"));
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRegenerate = null;
        reject(new Error("no secret_regenerated reply (rate limited, or the server ignored it)"));
      }, timeoutMs);
      this.pendingRegenerate = { resolve, reject, timer };
      ws.send(JSON.stringify({ type: "regenerate_secret" }));
    });
  }

  /** Queue a one-time behaviour override for the next `step` with this op. */
  queue(op: string, override: Override): void {
    const list = this.overrides.get(op) ?? [];
    list.push(override);
    this.overrides.set(op, list);
  }

  /**
   * Registers this device's key (POST /devices/register) without opening a WebSocket — a phone
   * that is registered but offline. Idempotent; `connect()` calls it for you.
   */
  async register(): Promise<void> {
    const registerUrl = this.options.registerUrl ?? deriveRegisterUrl(this.options.url);
    if (this.registered) return; // a reconnect: the key is already registered
    const res = await fetch(registerUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ device_id: this.deviceId, public_key: this.publicKeyBase64 }),
    });
    if (!res.ok) {
      throw new Error(`device registration failed: ${res.status} ${await res.text()}`);
    }
    this.registered = true;
    const body = (await res.json().catch(() => ({}))) as { connector_url?: unknown };
    if (typeof body.connector_url === "string") this.connectorUrlValue = body.connector_url;
  }

  private signChallenge(nonceBase64: string): string {
    const nonceBytes = Buffer.from(nonceBase64, "base64");
    const signature = cryptoSign("sha256", nonceBytes, this.privateKey);
    if (this.options.corruptChallengeResponse) {
      signature[0] = (signature[0] ?? 0) ^ 0xff;
    }
    return signature.toString("base64");
  }

  /**
   * Registers (once, unless `skipRegistration`), connects, sends `hello`, answers the server's
   * `challenge` with a real signature, and resolves with `welcome` once accepted. Rejects if the
   * connection closes (or the WS upgrade itself fails, or registration fails) before a `welcome`
   * arrives.
   */
  async connect(): Promise<Welcome> {
    // Callable again after close() — a phone reconnects with the same identity. Registration is
    // skipped the second time (same key), and handshake state starts fresh.
    this.welcomed = false;
    this.closedInfo = null;
    if (!this.options.skipRegistration) {
      await this.register();
    }
    return new Promise((resolve, reject) => {
      const protocols = this.options.omitSubprotocol ? undefined : ["droidthumb.v1"];
      const ws = new WebSocket(this.options.url, protocols);
      this.ws = ws;

      ws.once("open", () => {
        const hello = buildHello(this.options.protocolVersion ?? defaultProtocolVersion(), {
          deviceId: this.deviceId,
          apkVersion: this.options.apkVersion ?? "0.0.0-fake",
          androidVersion: this.options.androidVersion ?? 34,
          deviceModel: this.options.deviceModel ?? "Fake Device",
          capabilities: this.options.capabilities ?? [],
          mode: this.options.mode ?? "live",
          legacy: this.options.legacyHello ?? false,
        });
        const payload = this.options.helloOverride ?? hello;
        ws.send(JSON.stringify(payload));
      });

      ws.once("close", (code: number, reasonBuf: Buffer) => {
        this.closedInfo = { code, reason: reasonBuf.toString() };
        if (!this.welcomed) {
          reject(new Error(`connection closed before welcome: ${code} ${reasonBuf.toString()}`));
        }
      });

      ws.once("error", (err: Error) => {
        if (!this.welcomed) reject(err);
      });

      ws.on("message", (data: Buffer) => {
        const msg = JSON.parse(data.toString());
        if (!this.welcomed) {
          if (msg.type === "challenge") {
            const signature = this.signChallenge(msg.nonce);
            ws.send(JSON.stringify({ type: "challenge_response", signature }));
            return;
          }
          if (msg.type === "welcome") {
            this.welcomed = true;
            resolve(msg as Welcome);
          } else {
            reject(new Error(`expected challenge or welcome, got type: ${msg.type}`));
          }
          return;
        }
        if (msg.type === "step") {
          void this.handleStep(msg as Step);
        } else if (msg.type === "secret_regenerated" && this.pendingRegenerate) {
          const pending = this.pendingRegenerate;
          this.pendingRegenerate = null;
          clearTimeout(pending.timer);
          this.connectorUrlValue = msg.connector_url as string;
          pending.resolve(msg.connector_url as string);
        }
      });
    });
  }

  close(code = 1000, reason = "fake device done"): void {
    this.ws?.close(code, reason);
  }

  private send(msg: Result | ErrorMessage): void {
    this.ws?.send(JSON.stringify(msg));
  }

  private async handleStep(step: Step): Promise<void> {
    const queued = this.overrides.get(step.op);
    const override = queued && queued.length > 0 ? queued.shift() : undefined;
    await this.applyBehaviour(step, override ?? { kind: "result" });
  }

  private async applyBehaviour(step: Step, behaviour: Override): Promise<void> {
    switch (behaviour.kind) {
      case "pause":
        await delay(behaviour.ms);
        await this.applyBehaviour(step, behaviour.next ?? { kind: "result" });
        return;
      case "drop":
        this.ws?.terminate();
        return;
      case "silent":
        return;
      case "error":
        this.send({ type: "error", step_id: step.step_id, code: behaviour.code, message: behaviour.message });
        return;
      case "result": {
        const output = behaviour.output !== undefined ? behaviour.output : this.canned[step.op]?.(step.params);
        this.send({ type: "result", step_id: step.step_id, output });
        return;
      }
    }
  }
}
