'use client'

import { ArrowRight } from 'lucide-react'
import { motion } from 'motion/react'
import Link from 'next/link'
import { forwardRef } from 'react'
import { PLANETS, type PlanetId } from '@/lib/space-data'

type Props = {
  active: PlanetId
  visible: boolean
  pulse: boolean
  onSelect: (id: PlanetId) => void
  onEnter: (id: PlanetId) => void
}

const ORDER: PlanetId[] = ['moon', 'mars']

const PlanetPanel = forwardRef<HTMLDivElement, Props>(function PlanetPanel(
  { active, visible, pulse, onSelect, onEnter },
  ref,
) {
  return (
    <motion.div
      ref={ref}
      id="planet-info"
      initial={{ opacity: 0, y: 24 }}
      animate={visible ? { opacity: 1, y: 0 } : { opacity: 0, y: 24 }}
      transition={{ duration: 0.9, delay: visible ? 0.9 : 0, ease: [0.22, 1, 0.36, 1] }}
      className={`glass absolute inset-x-3 bottom-4 z-30 mx-auto w-auto max-w-[26rem] rounded-3xl p-4 sm:bottom-6 sm:p-5 ${
        pulse ? 'panel-pulse' : ''
      }`}
    >
      <div role="tablist" aria-label="Planets" className="relative mb-3 flex gap-1 rounded-full bg-white/[0.04] p-1">
        {ORDER.map((id) => {
          const selected = active === id
          return (
            <button
              key={id}
              type="button"
              role="tab"
              id={`tab-${id}`}
              aria-selected={selected}
              aria-controls={`panel-${id}`}
              onClick={() => onSelect(id)}
              onFocus={() => onSelect(id)}
              className={`relative flex-1 rounded-full py-1.5 font-display text-[11px] font-medium uppercase tracking-[0.28em] transition-colors duration-300 ${
                selected ? 'text-void' : 'text-moon hover:text-starlight'
              }`}
            >
              {selected && (
                <motion.span
                  layoutId="planet-tab"
                  transition={{ type: 'spring', stiffness: 380, damping: 34 }}
                  className="absolute inset-0 rounded-full"
                  style={{ background: id === 'moon' ? '#C6D0E0' : '#E99570' }}
                />
              )}
              <span className="relative">{PLANETS[id].tab}</span>
            </button>
          )
        })}
      </div>

      <div className="grid">
        {ORDER.map((id) => {
          const p = PLANETS[id]
          const selected = active === id
          return (
            <div
              key={id}
              role="tabpanel"
              id={`panel-${id}`}
              aria-labelledby={`tab-${id}`}
              aria-hidden={!selected}
              className="col-start-1 row-start-1 transition-all duration-500 ease-out"
              style={{
                opacity: selected ? 1 : 0,
                transform: selected ? 'translateY(0)' : 'translateY(6px)',
                pointerEvents: selected ? 'auto' : 'none',
              }}
            >
              <h2 className="font-display text-lg font-medium tracking-wide text-starlight">{p.title}</h2>
              <p className="mt-1.5 text-[13px] leading-relaxed text-moon/85">{p.description}</p>
              <Link
                href={p.href}
                tabIndex={selected ? 0 : -1}
                onClick={(e) => {
                  e.preventDefault()
                  onEnter(id)
                }}
                className="group mt-3 inline-flex items-center gap-2 font-display text-[11px] font-medium uppercase tracking-[0.24em]"
                style={{ color: p.accent }}
              >
                {p.cta}
                <ArrowRight className="size-3.5 transition-transform duration-300 group-hover:translate-x-1" />
              </Link>
            </div>
          )
        })}
      </div>
    </motion.div>
  )
})

export default PlanetPanel
