import { FakeDevice } from "./index.js";

const url = process.env["DEVICE_SERVER_URL"] ?? "ws://127.0.0.1:4001/device";
const device = new FakeDevice({ url, deviceId: process.env["DEVICE_ID"] });

device
  .connect()
  .then((welcome) => {
    console.log(`[fake-device] connected to ${url}, device_id=${device.deviceId}`);
    console.log("[fake-device] welcome:", welcome);
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
