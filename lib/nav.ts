// One source of truth for site navigation.
// Order is intentional: GAME is always the final destination.
export type NavLink = { label: string; href: string; match?: string }

export const NAV_LINKS: NavLink[] = [
  { label: 'Home', href: '/' },
  { label: 'Moon', href: '/moon' },
  { label: 'Mars', href: '/mars' },
  { label: 'Missions', href: '/missions' },
  { label: 'About', href: '/#about' },
  { label: 'Game', href: '/game' },
]

/** True when `pathname` belongs to this link (hash links never match). */
export function isActiveLink(href: string, pathname: string) {
  if (href.includes('#')) return false
  if (href === '/') return pathname === '/'
  return pathname === href || pathname.startsWith(`${href}/`)
}
