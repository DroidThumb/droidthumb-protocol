import { WebSocket } from "ws";
import { generateKeyPairSync, createHash, sign as cryptoSign, type KeyObject } from "node:crypto";
import type { Welcome, Step, Result, Error as ErrorMessage } from "droidthumb-protocol";
import { SUBPROTOCOL } from "droidthumb-protocol";
import { buildHello, defaultProtocolVersion } from "./dialects.js";
import { defaultCannedResponses, type CannedResponses } from "./canned.js";
import type { Override } from "./scenarios.js";

/** The `output` shape `Result` carries (a generated type; repeated here as a narrow alias). */
type ResultOutput = NonNullable<Result["output"]>;

export interface FakeDeviceOptions {
  url: string;
  /**
   * What `hello` claims as device_id, for negative tests only (e.g. an id that isn't derived from
   * the key). Default: the id derived from this device's own key, which is the only one a server
   * accepts. The registration request never carries an id.
   */
  helloDeviceId?: string;
  apkVersion?: string;
  /** Android API level reported in `hello`. Default 34. */
  androidVersion?: number;
  /** Hardware model reported in `hello`. Default "Fake Device". */
  deviceModel?: string;
  mode?: "live" | "unattended";
  capabilities?: string[];
  /**
   * Simulate a locked phone: every step's canned result becomes a `device_locked` error and
   * `read_screen`'s output would carry `locked: true`. Default false.
   */
  locked?: boolean;
  /**
   * Whether the fixture keyboard has a send/search action for `type_text`'s `submit`. Default
   * true; set false to simulate a field whose keyboard can't submit (the device answers
   * `submit_unsupported`).
   */
  typeTextSupportsSubmit?: boolean;
  /**
   * The protocol_version to speak. Defaults to `DROIDTHUMB_FAKE_PROTOCOL_VERSION` if set, else the
   * protocol's current version (`examples/protocol-versions.json`).
   */
  protocolVersion?: number;
  /** Send a message other than `hello` first, or omit fields — for negative handshake tests. */
  helloOverride?: Record<string, unknown>;
  /** Skip offering the subprotocol (SUBPROTOCOL) — for negative handshake tests. */
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
  private claimedAccountIdValue: string | null = null;
  private pendingClaim: { resolve: (accountId: string) => void; reject: (err: Error) => void; timer: NodeJS.Timeout } | null = null;
  private pendingList:
    | {
        resolve: (connections: { client_id: string; client_name: string; display_name: string; image_url: string | null; connected_at: string; last_used_at: string | null }[]) => void;
        reject: (err: Error) => void;
        timer: NodeJS.Timeout;
      }
    | null = null;
  private pendingRevoke: { resolve: () => void; reject: (err: Error) => void; timer: NodeJS.Timeout } | null = null;
  private closedInfo: CloseInfo | null = null;

