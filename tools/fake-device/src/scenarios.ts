/**
 * Scriptable per-step behaviours a FakeDevice can be told to use instead of its default canned
 * result, keyed by op via FakeDevice#queue. See plan 01 §5.4/§5.5.
 */
export type Override =
  | { kind: "result"; output?: unknown }
  | { kind: "error"; code: string; message: string }
  | { kind: "drop" }
  | { kind: "silent" }
  | { kind: "pause"; ms: number; next?: Override };

export function resultScenario(output?: unknown): Override {
  return { kind: "result", output };
}

export function errorScenario(code: string, message: string): Override {
  return { kind: "error", code, message };
}

/** Closes the socket mid-call, without a clean WS close handshake. */
export function dropScenario(): Override {
  return { kind: "drop" };
}

/** Never responds to this step at all — used to exercise the caller's own timeout. */
export function silentScenario(): Override {
  return { kind: "silent" };
}

/** Waits `ms` before applying `next` (default: the canned result). */
export function pauseScenario(ms: number, next?: Override): Override {
  return { kind: "pause", ms, next };
}
