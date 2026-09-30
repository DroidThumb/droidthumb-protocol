import { FakeDevice } from "./index.js";

const url = process.env["DEVICE_SERVER_URL"] ?? "ws://127.0.0.1:4001/device";
const protocolVersion = process.env["DEVICE_PROTOCOL_VERSION"];
const device = new FakeDevice({
  url,
  apkVersion: process.env["DEVICE_APK_VERSION"],
  ...(protocolVersion ? { protocolVersion: Number.parseInt(protocolVersion, 10) } : {}),
  ...(process.env["DEVICE_LEGACY_HELLO"] === "1" ? { legacyHello: true } : {}),
});

device
  .connect()
  .then((welcome) => {
    console.log(`[fake-device] connected to ${url}, device_id=${device.deviceId}`);
    console.log("[fake-device] welcome:", welcome);
    if (device.connectorUrl) console.log("[fake-device] connector URL received (not printed: it is a credential)");
    if (process.env["DEVICE_EXIT_AFTER_WELCOME"] === "1") {
      device.close();
    }
  })
  .catch((err) => {
    console.error("[fake-device] failed to connect:", err);
    process.exitCode = 1;
  });

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    device.close();
    process.exit(0);
  });
}
