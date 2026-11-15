'use client'

import { Music2, VolumeX } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Home-page ambient score.
 *
 * Original music generated with the Web Audio API — slow organ-like pads and a
 * sparse bell figure, in the spirit of a space documentary score. No audio file
 * is downloaded and nothing copyrighted is reproduced.
 *
 * It is deliberately quiet (40% of an already low ceiling), starts only after a
 * real user gesture (browsers block autoplay), and exists only on "/" — the
 * component unmounts the moment you leave the homepage.
 */

const LEVEL = 0.4
const CEILING = 0.1

export default function AmbientScore() {
  const ctxRef = useRef<AudioContext | null>(null)
  const masterRef = useRef<GainNode | null>(null)
  const sourcesRef = useRef<OscillatorNode[]>([])
  const timerRef = useRef<number | null>(null)
  const enabledRef = useRef(true)

  const [enabled, setEnabled] = useState(true)

  useEffect(() => {
    enabledRef.current = enabled
    const ctx = ctxRef.current
    const master = masterRef.current
    if (!ctx || !master) return
    master.gain.setTargetAtTime(enabled ? LEVEL * CEILING : 0, ctx.currentTime, 0.6)
  }, [enabled])

  const stop = useCallback(() => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    for (const source of sourcesRef.current) {
      try {
        source.stop()
        source.disconnect()
      } catch {
        // already stopped
      }
    }
    sourcesRef.current = []
    ctxRef.current?.close().catch(() => undefined)
    ctxRef.current = null
    masterRef.current = null
  }, [])

  const start = useCallback(() => {
    if (ctxRef.current) return
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return

    const ctx = new Ctor()
    const master = ctx.createGain()
    master.gain.value = 0
    master.connect(ctx.destination)
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
    timerRef.current = window.setInterval(playNote, 2900)

    master.gain.setTargetAtTime(enabledRef.current ? LEVEL * CEILING : 0, ctx.currentTime, 1.8)
  }, [])

  // Autoplay policy: audio may only begin after a real gesture.
  useEffect(() => {
    const onGesture = () => start()
    window.addEventListener('pointerdown', onGesture, { once: true })
    window.addEventListener('keydown', onGesture, { once: true })
    return () => {
      window.removeEventListener('pointerdown', onGesture)
      window.removeEventListener('keydown', onGesture)
    }
  }, [start])

  useEffect(() => stop, [stop])

  return (
    <button
      type="button"
      onClick={() => {
        if (!ctxRef.current) {
          start()
          setEnabled(true)
          return
        }
        setEnabled((value) => !value)
      }}
      aria-pressed={enabled}
      aria-label={enabled ? 'Mute ambient score' : 'Play ambient score'}
      title="Ambient score · 40%"
      className="fixed bottom-5 right-5 z-40 flex size-10 items-center justify-center rounded-full border border-orbit/30 bg-void/70 text-moon backdrop-blur transition-colors hover:border-electric/60 hover:text-starlight"
    >
      {enabled ? <Music2 className="size-4" aria-hidden /> : <VolumeX className="size-4" aria-hidden />}
    </button>
  )
}
