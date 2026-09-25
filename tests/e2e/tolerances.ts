// Every timing tolerance the E2E suite uses, in one place. Tighten with care;
// loosening one to silence a failure hides exactly the drift/stall regressions
// this suite exists to catch.

/** Max spread of currentTime across running tiles once playback has settled (s). */
export const SYNC_SPREAD = 0.15
/** Timeline must advance at rate × wall clock within this fraction. */
export const CLOCK_RATE = 0.1
/** A seek must land within this of its target (s). */
export const SEEK = 0.1
/** A tile knocked >0.5 s off the group must be re-seeked into line within this (ms). Drift checks run ~4/s. */
export const DRIFT_RECOVERY_MS = 2000
/**
 * A tile a few tenths of a second off is steered back by up to ±5% playback rate
 * rather than seeked, so it converges slowly: 0.3 s takes a few seconds, then the
 * last few hundredths at 2% before the rate is restored (ms).
 */
export const STEER_RECOVERY_MS = 12_000
/** Every tile must be playing again at the new position within this after a seek (ms). */
export const SEEK_RECOVERY_MS = 3000
/** Time for every loaded tile to become playable or fail (ms). */
export const READY_MS = 15_000
/** Settling time after play before sync is judged (ms). */
export const SETTLE_MS = 1500
