export type PlanetSlot = { x: number; y: number; r: number }

export type SpaceLayout = {
  moon: PlanetSlot
  mars: PlanetSlot
  mobile: boolean
}

/**
 * Pixel layout (relative to the hero centre, y pointing down) shared by the
 * WebGL scene and the DOM hit areas so both always line up.
 */
export function computeLayout(
  width: number,
  height: number,
  textBottom: number,
  panelTop: number,
): SpaceLayout {
  const mobile = width < 900
  const top = textBottom + 14
  const bottom = Math.max(panelTop - 14, top + 160)
  const zoneH = bottom - top
  const centerY = top + zoneH / 2 - height / 2

  const maxByHeight = zoneH / 2 / 1.12
  const moonR = Math.max(
    38,
    mobile ? Math.min(width * 0.2, maxByHeight) : Math.min(width * 0.1, 200, maxByHeight),
  )
  const marsR = moonR * (mobile ? 0.76 : 0.78)
  const gap = moonR * (mobile ? 0.55 : 1.45)
  const total = moonR * 2 + gap + marsR * 2

  return {
    mobile,
    moon: { x: -total / 2 + moonR, y: centerY, r: moonR },
    mars: { x: total / 2 - marsR, y: centerY - moonR * 0.1, r: marsR },
  }
}
