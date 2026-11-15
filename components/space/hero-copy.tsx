'use client'

import { motion, type Variants } from 'motion/react'
import { forwardRef } from 'react'

type Props = {
  visible: boolean
  onMissions: () => void
  onRelics: () => void
}

const LINES = [['THE', 'UNIVERSE'], ['HOLDS', 'OUR', 'HISTORY.']]

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.035, delayChildren: 0.25 } },
}
const letter: Variants = {
  hidden: { opacity: 0, y: '0.55em', filter: 'blur(8px)' },
  show: { opacity: 1, y: 0, filter: 'blur(0px)', transition: { duration: 0.9, ease: [0.22, 1, 0.36, 1] } },
}
const fadeUp: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: (delay: number) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.9, delay, ease: [0.22, 1, 0.36, 1] },
  }),
}

const HeroCopy = forwardRef<HTMLDivElement, Props>(function HeroCopy({ visible, onMissions, onRelics }, ref) {
  return (
    <div
      ref={ref}
      className="pointer-events-none absolute inset-x-0 top-0 z-20 flex flex-col items-center px-5 pt-[84px] text-center sm:pt-[96px]"
    >
      <motion.div initial="hidden" animate={visible ? 'show' : 'hidden'} className="flex flex-col items-center">
        <motion.p
          variants={fadeUp}
          custom={0}
          className="font-hand text-[1.35rem] uppercase leading-none tracking-[0.18em] text-ivory sm:text-2xl"
        >
          A Journey Beyond Earth
        </motion.p>

        <motion.h1
          variants={container}
          aria-label="The universe holds our history."
          className="mt-3 font-display text-[clamp(1.85rem,min(5.4vw,6.8vh),4.4rem)] font-medium leading-[1.05] tracking-[0.04em] text-starlight"
        >
          {LINES.map((words, li) => (
            <span key={li} aria-hidden className="block">
              {words.map((word, wi) => (
                <span key={wi} className="inline-block whitespace-nowrap">
                  {word.split('').map((ch, ci) => (
                    <motion.span key={ci} variants={letter} className="inline-block">
                      {ch}
                    </motion.span>
                  ))}
                  {wi < words.length - 1 && <span className="inline-block w-[0.28em]" />}
                </span>
              ))}
            </span>
          ))}
        </motion.h1>

        <motion.p
          variants={fadeUp}
          custom={1.0}
          className="mt-4 max-w-[34rem] text-[13px] leading-relaxed text-moon/85 sm:text-[15px]"
        >
          Explore the forgotten footprints of humanity across distant worlds. Discover the spacecraft, missions and
          remarkable stories that remain written on the surfaces of the Moon and Mars.
        </motion.p>

        <motion.div variants={fadeUp} custom={1.25} className="pointer-events-auto mt-5 flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={onMissions}
            className="rounded-full bg-starlight px-6 py-3 font-display text-[11px] font-medium uppercase tracking-[0.24em] text-void shadow-[0_0_34px_rgba(243,245,255,0.22)] transition-all duration-300 hover:bg-white hover:shadow-[0_0_46px_rgba(131,183,255,0.5)]"
          >
            Explore Missions
          </button>
          <button
            type="button"
            onClick={onRelics}
            className="glass rounded-full px-6 py-3 font-display text-[11px] font-medium uppercase tracking-[0.24em] text-starlight transition-all duration-300 hover:border-electric/60 hover:bg-electric/10"
          >
            Discover the Relics
          </button>
        </motion.div>
      </motion.div>
    </div>
  )
})

export default HeroCopy
