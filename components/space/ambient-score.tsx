'use client'

import { ChevronUp, Music2, Volume2, VolumeX } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AUTOPLAY_FADE_SECONDS,
  DEFAULT_VOLUME,
  MUTE_FADE_SECONDS,
  UNMUTE_FADE_SECONDS,
  VOLUME_RAMP_SECONDS,
  clampVolume,
  isPlaybackRunning,
  isSilentVolume,
  targetGain,
} from '@/lib/ambient-score-core.mjs'

/**
 * Home-page background music.
 *
 * Four slowly breathing pad voices and a sparse bell figure, all generated with
 * the Web Audio API — no audio file is downloaded and nothing copyrighted is
 * reproduced.
 *
 * Behaviour:
 *   • A fresh load is unmuted at 40% and *tries* to play: the graph is built,
 *     the context is resumed and the master gain fades in over ~1.2 s.
 *   • Browsers (Edge included) may refuse autoplay. The refusal is detected by
 *     the context state, never worked around: the control becomes "Enable
 *     sound" and one real click starts the music. There is no retry loop.
 *   • Muting fades to zero over 0.8 s and only then suspends the context, so
 *     the score is never cut mid-note and the UI never claims to be playing
 *     when it is not.
 *   • Nothing is persisted: a reload is always unmuted at 40%.
 *   • The component is mounted only on "/" (see app-shell.tsx) and closes its
 *     context on unmount, so the music cannot follow the visitor to Mission
 *     Film or any other route, and a second player is never created.
 */

type Status = 'starting' | 'playing' | 'muted' | 'blocked'

/** How long a resume() may pend before autoplay counts as blocked. */
const AUTOPLAY_PROBE_MS = 700

