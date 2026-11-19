// Narration lifecycle for the Mission Film.
//
// Speech synthesis is the film's only audio source: the canvas is a picture and
// carries no track. Chromium and Edge are fragile in two specific ways, both
// measured in real Microsoft Edge:
//
//   1. `speechSynthesis.cancel()` immediately after `speak()` — or a cancel
//      storm from an effect that re-runs on every state change — kills the line
//      that was just queued. Edge then reports `speaking === true` while the
//      utterance never reaches the output, so the interface looks like it is
//      narrating and nothing is heard.
//   2. `speaking`/`pending` are not proof of audible output. Only the `start`
//      event is. A line whose `start` never fires is wedged, and the only
//      honest response is to report it and offer a retry.
//
// This module keeps those rules in one place so the Node test suite exercises
// exactly the code the component runs, with an injected speech engine.
import { speechWatchdogMs } from './film-core.mjs'

/** Narration pace: a little slower than conversational speech. */
export const NARRATION_RATE = 0.92

/** One macrotask between a deliberate cancel and the next `speak()`. */
export const NARRATION_START_DELAY_MS = 90

/** How long a queued line may take to fire `start` before it is reported. */
export const NARRATION_START_TIMEOUT_MS = 1800

/**
 * British English narrator. Chrome/Edge ship "Google UK English", Windows
 * ships Ryan/Libby/Sonia/George, macOS ships Daniel/Serena/Kate.
 */
const BRITISH =
  /(google uk english|english \(united kingdom\)|^daniel|^serena|^kate|^sonia|^libby|^ryan|^hazel|^george|^arthur|^maisie|^oliver|^thomas|uk english|british)/i

/**
 * Picks the narrator from the voices this machine actually has.
 *
 * Local voices win: Edge's "Online (Natural)" voices are remote and can stall
 * silently when the speech service is unreachable, which sounds exactly like
 * "the film has no audio".
 *
 * @param {Array<{name: string, lang: string, localService?: boolean}>} voices
 */
export function pickNarrationVoice(voices) {
  if (!Array.isArray(voices) || voices.length === 0) return null
  const local = voices.filter((voice) => voice.localService !== false)
  const pool = local.length ? local : voices
  const exact = pool.filter((voice) => String(voice.lang ?? '').replace('_', '-').toLowerCase() === 'en-gb')
  const english = pool.filter((voice) => /^en/i.test(String(voice.lang ?? '')))
  const candidates = exact.length ? exact : english.length ? english : pool
  return candidates.find((voice) => BRITISH.test(voice.name)) ?? candidates[0] ?? null
}

/**
 * Creates a narration controller around an injected speech engine.
 *
 * Status values: `idle` (nothing queued), `queued` (waiting for the engine to
 * start), `speaking` (a real `start` arrived), `failed` (the engine refused or
 * never started the line — the UI must say so).
 *
 * @param {{
 *   synth: any,
 *   makeUtterance: (text: string) => any,
 *   schedule: (fn: () => void, ms: number) => number,
 *   cancelTimer: (handle: number) => void,
 *   getVoices?: () => any[],
 *   rate?: number,
 *   startDelayMs?: number,
 *   startTimeoutMs?: number,
 *   onStatus?: (status: string, detail?: string) => void,
 * }} deps
 */
