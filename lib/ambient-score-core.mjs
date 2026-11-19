// Shared constants and gain maths for the homepage background music.
//
// The music is unmuted by default: every fresh page load tries to play at 40%
// and fades in. Nothing about the player state is persisted, so a previous mute
// click can never leave the site permanently silent after a reload.
//
// Keeping the numbers here lets the component and the tests agree on them.

/** Full application level — quality is protected by the limiter, not a cap. */
export const MAX_GAIN = 1

/** A fresh load is unmuted; autoplay is attempted unless the browser refuses. */
export const DEFAULT_ENABLED = true

/** Sensible starting level, and the level a reload always returns to. */
export const DEFAULT_VOLUME = 40

/** Fade-in used when autoplay succeeds (never a sudden burst of sound). */
export const AUTOPLAY_FADE_SECONDS = 1.2

/** Mute fade: ~0.8 s, inside the 700–1000 ms the interface promises. */
export const MUTE_FADE_SECONDS = 0.8

/** Unmute / tab-return fade. */
export const UNMUTE_FADE_SECONDS = 0.9

/** Slider moves track immediately, but still ramp rather than jump. */
export const VOLUME_RAMP_SECONDS = 0.12

export function clampVolume(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) return DEFAULT_VOLUME
  return Math.min(100, Math.max(0, Math.round(numeric)))
}

/**
 * Master gain for the current state. A muted score is exact silence, whatever
 * the slider says, so changing the volume can never start playback.
 */
export function targetGain(volume, enabled) {
  if (!enabled) return 0
  return (clampVolume(volume) / 100) * MAX_GAIN
}

/** A slider at zero means silence, i.e. the muted state. */
export function isSilentVolume(volume) {
  return clampVolume(volume) === 0
}

/**
 * Whether an AudioContext that has been asked to resume is actually producing
 * sound. Chromium and Edge leave an autoplay-blocked context `suspended`, and
 * `resume()` can stay pending until a real gesture, so the context state — not
 * the promise — is the honest answer.
 */
export function isPlaybackRunning(contextState) {
  return contextState === 'running'
}