export default function AmbientScore() {
  const ctxRef = useRef<AudioContext | null>(null)
  const masterRef = useRef<GainNode | null>(null)
  const sourcesRef = useRef<OscillatorNode[]>([])
  const noteTimerRef = useRef<number | null>(null)
  const playNoteRef = useRef<(() => void) | null>(null)
  const suspendTimerRef = useRef<number | null>(null)
  const statusRef = useRef<Status>('starting')
  const wantedRef = useRef(true)
  const volumeRef = useRef(DEFAULT_VOLUME)
  const resumeOnReturnRef = useRef(false)
  const mountedRef = useRef(true)

  const [status, setStatus] = useState<Status>('starting')
  const [volume, setVolume] = useState(DEFAULT_VOLUME)
  const [hovered, setHovered] = useState(false)
  const [pinned, setPinned] = useState(false)

  const open = hovered || pinned

  const phase = useCallback((next: Status) => {
    statusRef.current = next
    if (mountedRef.current) setStatus(next)
  }, [])

  const clearSuspendTimer = useCallback(() => {
    if (suspendTimerRef.current !== null) {
      window.clearTimeout(suspendTimerRef.current)
      suspendTimerRef.current = null
    }
  }, [])

  /**
   * Ramps the master gain from its current value to `target`. Cancels any
   * earlier automation first, so rapid clicks can never stack ramps — the
   * exact reason repeated mute/unmute used to leave the score at the wrong
   * level.
   */
  const fade = useCallback((target: number, seconds: number) => {
    const ctx = ctxRef.current
    const master = masterRef.current
    if (!ctx || !master) return
    const now = ctx.currentTime
    const gain = master.gain
    if (typeof gain.cancelAndHoldAtTime === 'function') {
      gain.cancelAndHoldAtTime(now)
    } else {
      const current = gain.value
      gain.cancelScheduledValues(now)
      gain.setValueAtTime(current, now)
    }
    if (seconds <= 0) {
      gain.setValueAtTime(target, now)
      return
    }
    gain.linearRampToValueAtTime(target, now + seconds)
  }, [])

  const stopNotes = useCallback(() => {
    if (noteTimerRef.current !== null) {
      window.clearInterval(noteTimerRef.current)
      noteTimerRef.current = null
    }
  }, [])

  const startNotes = useCallback(() => {
    if (noteTimerRef.current === null && playNoteRef.current) {
      noteTimerRef.current = window.setInterval(() => playNoteRef.current?.(), 2900)
    }
  }, [])

  /** Full teardown: timers, oscillators and the AudioContext itself. */
  const teardown = useCallback(() => {
    clearSuspendTimer()
    stopNotes()
    for (const source of sourcesRef.current) {
      try {
        source.stop()
        source.disconnect()
      } catch {
        // already stopped
      }
    }
    sourcesRef.current = []
    playNoteRef.current = null
    const ctx = ctxRef.current
    ctxRef.current = null
    masterRef.current = null
    if (ctx && ctx.state !== 'closed') void ctx.close().catch(() => undefined)
  }, [clearSuspendTimer, stopNotes])

  /**
   * Builds the audio graph once. Returns the existing context when the graph is
   * already up, so no code path can create a second player.
   */
  const build = useCallback(() => {
    const existing = ctxRef.current
    if (existing) return existing

    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return null

    const ctx = new Ctor()

    // Safety limiter: protects audio quality near full volume instead of
    // capping the level the visitor chose.
    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = -4
    limiter.knee.value = 6
    limiter.ratio.value = 12
    limiter.attack.value = 0.003
    limiter.release.value = 0.25
    limiter.connect(ctx.destination)

    const master = ctx.createGain()
    master.gain.value = 0
    master.connect(limiter)
    masterRef.current = master
    ctxRef.current = ctx

    // Soft, dark tone with a long tail.
    const filter = ctx.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = 640
    filter.Q.value = 0.7
    filter.connect(master)

    const delay = ctx.createDelay(2)
    delay.delayTime.value = 0.52
    const feedback = ctx.createGain()
    feedback.gain.value = 0.3
    const wet = ctx.createGain()
    wet.gain.value = 0.3
    filter.connect(delay)
    delay.connect(feedback)
    feedback.connect(delay)
    delay.connect(wet)
    wet.connect(master)

    // ---- pad: four slowly breathing voices --------------------------------
    const padFrequencies = [110, 164.81, 220, 329.63]
    padFrequencies.forEach((frequency, index) => {
      const osc = ctx.createOscillator()
      osc.type = index % 2 === 0 ? 'sine' : 'triangle'
      osc.frequency.value = frequency
      osc.detune.value = (index - 1.5) * 7

      const gain = ctx.createGain()
      gain.gain.value = 0.045

      const lfo = ctx.createOscillator()
      lfo.frequency.value = 0.04 + index * 0.016
      const lfoGain = ctx.createGain()
      lfoGain.gain.value = 0.03
      lfo.connect(lfoGain)
      lfoGain.connect(gain.gain)

      osc.connect(gain)
      gain.connect(filter)
      osc.start()
      lfo.start()
      sourcesRef.current.push(osc, lfo)
    })

    // ---- sparse bell figure ------------------------------------------------
    const scale = [440, 493.88, 554.37, 659.25, 739.99, 880]
    let step = 0
    const playNote = () => {
      const active = ctxRef.current
      if (!active) return
      const now = active.currentTime
      const osc = active.createOscillator()
      osc.type = 'triangle'
      osc.frequency.value = scale[step % scale.length]
      step += 1 + (step % 3)

      const gain = active.createGain()
      gain.gain.setValueAtTime(0, now)
      gain.gain.linearRampToValueAtTime(0.05, now + 1.1)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 5.4)

      osc.connect(gain)
      gain.connect(filter)
      osc.start(now)
      osc.stop(now + 5.6)
    }
    playNoteRef.current = playNote

    return ctx
  }, [])

  /**
   * Starts (or resumes) playback and fades in.
   *
   * Resolves true only when the context is actually running — the audible
   * state, not the promise. A browser that refuses autoplay leaves the context
   * suspended, and that is reported as `blocked`.
   */
  const begin = useCallback(
    async (seconds: number) => {
      if (isSilentVolume(volumeRef.current)) {
        phase('muted')
        return false
      }

      const ctx = build()
      const master = masterRef.current
      if (!ctx || !master) {
        phase('blocked')
        return false
      }

      // resume() can pend until a gesture when autoplay is blocked, so it is
      // bounded: an unresolved resume is treated as blocked, not awaited.
      const running = await Promise.race([
        ctx
          .resume()
          .then(() => true)
          .catch(() => false),
        new Promise<boolean>((resolve) => {
          window.setTimeout(() => resolve(false), AUTOPLAY_PROBE_MS)
        }),
      ])

      if (!mountedRef.current) return false
      if (!running || !isPlaybackRunning(ctx.state)) {
        phase('blocked')
        return false
      }

      // Always start from silence: unmuting never jumps to full level.
      const now = ctx.currentTime
      master.gain.cancelScheduledValues(now)
      master.gain.setValueAtTime(0, now)
      wantedRef.current = true
      startNotes()
      phase('playing')
      fade(targetGain(volumeRef.current, true), seconds)
      return true
    },
    [build, fade, phase, startNotes],
  )

  const mute = useCallback(() => {
    wantedRef.current = false
    clearSuspendTimer()
    stopNotes()
    phase('muted')
    const ctx = ctxRef.current
    const master = masterRef.current
    if (!ctx || !master) return

    fade(0, MUTE_FADE_SECONDS)
    // Pause only after the fade has finished, so the tail is heard and the
    // interface changes state in the same order a listener experiences it.
    suspendTimerRef.current = window.setTimeout(() => {
      suspendTimerRef.current = null
      if (wantedRef.current) return
      const active = ctxRef.current
      const current = masterRef.current
      if (!active || !current) return
      const now = active.currentTime
      current.gain.cancelScheduledValues(now)
      current.gain.setValueAtTime(0, now)
      if (active.state === 'running') void active.suspend().catch(() => undefined)
    }, Math.round(MUTE_FADE_SECONDS * 1000) + 120)
  }, [clearSuspendTimer, fade, phase, stopNotes])

  // One autoplay attempt on mount (never a retry loop). The cleanup closes the
  // whole graph, which is what keeps the music on the homepage only.
  useEffect(() => {
    mountedRef.current = true
    void begin(AUTOPLAY_FADE_SECONDS)
    return () => {
      mountedRef.current = false
      teardown()
    }
  }, [begin, teardown])

  // A hidden tab must not keep playing. Music that was playing is remembered
  // and restored on return; music the visitor muted stays muted.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        if (statusRef.current === 'playing') {
          resumeOnReturnRef.current = true
          mute()
        }
        return
      }
      if (!resumeOnReturnRef.current) return
      resumeOnReturnRef.current = false
      void begin(UNMUTE_FADE_SECONDS)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [begin, mute])

  /** Called by a real click/tap only. */
  const enable = useCallback(() => {
    void begin(UNMUTE_FADE_SECONDS)
  }, [begin])

  const toggle = useCallback(() => {
    if (statusRef.current === 'playing') {
      mute()
      return
    }
    enable()
  }, [enable, mute])

  const changeVolume = useCallback(
    (next: number) => {
      const value = clampVolume(next)
      volumeRef.current = value
      setVolume(value)

      if (isSilentVolume(value)) {
        // Zero *is* the muted state: silence, and an honest icon.
        if (statusRef.current === 'playing') mute()
        else phase('muted')
        return
      }

      if (statusRef.current === 'playing') {
        fade(targetGain(value, true), VOLUME_RAMP_SECONDS)
        return
      }

      // Dragging the slider is a gesture, so raising the volume from muted (or
      // from a blocked autoplay) restores sound.
      enable()
    },
    [enable, fade, mute, phase],
  )

  const playing = status === 'playing'
  const blocked = status === 'blocked'

  return (
    <div
      data-music-status={status}
      className="fixed bottom-5 right-5 z-40 flex flex-col items-end"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => setHovered(false)}
      onFocusCapture={() => setHovered(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHovered(false)
      }}
    >
      {/* Autoplay was refused: one click is all it takes, and the control says
          so instead of pretending the music is playing. */}
      {blocked && (
        <button
          type="button"
          onClick={enable}
          aria-label="Enable background music"
          className="mb-2 flex items-center gap-1.5 rounded-full border border-electric/50 bg-electric/15 px-3 py-1.5 font-display text-[10px] uppercase tracking-[0.16em] text-starlight shadow-[0_0_24px_rgba(131,183,255,0.25)] backdrop-blur transition-colors hover:border-electric/80 hover:bg-electric/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric/70"
        >
          <Volume2 className="size-3.5" aria-hidden />
          Enable sound
        </button>
      )}

      {/* Volume panel: revealed on hover/focus, or pinned on touch. The slider
          is always focusable, so keyboard users reach it with Tab. */}
      <div
        id="ambient-score-volume"
        className={`absolute bottom-full right-0 mb-12 pb-2 transition-all duration-200 ease-out motion-reduce:transition-none ${
          open ? 'pointer-events-auto translate-y-0 opacity-100' : 'pointer-events-none translate-y-1 opacity-0'
        }`}
      >
        <div className="flex items-center gap-2 rounded-full border border-orbit/30 bg-void/80 px-3 py-2 text-moon shadow-lg backdrop-blur">
          <Volume2 className="size-3.5 shrink-0 text-moon/80" aria-hidden />
          <input
            type="range"
            min={0}
            max={100}
            step={1}
            value={volume}
            onChange={(event) => changeVolume(Number(event.target.value))}
            aria-label="Background music volume"
            aria-valuetext={`${volume} percent`}
            className="h-4 w-24 cursor-pointer accent-electric focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric/70"
          />
          <span className="w-9 text-right font-display text-[10px] tabular-nums tracking-[0.08em] text-moon">
            {volume}%
          </span>
        </div>
      </div>

      {/* Touch devices have no hover: a small chevron reveals the slider
          without touching the mute action. Hidden wherever hovering is possible. */}
      <button
        type="button"
        onClick={() => setPinned((value) => !value)}
        aria-expanded={open}
        aria-controls="ambient-score-volume"
        aria-label={open ? 'Hide volume control' : 'Show volume control'}
        className="mb-2 hidden size-7 items-center justify-center rounded-full border border-orbit/30 bg-void/70 text-moon backdrop-blur transition-colors hover:border-electric/60 hover:text-starlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric/70 [@media(hover:none)]:flex"
      >
        <ChevronUp className={`size-3.5 transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>

      <button
        type="button"
        onClick={toggle}
        aria-pressed={playing}
        aria-label={playing ? 'Mute background music' : 'Unmute background music'}
        title={`Background music · ${volume}%`}
        className="flex size-10 items-center justify-center rounded-full border border-orbit/30 bg-void/70 text-moon backdrop-blur transition-colors hover:border-electric/60 hover:text-starlight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric/70 focus-visible:ring-offset-2 focus-visible:ring-offset-void"
      >
        {playing ? <Music2 className="size-4" aria-hidden /> : <VolumeX className="size-4" aria-hidden />}
      </button>
    </div>
  )
}
