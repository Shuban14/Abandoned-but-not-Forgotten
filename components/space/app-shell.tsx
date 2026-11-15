'use client'

import { usePathname } from 'next/navigation'
import AmbientScore from './ambient-score'
import Navbar from './navbar'
import PageTransition from './page-transition'
import SpaceBackdrop from './space-backdrop'

/**
 * The shared shell every route lives inside.
 *
 * The homepage renders its own copy of the same <Navbar> because its nav is
 * driven by the intro sequence; every other route mounts this one, which stays
 * mounted as the user moves between Moon, Mars, Missions and Game.
 */
export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isHome = pathname === '/'

  return (
    <>
      {!isHome && <SpaceBackdrop />}
      {!isHome && <Navbar />}
      {isHome && <AmbientScore />}
      <PageTransition>{children}</PageTransition>
    </>
  )
}
