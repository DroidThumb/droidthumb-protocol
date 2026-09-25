import { WebSocket } from "ws";
import { randomUUID } from "node:crypto";
import type { Hello, Welcome, Step, Result, Error as ErrorMessage } from "droidthumb-protocol";
import { defaultCannedResponses, type CannedResponses } from "./canned.js";
import type { Override } from "./scenarios.js";

export interface FakeDeviceOptions {
  url: string;
  deviceId?: string;
  apkVersion?: string;
  mode?: "live" | "unattended";
  capabilities?: string[];
  protocolVersion?: number;
  /** Send a message other than `hello` first, or omit fields — for negative handshake tests. */
  helloOverride?: Record<string, unknown>;
  /** Skip offering the `droidthumb.v1` subprotocol — for negative handshake tests. */
  omitSubprotocol?: boolean;
}

export interface CloseInfo {
  code: number;
  reason: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * A scriptable stand-in for a real DroidThumb device (plan 01 §5.4). Connects out to the
 * server's device WebSocket endpoint, performs the hello/welcome handshake, and answers every
 * `step` it receives with either a canned per-op result or a queued scenario override.
 */
export class FakeDevice {
  private ws?: WebSocket;
  private readonly overrides = new Map<string, Override[]>();
  private readonly canned: CannedResponses;
  readonly deviceId: string;
  private welcomed = false;
  private closedInfo: CloseInfo | null = null;

  constructor(private readonly options: FakeDeviceOptions) {
    this.deviceId = options.deviceId ?? `fake-${randomUUID()}`;
    this.canned = defaultCannedResponses();
  }

  get isWelcomed(): boolean {
    return this.welcomed;
  }

  get closeInfo(): CloseInfo | null {
    return this.closedInfo;
  }

  /** Queue a one-time behaviour override for the next `step` with this op. */
  queue(op: string, override: Override): void {
    const list = this.overrides.get(op) ?? [];
    list.push(override);
    this.overrides.set(op, list);
  }

  /**
   * Connects, sends `hello`, and resolves with `welcome` once accepted. Rejects if the
   * connection closes (or the WS upgrade itself fails) before a `welcome` arrives.
   */
  async connect(): Promise<Welcome> {
    return new Promise((resolve, reject) => {
      const protocols = this.options.omitSubprotocol ? undefined : ["droidthumb.v1"];
      const ws = new WebSocket(this.options.url, protocols);
      this.ws = ws;

      ws.once("open", () => {
        const hello: Hello = {
          type: "hello",
          protocol_version: this.options.protocolVersion ?? 1,
          apk_version: this.options.apkVersion ?? "0.0.0-fake",
          device_id: this.deviceId,
          capabilities: this.options.capabilities ?? [],
          mode: this.options.mode ?? "live",
          flow_manifest: [],
        };
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
          if (msg.type === "welcome") {
            this.welcomed = true;
            resolve(msg as Welcome);
          } else {
            reject(new Error(`expected welcome first, got type: ${msg.type}`));
          }
          return;
        }
        if (msg.type === "step") {
          void this.handleStep(msg as Step);
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
