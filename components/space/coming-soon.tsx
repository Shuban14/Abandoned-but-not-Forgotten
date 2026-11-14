'use client'

import { ArrowLeft } from 'lucide-react'
import { motion } from 'motion/react'
import Link from 'next/link'
import { useRef } from 'react'
import { Logo } from './navbar'
import Starfield from './starfield'
import type { PointerState } from './space-scene'

type Props = {
  name: string
  tagline: string
  tone: 'moon' | 'mars'
}

const ORB = {
  moon: {
    background:
      'radial-gradient(circle at 32% 30%, #E8EFF9 0%, #C6D0E0 22%, #7c8799 55%, #2b3246 85%, #0B1026 100%)',
    glow: 'rgba(131,183,255,0.45)',
  },
  mars: {
    background:
      'radial-gradient(circle at 32% 30%, #F4B697 0%, #E99570 20%, #C76B4B 52%, #6a2f20 82%, #1a0b08 100%)',
    glow: 'rgba(233,149,112,0.45)',
  },
}

export default function ComingSoon({ name, tagline, tone }: Props) {
  const pointer = useRef<PointerState>({ x: 0, y: 0, yaw: 0, pitch: 0, dragging: false })
  const orb = ORB[tone]

  return (
    <main className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden px-6 text-center">
      <Starfield pointer={pointer} reducedMotion={false} shootingEnabled />
      <div className="absolute left-5 top-5 z-10 sm:left-8 sm:top-7">
        <Logo />
      </div>

      <motion.div
        initial={{ opacity: 0, scale: 0.7 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }}
        aria-hidden
        className="relative z-10 size-40 rounded-full sm:size-52"
        style={{ background: orb.background, boxShadow: `0 0 90px 10px ${orb.glow}, inset -18px -14px 40px rgba(0,0,0,0.55)` }}
      />

      <motion.div
        initial={{ opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 1, delay: 0.5, ease: [0.22, 1, 0.36, 1] }}
        className="relative z-10 mt-10 flex flex-col items-center"
      >
        <p className="font-hand text-2xl uppercase tracking-[0.18em] text-ivory">{tagline}</p>
        <h1 className="mt-3 font-display text-3xl font-medium tracking-[0.1em] text-starlight sm:text-5xl">
          {name.toUpperCase()}
        </h1>
        <p className="mt-4 font-cinematic text-xl italic text-moon-hi sm:text-2xl">
          Coming Soon — Exploration Module
        </p>
        <Link
          href="/"
          className="glass group mt-9 inline-flex items-center gap-2.5 rounded-full px-6 py-3 font-display text-[11px] font-medium uppercase tracking-[0.24em] text-starlight transition-all hover:border-electric/60 hover:bg-electric/10"
        >
          <ArrowLeft className="size-3.5 transition-transform duration-300 group-hover:-translate-x-1" />
          Back to Home
        </Link>
      </motion.div>
    </main>
  )
}
