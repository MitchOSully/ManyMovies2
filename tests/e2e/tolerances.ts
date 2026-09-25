// Every timing tolerance the E2E suite uses, in one place. Tighten with care;
// loosening one to silence a failure hides exactly the drift/stall regressions
// this suite exists to catch.

/** Max spread of currentTime across running tiles once playback has settled (s). */
export const SYNC_SPREAD = 0.15
/** Timeline must advance at rate × wall clock within this fraction. */
export const CLOCK_RATE = 0.1
/** A seek must land within this of its target (s). */
export const SEEK = 0.1
/** A tile nudged off the group must be pulled back within this (ms). Drift checks run ~1/s. */
export const DRIFT_RECOVERY_MS = 2000
/** Time for every loaded tile to become playable or fail (ms). */
export const READY_MS = 15_000
/** Settling time after play before sync is judged (ms). */
export const SETTLE_MS = 1500
