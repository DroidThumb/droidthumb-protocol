/**
 * Default per-op canned outputs, keyed by the 7 op names plan 01 §5.1 exposes. A stand-in for
 * M2's real op -> handler dispatch: the fake device doesn't run real handlers, it just answers
 * with the right shape per op name.
 */
export type CannedResponder = (params: Record<string, unknown> | undefined) => unknown;
export type CannedResponses = Record<string, CannedResponder>;

const FIXTURE_TREE = [
  "0\troot\tandroid.widget.FrameLayout\t\t\t0,0,1080,2400",
  "1\tbutton\tandroid.widget.Button\tSend\tSend\t900,2200,1080,2300",
].join("\n");

// A minimal valid 1x1 JPEG, base64-encoded — a stand-in payload, not a meaningful screenshot.
const FIXTURE_IMAGE_BASE64 =
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAMCAgICAgMCAgIDAwMDBAYEBAQEBAgGBgUGCQgKCgkICQkKDA8MCgsOCwkJDRENDg8QEBEQCgwSExIQEw8QEBD/2wBDAQMDAwQDBAgEBAgQCwkLEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBD/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAB//EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==";

export function defaultCannedResponses(): CannedResponses {
  return {
    read_screen: (params) => {
      const includeScreenshot = Boolean(params?.["include_screenshot"]);
      return includeScreenshot
        ? {
            tree: FIXTURE_TREE,
            screenshot: { kind: "inline", mime: "image/jpeg", data: FIXTURE_IMAGE_BASE64 },
          }
        : { tree: FIXTURE_TREE };
    },
    tap: () => ({}),
    type_text: () => ({}),
    scroll_find: () => ({}),
    key: () => ({}),
    launch_app: () => ({}),
    wait_until: () => ({}),
  };
}
