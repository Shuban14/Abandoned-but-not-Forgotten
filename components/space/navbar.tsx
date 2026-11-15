'use client'

import { Menu, X } from 'lucide-react'
import { motion } from 'motion/react'
import Link from 'next/link'
import { useEffect, useState } from 'react'

type Props = {
  visible: boolean
  onExplore: () => void
}

const LINKS = [
  { label: 'Home', href: '#home' },
  { label: 'Explore Missions', href: '#missions' },
  { label: 'About', href: '#about' },
]

export function Logo() {
  return (
    <Link href="/" className="group flex items-center gap-2.5" aria-label="Space Relics home">
      <svg width="26" height="26" viewBox="0 0 26 26" fill="none" aria-hidden className="shrink-0">
        <ellipse
          cx="13"
          cy="13"
          rx="12"
          ry="4.6"
          transform="rotate(-24 13 13)"
          stroke="#8196C4"
          strokeOpacity="0.7"
          strokeWidth="0.9"
        />
        <circle cx="13" cy="13" r="6" fill="url(#logo-planet)" />
        <circle cx="21.2" cy="8.6" r="1.4" fill="#E99570" />
        <defs>
          <radialGradient id="logo-planet" cx="0.35" cy="0.32" r="0.9">
            <stop stopColor="#E8EFF9" />
            <stop offset="0.55" stopColor="#8196C4" />
            <stop offset="1" stopColor="#171B3A" />
          </radialGradient>
        </defs>
      </svg>
      <span className="font-display text-[13px] font-medium uppercase tracking-[0.3em] text-starlight transition-colors group-hover:text-moon-hi">
        Space Relics
      </span>
    </Link>
  )
}

export default function Navbar({ visible, onExplore }: Props) {
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 48)
    onScroll()
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return (
    <motion.header
      initial={{ opacity: 0, y: -18 }}
      animate={visible ? { opacity: 1, y: 0 } : { opacity: 0, y: -18 }}
      transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1] }}
      className="pointer-events-none fixed inset-x-0 top-0 z-50 flex justify-center px-3 pt-3 sm:px-5 sm:pt-4"
    >
      <nav
        aria-label="Primary"
        className={`glass pointer-events-auto relative flex w-full items-center justify-between rounded-full transition-all duration-500 ease-out ${
          scrolled ? 'max-w-3xl px-4 py-2 sm:px-5' : 'max-w-6xl px-4 py-3 sm:px-6'
        }`}
      >
        <Logo />

        <ul className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <li key={l.href}>
              <a
                href={l.href}
                className="relative rounded-full px-4 py-2 font-display text-[11px] font-medium uppercase tracking-[0.22em] text-moon transition-colors hover:text-starlight"
              >
                {l.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onExplore}
            className="hidden rounded-full border border-electric/40 bg-electric/10 px-4 py-2 font-display text-[11px] font-medium uppercase tracking-[0.2em] text-starlight transition-all hover:border-electric/80 hover:bg-electric/20 hover:shadow-[0_0_28px_rgba(131,183,255,0.35)] sm:inline-flex"
          >
            Explore Universe
          </button>
          <button
            type="button"
            aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open}
            onClick={() => setOpen((v) => !v)}
            className="flex size-9 items-center justify-center rounded-full text-starlight md:hidden"
          >
            {open ? <X className="size-5" /> : <Menu className="size-5" />}
          </button>
        </div>

        {open && (
          <div className="glass absolute inset-x-0 top-[calc(100%+8px)] rounded-3xl p-3 md:hidden">
            <ul className="flex flex-col">
              {LINKS.map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    onClick={() => setOpen(false)}
                    className="block rounded-2xl px-4 py-3 font-display text-xs uppercase tracking-[0.22em] text-moon hover:bg-white/5 hover:text-starlight"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
              <li className="p-1 pt-2">
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    onExplore()
                  }}
                  className="w-full rounded-full border border-electric/40 bg-electric/10 px-4 py-3 font-display text-xs uppercase tracking-[0.2em] text-starlight"
                >
                  Explore Universe
                </button>
              </li>
            </ul>
          </div>
        )}
      </nav>
    </motion.header>
  )
}
