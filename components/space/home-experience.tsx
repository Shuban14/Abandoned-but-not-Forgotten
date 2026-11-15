'use client'

import { motion } from 'motion/react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { PLANETS, type PlanetId } from '@/lib/space-data'
import { computeLayout } from '@/lib/space-layout'
import HeroCopy from './hero-copy'
import IntroSequence from './intro-sequence'
import MissionsSection from './missions-section'
import Navbar from './navbar'
import PlanetPanel from './planet-panel'
import SiteFooter from './site-footer'
import Starfield from './starfield'
import type { PointerState } from './space-scene'

const SpaceScene = dynamic(() => import('./space-scene'), { ssr: false })

let introPlayed = false

type Metrics = { w: number; h: number; textBottom: number; panelTop: number }

function detectWebGL() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

export default function HomeExperience() {
  const router = useRouter()
  const heroRef = useRef<HTMLElement>(null)
  const textRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const pointer = useRef<PointerState>({ x: 0, y: 0, yaw: 0, pitch: 0, dragging: false })
  const drag = useRef({ active: false, x: 0, y: 0, moved: 0 })

  const [introActive, setIntroActive] = useState(true)
  const [revealed, setRevealed] = useState(false)
  const [reducedMotion, setReducedMotion] = useState(false)
  const [webgl, setWebgl] = useState<boolean | null>(null)
  const [heroInView, setHeroInView] = useState(true)
  const [metrics, setMetrics] = useState<Metrics | null>(null)
  const [activePlanet, setActivePlanet] = useState<PlanetId>('moon')
  const [hovered, setHovered] = useState<PlanetId | null>(null)
  const [focused, setFocused] = useState<PlanetId | null>(null)
  const [pulse, setPulse] = useState(false)

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    setReducedMotion(reduced)
    setWebgl(detectWebGL())
    if (introPlayed || reduced) {
      setIntroActive(false)
      setRevealed(true)
    }
  }, [])

  useLayoutEffect(() => {
    const hero = heroRef.current
    const text = textRef.current
    const panel = panelRef.current
    if (!hero || !text || !panel) return
    const measure = () => {
      setMetrics({
        w: hero.offsetWidth,
        h: hero.offsetHeight,
        textBottom: text.offsetTop + text.offsetHeight,
        panelTop: panel.offsetTop,
      })
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(hero)
    ro.observe(text)
    ro.observe(panel)
    document.fonts?.ready.then(measure)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const hero = heroRef.current
    if (!hero) return
    const io = new IntersectionObserver(([entry]) => setHeroInView(entry.isIntersecting), { threshold: 0 })
    io.observe(hero)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointer.current.x = (e.clientX / window.innerWidth) * 2 - 1
      pointer.current.y = (e.clientY / window.innerHeight) * 2 - 1
      const d = drag.current
      if (d.active) {
        const dx = e.clientX - d.x
        const dy = e.clientY - d.y
        d.x = e.clientX
        d.y = e.clientY
        d.moved += Math.abs(dx) + Math.abs(dy)
        pointer.current.yaw += dx * 0.006
        pointer.current.pitch = Math.max(-0.5, Math.min(0.5, pointer.current.pitch + dy * 0.004))
      }
    }
    const onUp = () => {
      drag.current.active = false
      pointer.current.dragging = false
    }
    window.addEventListener('pointermove', onMove, { passive: true })
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onUp)
    return () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onUp)
    }
  }, [])

  useEffect(() => {
    router.prefetch('/moon')
    router.prefetch('/mars')
  }, [router])

  const layout = useMemo(
    () => (metrics ? computeLayout(metrics.w, metrics.h, metrics.textBottom, metrics.panelTop) : null),
    [metrics],
  )

  const handleReveal = useCallback(() => setRevealed(true), [])
  const handleIntroDone = useCallback(() => {
    introPlayed = true
    setIntroActive(false)
  }, [])

  const enterPlanet = useCallback(
    (id: PlanetId) => {
      if (focused) return
      setFocused(id)
      setActivePlanet(id)
      window.setTimeout(() => router.push(PLANETS[id].href), 1150)
    },
    [focused, router],
  )

  const scrollToMissions = useCallback(() => {
    document.getElementById('missions')?.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth' })
  }, [reducedMotion])

  const pulsePanel = useCallback(() => {
    window.scrollTo({ top: 0, behavior: reducedMotion ? 'auto' : 'smooth' })
    setPulse(false)
    requestAnimationFrame(() => setPulse(true))
    window.setTimeout(() => setPulse(false), 3200)
  }, [reducedMotion])

  const startDrag = (e: React.PointerEvent) => {
    drag.current = { active: true, x: e.clientX, y: e.clientY, moved: 0 }
    pointer.current.dragging = true
  }

  const uiVisible = revealed && !focused
  const center = metrics ? { x: metrics.w / 2, y: metrics.h / 2 } : { x: 0, y: 0 }

  return (
    <>
      <Starfield pointer={pointer} reducedMotion={reducedMotion} shootingEnabled={revealed && !focused} />
      <Navbar visible={uiVisible} onExplore={pulsePanel} />

      <main className="relative z-10">
        <section
          id="home"
          ref={heroRef}
          className="relative h-svh min-h-[780px] overflow-hidden"
          aria-label="Space Relics home"
        >
          <div
            className="absolute inset-0 z-10 cursor-grab touch-pan-y select-none active:cursor-grabbing"
            onPointerDown={startDrag}
          >
            {webgl && layout && (
              <SpaceScene
                layout={layout}
                hovered={hovered}
                focused={focused}
                revealed={revealed}
                reducedMotion={reducedMotion}
                pointer={pointer}
                active={heroInView}
              />
            )}
            {webgl === false && layout && <FallbackPlanets layout={layout} center={center} revealed={revealed} />}

            {layout &&
              (['moon', 'mars'] as const).map((id) => {
                const s = layout[id]
                const size = s.r * 2.1
                return (
                  <button
                    key={id}
                    type="button"
                    aria-label={`${PLANETS[id].title}: ${PLANETS[id].cta}`}
                    disabled={!revealed || !!focused}
                    onPointerEnter={() => {
                      setHovered(id)
                      setActivePlanet(id)
                    }}
                    onPointerLeave={() => setHovered((h) => (h === id ? null : h))}
                    onFocus={() => {
                      setHovered(id)
                      setActivePlanet(id)
                    }}
                    onBlur={() => setHovered((h) => (h === id ? null : h))}
                    onClick={() => {
                      if (drag.current.moved > 8) return
                      enterPlanet(id)
                    }}
                    className="absolute z-20 rounded-full outline-offset-4 disabled:pointer-events-none"
                    style={{
                      width: size,
                      height: size,
                      left: center.x + s.x - size / 2,
                      top: center.y + s.y - size / 2,
                      cursor: 'pointer',
                    }}
                  />
                )
              })}

            {layout && !layout.mobile && metrics && metrics.w >= 1100 && (
              <>
                <Annotation
                  show={uiVisible}
                  text="Tranquility Base"
                  align="right"
                  left={center.x + layout.moon.x - layout.moon.r - 24}
                  top={center.y + layout.moon.y - layout.moon.r * 0.62}
                />
                <Annotation
                  show={uiVisible}
                  text="Jezero Crater"
                  align="left"
                  left={center.x + layout.mars.x + layout.mars.r + 24}
                  top={center.y + layout.mars.y - layout.mars.r * 0.72}
                />
              </>
            )}
          </div>

          <HeroCopy ref={textRef} visible={uiVisible} onMissions={scrollToMissions} onRelics={pulsePanel} />

          <PlanetPanel
            ref={panelRef}
            active={activePlanet}
            visible={uiVisible}
            pulse={pulse}
            onSelect={(id) => setActivePlanet(id)}
            onEnter={enterPlanet}
          />

          <motion.div
            aria-hidden
            initial={{ opacity: 0 }}
            animate={{ opacity: uiVisible ? 1 : 0 }}
            transition={{ duration: 1, delay: uiVisible ? 2 : 0 }}
            className="pointer-events-none absolute bottom-8 left-8 z-20 hidden items-center gap-3 font-display text-[10px] uppercase tracking-[0.35em] text-moon/70 lg:flex"
          >
            <span className="relative h-10 w-px overflow-hidden bg-orbit/30">
              <span
                className="absolute inset-x-0 top-0 h-1/2 bg-electric"
                style={{ animation: 'scroll-cue 2s ease-in-out infinite' }}
              />
            </span>
            Scroll
          </motion.div>
        </section>

        <MissionsSection reducedMotion={reducedMotion} />
        <SiteFooter />
      </main>

      {introActive && <IntroSequence onReveal={handleReveal} onDone={handleIntroDone} />}

      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-[90] bg-void transition-opacity duration-[900ms] ease-in"
        style={{ opacity: focused ? 1 : 0, transitionDelay: focused ? '350ms' : '0ms' }}
      />
    </>
  )
}

