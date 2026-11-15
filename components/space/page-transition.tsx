'use client'

import { motion } from 'motion/react'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'

/**
 * Enter-only route transition: a 240 ms fade with a 6 px rise.
 *
 * The homepage is exempt because it runs its own reveal sequence, and it keeps
 * `position: fixed` children (nav, intro overlay) that must not be re-parented
 * by a transforming wrapper. Because only the incoming page animates, the
 * outgoing page is never left blank and the shared shell never remounts.
 */
export default function PageTransition({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)')
    setReduced(query.matches)
    const onChange = () => setReduced(query.matches)
    query.addEventListener('change', onChange)
    return () => query.removeEventListener('change', onChange)
  }, [])

  if (pathname === '/') return <>{children}</>

  // One timing for every tab: the same fade-and-rise the Moon route uses.
  return (
    <motion.div
      key={pathname}
      initial={{ opacity: 0, y: reduced ? 0 : 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduced ? 0 : 0.24, ease: [0.22, 1, 0.36, 1] }}
      className="relative z-10"
    >
      {children}
    </motion.div>
  )
}
