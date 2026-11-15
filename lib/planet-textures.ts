import { fbm, mulberry32, smoothstep } from './noise'

export type PlanetTextures = { map: HTMLCanvasElement; bump: HTMLCanvasElement }

const W = 1024
const H = 512
const TAU = Math.PI * 2

const frame = () => new Promise<void>((resolve) => setTimeout(resolve, 0))
const lerp = (a: number, b: number, t: number) => a + (b - a) * t

type RGB = [number, number, number]
const hex = (h: string): RGB => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
]
const mixRgb = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)]

function makeCanvas() {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  return canvas
}

/** Draw a crater, wrapping across the equirectangular seam. */
function eachWrap(x: number, radius: number, draw: (cx: number) => void) {
  draw(x)
  if (x - radius < 0) draw(x + W)
  if (x + radius > W) draw(x - W)
}

function drawCraters(
  color: CanvasRenderingContext2D,
  bump: CanvasRenderingContext2D,
  rand: () => number,
  count: number,
  maxRadius: number,
  strength: number,
) {
  for (let i = 0; i < count; i++) {
    const cx = rand() * W
    const cy = H * (0.06 + rand() * 0.88)
    const lat = (cy / H - 0.5) * Math.PI
    const stretch = 1 / Math.max(Math.cos(lat), 0.35)
    const r = 2.5 + Math.pow(rand(), 3.4) * maxRadius
    const rx = r * stretch
    const big = r > 22

    eachWrap(cx, rx * 1.5, (x) => {
      color.save()
      color.translate(x, cy)
      color.scale(stretch, 1)

      // Ejecta halo, shadowed floor, bright rim.
      const g = color.createRadialGradient(0, 0, 0, 0, 0, r * 1.45)
      g.addColorStop(0, `rgba(0,0,0,${0.3 * strength})`)
      g.addColorStop(0.4, `rgba(0,0,0,${0.18 * strength})`)
      g.addColorStop(0.6, `rgba(0,0,0,${0.04 * strength})`)
      g.addColorStop(0.69, `rgba(255,255,255,${0.26 * strength})`)
      g.addColorStop(0.8, `rgba(255,255,255,${0.07 * strength})`)
      g.addColorStop(1, 'rgba(255,255,255,0)')
      color.fillStyle = g
      color.beginPath()
      color.arc(0, 0, r * 1.45, 0, TAU)
      color.fill()
      if (big) {
        const peak = color.createRadialGradient(0, 0, 0, 0, 0, r * 0.2)
        peak.addColorStop(0, `rgba(255,255,255,${0.2 * strength})`)
        peak.addColorStop(1, 'rgba(255,255,255,0)')
        color.fillStyle = peak
        color.beginPath()
        color.arc(0, 0, r * 0.2, 0, TAU)
        color.fill()
      }
      color.restore()

      bump.save()
      bump.translate(x, cy)
      bump.scale(stretch, 1)
      const b = bump.createRadialGradient(0, 0, 0, 0, 0, r * 1.35)
      b.addColorStop(0, `rgba(20,20,20,${0.8 * strength})`)
      b.addColorStop(0.55, `rgba(40,40,40,${0.7 * strength})`)
      b.addColorStop(0.78, `rgba(120,120,120,${0.45 * strength})`)
      b.addColorStop(0.88, `rgba(255,255,255,${0.95 * strength})`)
      b.addColorStop(1, 'rgba(255,255,255,0)')
      bump.fillStyle = b
      bump.beginPath()
      bump.arc(0, 0, r * 1.35, 0, TAU)
      bump.fill()
      bump.restore()
    })
  }
}

export async function createMoonTextures(): Promise<PlanetTextures> {
  const map = makeCanvas()
  const bump = makeCanvas()
  const mctx = map.getContext('2d')!
  const bctx = bump.getContext('2d')!
  const colorData = mctx.createImageData(W, H)
  const bumpData = bctx.createImageData(W, H)

  const highland = hex('#b9bec8')
  const maria = hex('#5b6068')
  const dust = hex('#8d929c')

  for (let py = 0; py < H; py++) {
    const lat = (py / H - 0.5) * Math.PI
    const cl = Math.cos(lat)
    const sl = Math.sin(lat)
    for (let px = 0; px < W; px++) {
      const lon = (px / W) * TAU
      const x = cl * Math.cos(lon)
      const z = cl * Math.sin(lon)
      const y = sl

      const broad = fbm(x * 2.4, y * 2.4, z * 2.4, 4, 3)
      const mare = smoothstep(0.5, 0.6, fbm(x * 1.15 + 4, y * 1.15, z * 1.15, 3, 11))
      const grain = fbm(x * 22, y * 22, z * 22, 2, 7)
      let c = mixRgb(dust, highland, smoothstep(0.35, 0.68, broad))
      c = mixRgb(c, maria, mare * 0.78)
      const shade = 0.88 + (grain - 0.5) * 0.28
      const i = (py * W + px) * 4
      colorData.data[i] = c[0] * shade
      colorData.data[i + 1] = c[1] * shade
      colorData.data[i + 2] = Math.min(255, c[2] * shade * 1.03)
      colorData.data[i + 3] = 255

      const h = (0.5 + (broad - 0.5) * 0.5 - mare * 0.12 + (grain - 0.5) * 0.2) * 255
      bumpData.data[i] = bumpData.data[i + 1] = bumpData.data[i + 2] = h
      bumpData.data[i + 3] = 255
    }
    if (py % 48 === 0) await frame()
  }
  mctx.putImageData(colorData, 0, 0)
  bctx.putImageData(bumpData, 0, 0)

  const rand = mulberry32(42)
  drawCraters(mctx, bctx, rand, 90, 70, 1)
  await frame()
  drawCraters(mctx, bctx, rand, 420, 20, 0.9)
  await frame()
  drawCraters(mctx, bctx, rand, 900, 7, 0.8)

  return { map, bump }
}

