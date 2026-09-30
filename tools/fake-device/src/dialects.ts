import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import type { Hello } from "droidthumb-protocol";

const require = createRequire(import.meta.url);

export interface ProtocolVersions {
  current: number;
  supported: number[];
}

/** `droidthumb-protocol`'s own statement of which protocol versions exist (examples/protocol-versions.json). */
export function loadProtocolVersions(): ProtocolVersions {
  const file = require.resolve("droidthumb-protocol/examples/protocol-versions.json");
  return JSON.parse(readFileSync(file, "utf-8")) as ProtocolVersions;
}

export interface HelloFields {
  deviceId: string;
  apkVersion: string;
  androidVersion: number;
  deviceModel: string;
  capabilities: string[];
  mode: "live" | "unattended";
  /** Simulate an app built before android_version/device_model existed. */
  legacy: boolean;
}

/**
 * How the fake device words `hello` for each protocol version it can speak. One entry per
 * version in `examples/protocol-versions.json`'s `supported` — `dialects.test.ts` fails if a
 * supported version has no entry here, so adding a version to the protocol without teaching the
 * fake device to speak it is caught in this repo's own CI, not later in droidthumb-server's.
 */
const helloBuilders: Record<number, (version: number, f: HelloFields) => Hello> = {
  1: (version, f) => ({
    type: "hello",
    protocol_version: version,
    apk_version: f.apkVersion,
    ...(f.legacy ? {} : { android_version: f.androidVersion, device_model: f.deviceModel }),
    device_id: f.deviceId,
    capabilities: f.capabilities,
    mode: f.mode,
    flow_manifest: [],
  }),
};

export function speakableVersions(): number[] {
  return Object.keys(helloBuilders).map(Number).sort((a, b) => a - b);
}

/**
 * Builds `hello` for `version`. A version the fake device has no dialect for (deliberately
 * unsupported ones, used by negative tests — e.g. "the server rejects protocol_version 99") gets
 * the newest known dialect's shape with the requested `protocol_version` stamped on it.
 */
export function buildHello(version: number, fields: HelloFields): Hello {
  const known = speakableVersions();
  const dialect = helloBuilders[version] ?? helloBuilders[known[known.length - 1] as number];
  if (!dialect) throw new Error("fake device has no protocol dialects");
  return dialect(version, fields);
}

/**
 * The protocol version a FakeDevice speaks when the caller doesn't say: the
 * `DROIDTHUMB_FAKE_PROTOCOL_VERSION` environment variable if set (how droidthumb-server's CI runs
 * its whole suite once per supported version), otherwise the protocol's `current`.
 */
export function defaultProtocolVersion(): number {
  const fromEnv = process.env["DROIDTHUMB_FAKE_PROTOCOL_VERSION"];
  if (fromEnv !== undefined && fromEnv !== "") {
    const n = Number.parseInt(fromEnv, 10);
    if (!Number.isInteger(n) || n < 1) {
      throw new Error(`DROIDTHUMB_FAKE_PROTOCOL_VERSION must be a positive integer, got: ${fromEnv}`);
    }
    return n;
  }
  return loadProtocolVersions().current;
}