  constructor(private readonly options: FakeDeviceOptions) {
    this.canned = defaultCannedResponses({
      locked: options.locked,
      typeTextSupportsSubmit: options.typeTextSupportsSubmit,
    });
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    this.privateKey = privateKey;
    const der = publicKey.export({ type: "spki", format: "der" });
    this.publicKeyBase64 = der.toString("base64");
    // The id is a function of the key (examples/device-id-vectors.json), not a choice.
    this.deviceId = `dt_${createHash("sha256").update(der).digest("hex")}`;
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

  /** The account_id this device was last successfully claimed by, or null if never claimed. */
  get claimedAccountId(): string | null {
    return this.claimedAccountIdValue;
  }

  /**
   * Sends `claim_account` over the authenticated connection (design doc D-33) and resolves with the
   * `account_id` from `claimed`. `installHint` is required (protocol v2). `replaceDeviceId`, when
   * given, claims this phone in place of that device. Rejects with the rejection reason on
   * `claim_rejected`, or on no reply within `timeoutMs`.
   */
  claimAccount(accountToken: string, installHint: string, timeoutMs = 5000, replaceDeviceId?: string): Promise<string> {
    const ws = this.ws;
    if (!this.welcomed || !ws) return Promise.reject(new Error("not connected"));
    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingClaim = null;
        reject(new Error("no claimed/claim_rejected reply within timeout"));
      }, timeoutMs);
      this.pendingClaim = { resolve, reject, timer };
      ws.send(
        JSON.stringify({
          type: "claim_account",
          account_token: accountToken,
          install_hint: installHint,
          ...(replaceDeviceId !== undefined ? { replace_device_id: replaceDeviceId } : {}),
        }),
      );
    });
  }

  /**
   * Sends `list_ai_connections` over the authenticated connection and resolves with the
   * `ai_connections_list` reply (its `connections` on ok). Rejects with the error code on the
   * error branch (`not_claimed`), or on no reply within `timeoutMs`.
   */
  listAiConnections(
    timeoutMs = 5000,
  ): Promise<
    { client_id: string; client_name: string; display_name: string; image_url: string | null; connected_at: string; last_used_at: string | null }[]
  > {
    const ws = this.ws;
    if (!this.welcomed || !ws) return Promise.reject(new Error("not connected"));
    return new Promise<
      { client_id: string; client_name: string; display_name: string; image_url: string | null; connected_at: string; last_used_at: string | null }[]
    >((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingList = null;
        reject(new Error("no ai_connections_list reply within timeout"));
      }, timeoutMs);
      this.pendingList = { resolve, reject, timer };
      ws.send(JSON.stringify({ type: "list_ai_connections" }));
    });
  }

  /**
   * Sends `revoke_ai_connection` over the authenticated connection and resolves once the server
   * answers `ai_connection_revoked`. Rejects with the error code on the error branch
   * (`not_claimed`, `not_found`), or on no reply within `timeoutMs`.
   */
  revokeAiConnection(connectionId: string, timeoutMs = 5000): Promise<void> {
    const ws = this.ws;
    if (!this.welcomed || !ws) return Promise.reject(new Error("not connected"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRevoke = null;
        reject(new Error("no ai_connection_revoked reply within timeout"));
      }, timeoutMs);
      this.pendingRevoke = { resolve, reject, timer };
      ws.send(JSON.stringify({ type: "revoke_ai_connection", connection_id: connectionId }));
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
      body: JSON.stringify({ public_key: this.publicKeyBase64 }),
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
      const protocols = this.options.omitSubprotocol ? undefined : [SUBPROTOCOL];
      const ws = new WebSocket(this.options.url, protocols);
      this.ws = ws;

      ws.once("open", () => {
        const hello = buildHello(this.options.protocolVersion ?? defaultProtocolVersion(), {
          deviceId: this.options.helloDeviceId ?? this.deviceId,
          apkVersion: this.options.apkVersion ?? "0.0.0-fake",
          androidVersion: this.options.androidVersion ?? 34,
          deviceModel: this.options.deviceModel ?? "Fake Device",
          capabilities: this.options.capabilities ?? [],
          mode: this.options.mode ?? "live",
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
        } else if (msg.type === "claimed" && this.pendingClaim) {
          const pending = this.pendingClaim;
          this.pendingClaim = null;
          clearTimeout(pending.timer);
          this.claimedAccountIdValue = msg.account_id as string;
          pending.resolve(msg.account_id as string);
        } else if (msg.type === "claim_rejected" && this.pendingClaim) {
          const pending = this.pendingClaim;
          this.pendingClaim = null;
          clearTimeout(pending.timer);
          pending.reject(new Error(`claim_rejected: ${msg.reason as string}`));
        } else if (msg.type === "ai_connections_list" && this.pendingList) {
          const pending = this.pendingList;
          this.pendingList = null;
          clearTimeout(pending.timer);
          if (msg.ok === true) {
            pending.resolve(msg.connections as { client_id: string; client_name: string; display_name: string; image_url: string | null; connected_at: string; last_used_at: string | null }[]);
          } else {
            const err = msg.error as { code?: string } | undefined;
            pending.reject(new Error(`ai_connections_list error: ${err?.code ?? "unknown"}`));
          }
        } else if (msg.type === "ai_connection_revoked" && this.pendingRevoke) {
          const pending = this.pendingRevoke;
          this.pendingRevoke = null;
          clearTimeout(pending.timer);
          if (msg.ok === true) {
            pending.resolve();
          } else {
            const err = msg.error as { code?: string } | undefined;
            pending.reject(new Error(`ai_connection_revoked error: ${err?.code ?? "unknown"}`));
          }
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
        const raw = behaviour.output !== undefined ? behaviour.output : this.canned[step.op]?.(step.params);
        // A canned responder can answer with an error (device_locked, submit_unsupported) instead
        // of a result: shape { error: { code, message } }.
        const err =
          typeof raw === "object" && raw !== null && "error" in raw
            ? (raw as { error: { code?: string; message?: string } }).error
            : undefined;
        if (err && typeof err.code === "string") {
          this.send({ type: "error", step_id: step.step_id, code: err.code, message: err.message ?? err.code });
          return;
        }
        // Anything else the responder produced must satisfy Result's output shape: a plain value
        // (string, number, boolean) is wrapped, an object passes as-is, null/undefined send no
        // output at all.
        let output: ResultOutput | undefined;
        if (typeof raw === "object" && raw !== null) {
          output = raw as ResultOutput;
        } else if (raw !== undefined) {
          output = { value: raw };
        }
        this.send({ type: "result", step_id: step.step_id, output });
        return;
      }
    }
  }
}