function Annotation({
  text,
  left,
  top,
  align,
  show,
}: {
  text: string
  left: number
  top: number
  align: 'left' | 'right'
  show: boolean
}) {
  return (
    <motion.span
      aria-hidden
      initial={{ opacity: 0 }}
      animate={{ opacity: show ? 0.85 : 0 }}
      transition={{ duration: 1.2, delay: show ? 2.4 : 0 }}
      className="pointer-events-none absolute z-20 whitespace-nowrap font-hand text-xl text-ivory"
      style={{
        top,
        left: align === 'right' ? undefined : left,
        right: align === 'right' ? `calc(100% - ${left}px)` : undefined,
        transform: `rotate(${align === 'right' ? -5 : 4}deg)`,
      }}
    >
      {text}
    </motion.span>
  )
}

function FallbackPlanets({
  layout,
  center,
  revealed,
}: {
  layout: NonNullable<ReturnType<typeof computeLayout>>
  center: { x: number; y: number }
  revealed: boolean
}) {
  const styles = {
    moon: 'radial-gradient(circle at 32% 30%, #E8EFF9 0%, #C6D0E0 22%, #7c8799 55%, #2b3246 85%, #0B1026 100%)',
    mars: 'radial-gradient(circle at 32% 30%, #F4B697 0%, #E99570 20%, #C76B4B 52%, #6a2f20 82%, #1a0b08 100%)',
  }
  return (
    <>
      {(['moon', 'mars'] as const).map((id) => {
        const s = layout[id]
        return (
          <div
            key={id}
            aria-hidden
            className="absolute rounded-full transition-all duration-[2000ms] ease-out"
            style={{
              width: s.r * 2,
              height: s.r * 2,
              left: center.x + s.x - s.r,
              top: center.y + s.y - s.r,
              background: styles[id],
              opacity: revealed ? 1 : 0,
              transform: revealed ? 'scale(1)' : 'scale(0.6)',
              boxShadow: `0 0 70px 6px ${id === 'moon' ? 'rgba(131,183,255,0.3)' : 'rgba(233,149,112,0.3)'}, inset -${s.r * 0.18}px -${s.r * 0.12}px ${s.r * 0.4}px rgba(0,0,0,0.55)`,
            }}
          />
        )
      })}
    </>
  )
}
