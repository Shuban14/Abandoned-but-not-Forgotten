// Launch sites shipped with the Launch Lab simulation.
//
// Framework-free on purpose: `lib/missions.ts` (server validation) and the
// mission migration scripts (`scripts/import-missions.mjs`) must agree on the
// canonical name of every site, and a mismatch there silently rewrites stored
// mission history.

/** id → display name, matching `public/space/sim.js`. */
export const LAUNCH_SITES = {
  shar: 'Satish Dhawan Space Centre',
  kourou: 'Guiana Space Centre',
  cape: 'Cape Canaveral',
  baikonur: 'Baikonur Cosmodrome',
  jiuquan: 'Jiuquan Launch Centre',
  tanegashima: 'Tanegashima Space Center',
  mahia: 'Mahia Peninsula',
  vandenberg: 'Vandenberg (polar launches)',
}

/**
 * The best display name for a stored mission.
 *
 * A name already recorded on the mission always wins — it is historical data,
 * and the canonical table may have been edited since. The table is used only
 * when the record has no usable name, and the raw id only when the site is not
 * one we know at all.
 *
 * @param {{ siteId?: unknown, siteName?: unknown }} mission
 * @returns {string}
 */
export function resolveSiteName(mission) {
  const recorded = typeof mission?.siteName === 'string' ? mission.siteName.trim() : ''
  if (recorded) return recorded
  const id = typeof mission?.siteId === 'string' ? mission.siteId.trim() : ''
  return LAUNCH_SITES[id] ?? id
}
