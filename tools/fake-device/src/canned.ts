/**
 * Default per-op canned outputs, keyed by the op names the server's MCP surface exposes. A stand-in
 * for M2's real op -> handler dispatch: the fake device doesn't run real handlers, it just answers
 * with the right shape per op name.
 */
import type { FakeDeviceOptions } from "./device.js";

export type CannedResponder = (params: Record<string, unknown> | undefined) => unknown;
export type CannedResponses = Record<string, CannedResponder>;

const FIXTURE_TREE = [
  "0\troot\tandroid.widget.FrameLayout\t\t\t0,0,1080,2400",
  "1\tbutton\tandroid.widget.Button\tSend\tSend\t900,2200,1080,2300",
].join("\n");

// A minimal valid 1x1 JPEG, base64-encoded — a stand-in payload, not a meaningful screenshot.
const FIXTURE_IMAGE_BASE64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAB//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==";

/** A canned responder that answers with a protocol error instead of a result. */
export interface CannedError {
  error: { code: string; message: string };
}

export function defaultCannedResponses(options: Pick<FakeDeviceOptions, "locked" | "typeTextSupportsSubmit"> = {}): CannedResponses {
  const locked = options.locked ?? false;
  const typeTextSupportsSubmit = options.typeTextSupportsSubmit ?? true;
  return {
    read_screen: (params) => {
      if (locked) {
        return { error: { code: "device_locked", message: "the phone is locked" } } satisfies CannedError;
      }
      const includeScreenshot = Boolean(params?.["include_screenshot"]);
      return includeScreenshot
        ? {
            tree: FIXTURE_TREE,
            locked: false,
            screenshot: { kind: "inline", mime: "image/jpeg", data: FIXTURE_IMAGE_BASE64 },
          }
        : { tree: FIXTURE_TREE, locked: false };
    },
    tap: () => {
      if (locked) return { error: { code: "device_locked", message: "the phone is locked" } } satisfies CannedError;
      return {};
    },
    type_text: (params) => {
      if (locked) return { error: { code: "device_locked", message: "the phone is locked" } } satisfies CannedError;
      // `append` (default false): the text replaces the field's content — the fake device has no
      // real field to mutate, so both branches behave the same and the params are only echoed in
      // behaviour tests. `submit` (default false): send the keyboard's own action after typing;
      // the fixture keyboard has no send action unless the device is told it does.
      const submit = Boolean(params?.["submit"]);
      if (submit && !typeTextSupportsSubmit) {
        return {
          error: { code: "submit_unsupported", message: "the keyboard has no send/search action to press" },
        } satisfies CannedError;
      }
      return { typed: Boolean(params?.["text"] !== undefined), appended: Boolean(params?.["append"]), submitted: submit };
    },
    scroll_find: () => {
      if (locked) return { error: { code: "device_locked", message: "the phone is locked" } } satisfies CannedError;
      return {};
    },
    key: () => {
      if (locked) return { error: { code: "device_locked", message: "the phone is locked" } } satisfies CannedError;
      return {};
    },
    launch_app: () => {
      if (locked) return { error: { code: "device_locked", message: "the phone is locked" } } satisfies CannedError;
      return {};
    },
    wait_until: () => {
      if (locked) return { error: { code: "device_locked", message: "the phone is locked" } } satisfies CannedError;
      return {};
    },
  };
}