export function createNarration(deps) {
  const {
    synth,
    makeUtterance,
    schedule,
    cancelTimer,
    getVoices = () => (synth && typeof synth.getVoices === 'function' ? synth.getVoices() : []),
    rate = NARRATION_RATE,
    startDelayMs = NARRATION_START_DELAY_MS,
    startTimeoutMs = NARRATION_START_TIMEOUT_MS,
    onStatus,
  } = deps

  /** @type {{ id: number, utterance: any, text: string, started: boolean } | null} */
  let line = null
  let sequence = 0
  let queueTimer = null
  let startTimer = null
  let watchdogTimer = null
  let status = 'idle'
  let lastText = ''
  let disposed = false

  function notify(next, detail) {
    if (status === next) return
    status = next
    if (onStatus) onStatus(next, detail)
  }

  function clearTimers() {
    if (queueTimer !== null) {
      cancelTimer(queueTimer)
      queueTimer = null
    }
    if (startTimer !== null) {
      cancelTimer(startTimer)
      startTimer = null
    }
    if (watchdogTimer !== null) {
      cancelTimer(watchdogTimer)
      watchdogTimer = null
    }
  }

  /** True only when the engine really holds something. */
  function engineBusy() {
    return Boolean(synth && (synth.speaking === true || synth.pending === true))
  }

  /** Stops narration. Cancels at most once, and only for an in-flight line. */
  function stop() {
    clearTimers()
    line = null
    if (engineBusy()) {
      try {
        synth.cancel()
      } catch {
        // The engine is already gone; nothing to cancel.
      }
    }
    notify('idle')
  }

  /**
   * Narrates one line.
   *
   * A repeat call for the line already playing is a no-op, so a re-render can
   * never restart (or double) the narration. A different line cancels the old
   * one *before* queueing the new one, never after.
   */
  function speak(text, options = {}) {
    if (disposed || !synth) return
    const value = String(text ?? '').trim()
    if (!value) return
    // A re-render of the same chapter is a no-op; a different line always
    // replaces the current one.
    if (line && !options.force && line.text === value) return

    const id = ++sequence
    clearTimers()
    if (engineBusy()) {
      try {
        synth.cancel()
      } catch {
        // ignore
      }
    }

    const utterance = makeUtterance(value)
    utterance.rate = rate
    utterance.pitch = 1
    utterance.volume = 1

    utterance.onstart = () => {
      if (id !== sequence || disposed) return
      if (line && line.id === id) line.started = true
      notify('speaking')
    }
    utterance.onend = () => {
      if (id !== sequence || disposed) return
      line = null
      clearTimers()
      notify('idle')
    }
    utterance.onerror = (event) => {
      if (id !== sequence || disposed) return
      const reason = String(event?.error ?? '')
      // Our own cancel() is not a failure.
      if (reason === 'interrupted' || reason === 'canceled') return
      line = null
      clearTimers()
      notify('failed', reason || 'error')
    }

    line = { id, utterance, text: value, started: false }
    lastText = value
    notify('queued')

    queueTimer = schedule(() => {
      queueTimer = null
      if (disposed || !line || line.id !== id) return

      // Chromium and Edge fill their voice list asynchronously. Resolving the
      // voice here — at speak time — means a late `voiceschanged` never has to
      // re-speak (and therefore never cancels) a line that is already playing.
      if (!utterance.voice) {
        const voice = pickNarrationVoice(getVoices())
        if (voice) {
          utterance.voice = voice
          utterance.lang = voice.lang
        } else if (!utterance.lang) {
          utterance.lang = 'en-GB'
        }
      }

      try {
        synth.speak(utterance)
      } catch {
        line = null
        notify('failed', 'speak-threw')
        return
      }

      // `speaking` is not proof of sound. A line that never fires `start` is
      // wedged, so surface it instead of pretending the film is narrated.
      startTimer = schedule(() => {
        startTimer = null
        if (disposed || !line || line.id !== id || line.started) return
        try {
          synth.cancel()
        } catch {
          // ignore
        }
        line = null
        notify('failed', 'no-start')
      }, startTimeoutMs)

      watchdogTimer = schedule(() => {
        watchdogTimer = null
        if (disposed || !line || line.id !== id) return
        line = null
        notify('idle')
      }, speechWatchdogMs(value, rate))
    }, startDelayMs)
  }

  /** Re-attempts the last line (used by the "retry narration" control). */
  function retry() {
    if (!lastText) return
    speak(lastText, { force: true })
  }

  /** True while a line is queued or audibly in progress. */
  function isBusy() {
    return status === 'queued' || status === 'speaking'
  }

  function dispose() {
    disposed = true
    stop()
  }

  return {
    speak,
    stop,
    retry,
    dispose,
    isBusy,
    get status() {
      return status
    },
    get text() {
      return lastText
    },
  }
}
