// Pure helpers behind the mission film: the frame loop, the narration hold and
// the seek clamp.
//
// They live in plain JavaScript (like `lib/rate-limit-core.mjs`) so the React
// component and the Node test suite exercise exactly the same code.

/**
 * A single, self-scheduling animation-frame loop.
 *
 * The handle is cleared *before* `onFrame` runs, which is the whole point: a
 * frame that has just finished must be able to queue the next one. An inline
 * scheduler that keeps the old handle set stops the animation after one frame.
 *
 * @param {{
 *   requestFrame: (callback: (time: number) => void) => number,
 *   cancelFrame: (handle: number) => void,
 *   onFrame: () => void,
 * }} options
 */
export function createFrameLoop({ requestFrame, cancelFrame, onFrame }) {
  let handle = null

  return {
    /** True while a frame is queued. */
    get scheduled() {
      return handle !== null
    },

    /**
     * Queues the next frame. Returns false when one is already pending, so a
     * burst of callers (play, resume, drag, resize) can never start a second
     * loop.
     */
    schedule() {
      if (handle !== null) return false
      handle = requestFrame(() => {
        handle = null
        onFrame()
      })
      return true
    },

    /** Cancels any queued frame. Safe to call repeatedly. */
    cancel() {
      if (handle === null) return
      cancelFrame(handle)
      handle = null
    },
  }
}

/**
 * Whether the film should keep holding the current shot while its narration
 * plays. The hold is bounded, so a browser that never reports the end of a line
 * can delay the timeline but never freeze it.
 *
 * @param {{
 *   speechBusy: boolean,
 *   voiceOn: boolean,
 *   isLast: boolean,
 *   msSinceSpeechStart: number,
 *   beatSeconds: number,
 * }} state
 */
export function holdForNarration({ speechBusy, voiceOn, isLast, msSinceSpeechStart, beatSeconds }) {
  if (!speechBusy || !voiceOn || isLast) return false
  return msSinceSpeechStart < (beatSeconds + 12) * 1000
}

/**
 * Upper bound on how long one line may hold the timeline.
 *
 * Chromium and Edge occasionally never fire `onend` for an utterance, which
 * used to leave the "speaking" flag set and stall the film at the end of every
 * chapter. The watchdog clears that flag after a generous estimate of the
 * spoken length.
 *
 * @param {string} text
 * @param {number} [rate]
 */
export function speechWatchdogMs(text, rate = 1) {
  const words = String(text ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean).length
  const spoken = (words / Math.max(0.5, rate)) * 420 + 1500
  return Math.min(30000, Math.max(6000, Math.round(spoken)))
}

/**
 * A seek target clamped inside the film, so the timeline can never land exactly
 * on the end (which would immediately finish playback) or before the start.
 *
 * @param {number} seconds
 * @param {number} duration
 */
export function clampSeek(seconds, duration) {
  if (!Number.isFinite(seconds)) return 0
  return Math.max(0, Math.min(duration - 0.001, seconds))
}