export async function createMarsTextures(): Promise<PlanetTextures> {
  const map = makeCanvas()
  const bump = makeCanvas()
  const mctx = map.getContext('2d')!
  const bctx = bump.getContext('2d')!
  const colorData = mctx.createImageData(W, H)
  const bumpData = bctx.createImageData(W, H)

  const darkBasalt = hex('#3b1b12')
  const deepRust = hex('#7d3b27')
  const rust = hex('#c76b4b')
  const ochre = hex('#e99570')
  const cap = hex('#f2e6dd')

  for (let py = 0; py < H; py++) {
    const lat = (py / H - 0.5) * Math.PI
    const cl = Math.cos(lat)
    const sl = Math.sin(lat)
    for (let px = 0; px < W; px++) {
      const lon = (px / W) * TAU
      const x = cl * Math.cos(lon)
      const z = cl * Math.sin(lon)
      const y = sl

      const broad = fbm(x * 2.2, y * 2.2, z * 2.2, 5, 21)
      const fine = fbm(x * 14, y * 14, z * 14, 3, 5)
      const dark = smoothstep(0.52, 0.66, fbm(x * 1.5 + 9, y * 1.7, z * 1.5, 4, 33))
      const streak = fbm(x * 3, y * 9, z * 3, 3, 8)

      let c = mixRgb(deepRust, rust, smoothstep(0.25, 0.55, broad))
      c = mixRgb(c, ochre, smoothstep(0.52, 0.8, broad * 0.7 + streak * 0.5))
      c = mixRgb(c, darkBasalt, dark * 0.78)
      const shade = 0.9 + (fine - 0.5) * 0.35
      const capMask = smoothstep(0.86, 0.93, Math.abs(y) + (fbm(x * 7, y * 7, z * 7, 3, 2) - 0.5) * 0.12)
      c = mixRgb(c, cap, capMask)

      const i = (py * W + px) * 4
      colorData.data[i] = c[0] * shade
      colorData.data[i + 1] = c[1] * shade
      colorData.data[i + 2] = c[2] * shade
      colorData.data[i + 3] = 255

      const h = (0.5 + (broad - 0.5) * 0.7 - dark * 0.1 + (fine - 0.5) * 0.25) * 255
      bumpData.data[i] = bumpData.data[i + 1] = bumpData.data[i + 2] = h
      bumpData.data[i + 3] = 255
    }
    if (py % 48 === 0) await frame()
  }
  mctx.putImageData(colorData, 0, 0)
  bctx.putImageData(bumpData, 0, 0)

  // Canyon system along the equator.
  const canyon = (ctx: CanvasRenderingContext2D, color: string, width: number, blur: number) => {
    ctx.save()
    ctx.strokeStyle = color
    ctx.lineWidth = width
    ctx.lineCap = 'round'
    ctx.filter = `blur(${blur}px)`
    ctx.beginPath()
    ctx.moveTo(W * 0.2, H * 0.53)
    ctx.bezierCurveTo(W * 0.26, H * 0.5, W * 0.31, H * 0.57, W * 0.4, H * 0.54)
    ctx.stroke()
    ctx.restore()
  }
  canyon(mctx, 'rgba(40,16,10,0.55)', 9, 2.5)
  canyon(mctx, 'rgba(25,10,6,0.6)', 4, 1)
  canyon(bctx, 'rgba(0,0,0,0.8)', 8, 2)

  // A few bright volcanic domes.
  const dome = (cx: number, cy: number, r: number) => {
    const g = bctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    g.addColorStop(0, 'rgba(255,255,255,0.9)')
    g.addColorStop(1, 'rgba(255,255,255,0)')
    bctx.fillStyle = g
    bctx.beginPath()
    bctx.arc(cx, cy, r, 0, TAU)
    bctx.fill()
    const cg = mctx.createRadialGradient(cx, cy, 0, cx, cy, r)
    cg.addColorStop(0, 'rgba(233,149,112,0.45)')
    cg.addColorStop(1, 'rgba(233,149,112,0)')
    mctx.fillStyle = cg
    mctx.beginPath()
    mctx.arc(cx, cy, r, 0, TAU)
    mctx.fill()
  }
  dome(W * 0.12, H * 0.45, 34)
  dome(W * 0.15, H * 0.5, 22)
  dome(W * 0.1, H * 0.52, 18)

  const rand = mulberry32(7)
  drawCraters(mctx, bctx, rand, 55, 46, 0.8)
  await frame()
  drawCraters(mctx, bctx, rand, 340, 12, 0.65)

  return { map, bump }
}

/** Soft, tinted nebula cloud used as an additive sprite. */
export function createCloudTexture(rgb: RGB, seed: number, size = 256) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const img = ctx.createImageData(size, size)
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const u = px / size - 0.5
      const v = py / size - 0.5
      const d = Math.sqrt(u * u + v * v) * 2
      const falloff = Math.pow(Math.max(0, 1 - d), 1.6)
      const n = fbm(u * 3.2 + seed, v * 3.2, seed * 0.5, 5, seed | 0)
      const a = Math.min(1, Math.max(0, (n - 0.28) * 2.2)) * falloff
      const i = (py * size + px) * 4
      img.data[i] = rgb[0]
      img.data[i + 1] = rgb[1]
      img.data[i + 2] = rgb[2]
      img.data[i + 3] = a * 255
    }
  }
  ctx.putImageData(img, 0, 0)
  return canvas
}

export function createGlowTexture(size = 64) {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, size, size)
  return canvas
}
