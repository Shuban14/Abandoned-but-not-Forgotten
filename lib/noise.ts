function hash(ix: number, iy: number, iz: number, seed: number) {
  let h =
    (Math.imul(ix, 0x27d4eb2d) ^
      Math.imul(iy, 0x165667b1) ^
      Math.imul(iz, 0x9e3779b1) ^
      Math.imul(seed + 1, 0x85ebca6b)) |
    0
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d)
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39)
  h ^= h >>> 15
  return (h >>> 0) / 4294967295
}

const fade = (t: number) => t * t * (3 - 2 * t)
const mix = (a: number, b: number, t: number) => a + (b - a) * t

export function valueNoise(x: number, y: number, z: number, seed = 0) {
  const xi = Math.floor(x)
  const yi = Math.floor(y)
  const zi = Math.floor(z)
  const xf = fade(x - xi)
  const yf = fade(y - yi)
  const zf = fade(z - zi)
  const c000 = hash(xi, yi, zi, seed)
  const c100 = hash(xi + 1, yi, zi, seed)
  const c010 = hash(xi, yi + 1, zi, seed)
  const c110 = hash(xi + 1, yi + 1, zi, seed)
  const c001 = hash(xi, yi, zi + 1, seed)
  const c101 = hash(xi + 1, yi, zi + 1, seed)
  const c011 = hash(xi, yi + 1, zi + 1, seed)
  const c111 = hash(xi + 1, yi + 1, zi + 1, seed)
  return mix(
    mix(mix(c000, c100, xf), mix(c010, c110, xf), yf),
    mix(mix(c001, c101, xf), mix(c011, c111, xf), yf),
    zf,
  )
}

export function fbm(x: number, y: number, z: number, octaves: number, seed = 0) {
  let amp = 0.5
  let freq = 1
  let sum = 0
  let norm = 0
  for (let i = 0; i < octaves; i++) {
    sum += amp * valueNoise(x * freq + i * 17.3, y * freq - i * 9.1, z * freq + i * 5.7, seed + i)
    norm += amp
    amp *= 0.5
    freq *= 2.03
  }
  return sum / norm
}

export function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const smoothstep = (e0: number, e1: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0)))
  return t * t * (3 - 2 * t)
}
