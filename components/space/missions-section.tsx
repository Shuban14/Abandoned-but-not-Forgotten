'use client'

import { ArrowUpRight } from 'lucide-react'
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react'
import Image from 'next/image'
import Link from 'next/link'
import { useRef } from 'react'
import { MISSIONS } from '@/lib/space-data'

type Mission = (typeof MISSIONS)[number]

function MissionCard({ mission, index, reducedMotion }: { mission: Mission; index: number; reducedMotion: boolean }) {
  const ref = useRef<HTMLElement>(null)
  const px = useMotionValue(0.5)
  const py = useMotionValue(0.5)
  const sx = useSpring(px, { stiffness: 160, damping: 20 })
  const sy = useSpring(py, { stiffness: 160, damping: 20 })
  const rotateY = useTransform(sx, [0, 1], [-9, 9])
  const rotateX = useTransform(sy, [0, 1], [8, -8])

  const onMove = (e: React.PointerEvent) => {
    const el = ref.current
    if (!el || e.pointerType === 'touch') return
    const r = el.getBoundingClientRect()
    const x = (e.clientX - r.left) / r.width
    const y = (e.clientY - r.top) / r.height
    if (!reducedMotion) {
      px.set(x)
      py.set(y)
    }
    el.style.setProperty('--mx', `${x * 100}%`)
    el.style.setProperty('--my', `${y * 100}%`)
  }
  const onLeave = () => {
    px.set(0.5)
    py.set(0.5)
  }

  return (
    <motion.article
      ref={ref}
      initial={{ opacity: 0, y: 40 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.9, delay: index * 0.12, ease: [0.22, 1, 0.36, 1] }}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      style={
        {
          rotateX,
          rotateY,
          transformPerspective: 1100,
          '--glow': mission.glow,
          '--mx': '50%',
          '--my': '50%',
        } as React.CSSProperties
      }
      className="group relative w-[82vw] max-w-[22rem] shrink-0 snap-center rounded-[1.75rem] p-px transition-shadow duration-500 will-change-transform hover:shadow-[0_30px_90px_-20px_rgba(var(--glow),0.45)] md:w-auto md:max-w-none"
    >
      {/* Glowing border that follows the cursor */}
      <div className="absolute inset-0 rounded-[1.75rem] bg-[linear-gradient(160deg,rgba(129,150,196,0.3),rgba(129,150,196,0.06)_45%,rgba(129,150,196,0.18))]" />
      <div
        aria-hidden
        className="absolute inset-0 rounded-[1.75rem] opacity-0 transition-opacity duration-500 group-hover:opacity-100"
        style={{
          background:
            'radial-gradient(360px circle at var(--mx) var(--my), rgba(var(--glow),0.95), transparent 55%)',
        }}
      />

      <div className="relative flex h-full flex-col overflow-hidden rounded-[calc(1.75rem-1px)] bg-[#080c1d]">
        <div className="relative aspect-[16/10] overflow-hidden">
          <Image
            src={mission.image || '/placeholder.svg'}
            alt={mission.alt}
            fill
            sizes="(min-width: 768px) 33vw, 82vw"
            className="object-cover transition-transform duration-[1200ms] ease-out group-hover:scale-[1.07]"
          />
          <div
            aria-hidden
            className="absolute inset-0"
            style={{
              background: `linear-gradient(180deg, rgba(8,12,29,0) 40%, rgba(8,12,29,0.95) 100%), radial-gradient(120% 90% at 50% 0%, rgba(${mission.glow},0.22), transparent 60%)`,
            }}
          />
          <span className="absolute left-5 top-4 font-cinematic text-3xl italic text-ivory/90">{mission.index}</span>
        </div>

        <div className="flex flex-1 flex-col px-6 pb-6 pt-2">
          <p className="font-hand text-xl leading-none" style={{ color: mission.accent }}>
            {mission.eyebrow}
          </p>
          <h3 className="mt-2 font-display text-xl font-medium tracking-wide text-starlight">{mission.title}</h3>
          <p className="mt-3 flex-1 text-sm leading-relaxed text-moon/80">{mission.description}</p>
          <div
            className="mt-5 flex items-center gap-2 font-display text-[11px] font-medium uppercase tracking-[0.24em] transition-all duration-300 group-hover:gap-3"
            style={{ color: mission.accent }}
          >
            {mission.cta}
            <ArrowUpRight className="size-3.5" />
          </div>
        </div>
      </div>
      <Link
        href={mission.href}
        aria-label={`${mission.title} — ${mission.cta}`}
        className="absolute inset-0 z-20 rounded-[1.75rem]"
      />
    </motion.article>
  )
}

export default function MissionsSection({ reducedMotion }: { reducedMotion: boolean }) {
  return (
    <section id="missions" className="relative z-10 scroll-mt-4 px-5 pb-28 pt-28 sm:px-8 sm:pt-36">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-void to-transparent"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-1/3 h-[34rem] w-[min(60rem,120vw)] -translate-x-1/2 rounded-full bg-nebula-violet/10 blur-[120px]"
      />

      <div className="relative mx-auto max-w-6xl">
        <motion.div
          initial={{ opacity: 0, y: 28 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
          className="mx-auto max-w-2xl text-center"
        >
          <p className="font-hand text-2xl uppercase tracking-[0.18em] text-ivory">Chapters of exploration</p>
          <h2 className="mt-3 font-display text-3xl font-medium tracking-[0.08em] text-starlight sm:text-5xl">
            EXPLORE MISSIONS
          </h2>
          <p className="mx-auto mt-5 max-w-xl text-[15px] leading-relaxed text-moon/85">
            Every mission left behind a story. Discover the journeys that changed our understanding of other worlds.
          </p>
        </motion.div>

        <div className="-mx-5 mt-14 flex snap-x snap-mandatory gap-5 overflow-x-auto px-5 pb-6 [scrollbar-width:none] md:mx-0 md:grid md:grid-cols-3 md:gap-6 md:overflow-visible md:px-0 md:pb-0 [&::-webkit-scrollbar]:hidden">
          {MISSIONS.map((m, i) => (
            <MissionCard key={m.id} mission={m} index={i} reducedMotion={reducedMotion} />
          ))}
        </div>
      </div>
    </section>
  )
}
