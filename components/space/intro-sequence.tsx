'use client'

import { useEffect, useRef } from 'react'
import { fbm, mulberry32, smoothstep } from '@/lib/noise'

type Props = {
  onReveal: () => void
  onDone: () => void
}

const REVEAL_AT = 5.0
const FADE_START = 5.15
const FADE_DURATION = 1.5

type Puff = {
  x: number
  y: number
  vx: number
  vy: number
  age: number
  life: number
  size: number
  grow: number
  alpha: number
  variant: number
  rot: number
}

function makePuff(rgb: [number, number, number], seed: number) {
  const size = 160
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  const img = g.createImageData(size, size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = x / size - 0.5
      const v = y / size - 0.5
      const d = Math.sqrt(u * u + v * v) * 2
      const falloff = Math.pow(Math.max(0, 1 - d), 1.35)
      const n = fbm(u * 4 + seed, v * 4, seed * 0.7, 4, seed | 0)
      const a = Math.min(1, Math.max(0, (n - 0.2) * 2.1)) * falloff
      const i = (y * size + x) * 4
      const shade = 0.75 + n * 0.35
      img.data[i] = Math.min(255, rgb[0] * shade)
      img.data[i + 1] = Math.min(255, rgb[1] * shade)
      img.data[i + 2] = Math.min(255, rgb[2] * shade)
      img.data[i + 3] = a * 255
    }
  }
  g.putImageData(img, 0, 0)
  return c
}

export default function IntroSequence({ onReveal, onDone }: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const skipRef = useRef<number | null>(null)
  const callbacks = useRef({ onReveal, onDone })

  useEffect(() => {
    callbacks.current = { onReveal, onDone }
  }, [onReveal, onDone])

  useEffect(() => {
    const canvas = canvasRef.current
    const root = rootRef.current
    if (!canvas || !root) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const rand = mulberry32(2024)
    const smoke = [makePuff([226, 226, 236], 3), makePuff([205, 208, 222], 9)]
    const nebula = [makePuff([96, 112, 235], 5), makePuff([122, 92, 190], 12), makePuff([60, 90, 170], 17)]

    let width = 0
    let height = 0
    let dpr = 1
    let scale = 1
    const puffs: Puff[] = []
    const stars = Array.from({ length: 240 }, () => ({
      x: rand(),
      y: rand(),
      s: 0.4 + rand() * 1.3,
      p: rand() * 6.28,
      f: 0.8 + rand() * 2,
    }))
    const cities = Array.from({ length: 90 }, () => ({ a: rand(), b: rand(), s: 0.6 + rand() * 1.1 }))
    const clouds = Array.from({ length: 22 }, () => ({ a: rand(), b: rand(), w: 90 + rand() * 260, h: 10 + rand() * 18 }))

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      scale = Math.min(1.25, Math.max(0.6, Math.min(width, height) / 800))
    }

    let revealed = false
    let finished = false
    let raf = 0
    const start = performance.now()
    let lastT = 0
    let emitCarry = 0
    let bigCarry = 0
    let fadeFrom: number | null = null

    const rocketBaseY = () => height * 0.8 - 2
    const camY = (t: number) => (t > 2.2 ? Math.pow(t - 2.2, 2) * height * 0.07 : 0)
    const rocketWorldY = (t: number) => {
      if (t < 1.6) return rocketBaseY()
      const d = t - 1.6
      return rocketBaseY() - (d * d * 0.55 + d * d * d * 0.09) * height * 0.1
    }

    const spawn = (p: Partial<Puff> & Pick<Puff, 'x' | 'y'>, nebulaBias = false) => {
      puffs.push({
        vx: 0,
        vy: 0,
        age: 0,
        life: 3,
        size: 60,
        grow: 80,
        alpha: 0.5,
        variant: nebulaBias ? Math.floor(rand() * 3) : Math.floor(rand() * 3),
        rot: rand() * 6.28,
        ...p,
      })
    }

    const drawRocket = (x: number, y: number, s: number, flame: number, t: number) => {
      const L = 62 * s
      const w = L * 0.19
      ctx.save()
      ctx.translate(x, y)

      // Engine glow
      if (flame > 0.01) {
        ctx.globalCompositeOperation = 'lighter'
        const gr = L * (1.9 + Math.sin(t * 40) * 0.1) * flame
        const glow = ctx.createRadialGradient(0, L * 0.1, 0, 0, L * 0.1, gr)
        glow.addColorStop(0, 'rgba(255,214,160,0.75)')
        glow.addColorStop(0.35, 'rgba(255,140,70,0.28)')
        glow.addColorStop(1, 'rgba(255,120,60,0)')
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(0, L * 0.1, gr, 0, 6.283)
        ctx.fill()

        const fl = L * (0.95 + Math.random() * 0.25) * flame
        const f = ctx.createLinearGradient(0, 0, 0, fl)
        f.addColorStop(0, 'rgba(255,255,255,1)')
        f.addColorStop(0.25, 'rgba(255,214,150,0.95)')
        f.addColorStop(0.7, 'rgba(255,130,60,0.5)')
        f.addColorStop(1, 'rgba(255,90,40,0)')
        ctx.fillStyle = f
        ctx.beginPath()
        ctx.moveTo(-w * 0.62, 0)
        ctx.quadraticCurveTo(-w * 0.5, fl * 0.55, 0, fl)
        ctx.quadraticCurveTo(w * 0.5, fl * 0.55, w * 0.62, 0)
        ctx.closePath()
        ctx.fill()
        ctx.globalCompositeOperation = 'source-over'
      }

      // Fins
      ctx.fillStyle = '#C76B4B'
      ctx.beginPath()
      ctx.moveTo(-w * 0.95, -L * 0.28)
      ctx.lineTo(-w * 2.0, L * 0.12)
      ctx.lineTo(-w * 0.95, L * 0.02)
      ctx.closePath()
      ctx.fill()
      ctx.beginPath()
      ctx.moveTo(w * 0.95, -L * 0.28)
      ctx.lineTo(w * 2.0, L * 0.12)
      ctx.lineTo(w * 0.95, L * 0.02)
      ctx.closePath()
      ctx.fill()

      // Nozzle
      ctx.fillStyle = '#2a3042'
      ctx.beginPath()
      ctx.moveTo(-w * 0.55, 0)
      ctx.lineTo(-w * 0.75, L * 0.07)
      ctx.lineTo(w * 0.75, L * 0.07)
      ctx.lineTo(w * 0.55, 0)
      ctx.closePath()
      ctx.fill()

      // Body
      const body = ctx.createLinearGradient(-w, 0, w, 0)
      body.addColorStop(0, '#8e9ab2')
      body.addColorStop(0.45, '#f3f5ff')
      body.addColorStop(1, '#7f8dab')
      ctx.fillStyle = body
      ctx.beginPath()
      ctx.moveTo(0, -L)
      ctx.bezierCurveTo(w * 1.25, -L * 0.76, w, -L * 0.42, w, 0)
      ctx.lineTo(-w, 0)
      ctx.bezierCurveTo(-w, -L * 0.42, -w * 1.25, -L * 0.76, 0, -L)
      ctx.closePath()
      ctx.fill()

      // Nose tint, band and porthole
      ctx.fillStyle = '#C76B4B'
      ctx.beginPath()
      ctx.moveTo(0, -L)
      ctx.bezierCurveTo(w * 0.5, -L * 0.9, w * 0.62, -L * 0.82, w * 0.66, -L * 0.78)
      ctx.lineTo(-w * 0.66, -L * 0.78)
      ctx.bezierCurveTo(-w * 0.62, -L * 0.82, -w * 0.5, -L * 0.9, 0, -L)
      ctx.fill()
      ctx.fillStyle = '#0B1026'
      ctx.beginPath()
      ctx.arc(0, -L * 0.55, w * 0.38, 0, 6.283)
      ctx.fill()
      ctx.strokeStyle = '#83B7FF'
      ctx.lineWidth = Math.max(1, s)
      ctx.stroke()
      ctx.restore()
    }

    const drawEarth = (t: number) => {
      const fadeIn = smoothstep(0, 1.6, t)
      const R = width * 1.3
      const cx = width / 2
      const cy = height * 0.8 + R + camY(t)
      ctx.save()
      ctx.globalAlpha = fadeIn

      // Atmosphere halo
      const halo = ctx.createRadialGradient(cx, cy, R * 0.985, cx, cy, R * 1.07)
      halo.addColorStop(0, 'rgba(131,183,255,0.0)')
      halo.addColorStop(0.18, 'rgba(120,175,255,0.85)')
      halo.addColorStop(0.4, 'rgba(70,110,220,0.28)')
      halo.addColorStop(1, 'rgba(30,50,140,0)')
      ctx.fillStyle = halo
      ctx.beginPath()
      ctx.arc(cx, cy, R * 1.07, 0, 6.283)
      ctx.fill()

      // Surface
      const surf = ctx.createRadialGradient(cx, cy - R * 0.2, R * 0.2, cx, cy, R)
      surf.addColorStop(0, '#07122c')
      surf.addColorStop(0.82, '#0a1d46')
      surf.addColorStop(1, '#16397a')
      ctx.fillStyle = surf
      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, 6.283)
      ctx.fill()

      ctx.save()
      ctx.beginPath()
      ctx.arc(cx, cy, R, 0, 6.283)
      ctx.clip()
      // Clouds
      ctx.fillStyle = 'rgba(190,215,255,0.1)'
      for (const c of clouds) {
        const x = cx + (c.a - 0.5) * width * 1.4
        const y = cy - R + c.b * height * 0.22 + 6
        ctx.beginPath()
        ctx.ellipse(x, y, c.w, c.h, 0, 0, 6.283)
        ctx.fill()
      }
      // City lights
      ctx.fillStyle = 'rgba(245,214,162,0.85)'
      for (const c of cities) {
        const x = cx + (c.a - 0.5) * width * 1.3
        const y = cy - R + 14 + c.b * height * 0.16
        ctx.fillRect(x, y, c.s, c.s)
      }
      ctx.restore()
      ctx.restore()
    }

    const drawStarsAndNebula = (t: number) => {
      const a = smoothstep(3.0, 5.0, t)
      if (a <= 0) return
      ctx.save()
      ctx.globalCompositeOperation = 'lighter'
      ctx.globalAlpha = a
      const blobs: [number, number, number, string][] = [
        [0.28, 0.35, 0.55, 'rgba(70,84,200,0.42)'],
        [0.72, 0.28, 0.5, 'rgba(110,80,170,0.4)'],
        [0.5, 0.62, 0.62, 'rgba(50,80,170,0.34)'],
        [0.86, 0.72, 0.36, 'rgba(180,100,80,0.2)'],
      ]
      for (const [bx, by, br, col] of blobs) {
        const r = br * Math.max(width, height)
        const g = ctx.createRadialGradient(bx * width, by * height, 0, bx * width, by * height, r)
        g.addColorStop(0, col)
        g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g
        ctx.fillRect(0, 0, width, height)
      }
      // Milky Way streak
      ctx.translate(width / 2, height / 2)
      ctx.rotate(-0.5)
      const band = ctx.createLinearGradient(0, -height * 0.18, 0, height * 0.18)
      band.addColorStop(0, 'rgba(160,190,255,0)')
      band.addColorStop(0.5, 'rgba(190,205,255,0.16)')
      band.addColorStop(1, 'rgba(160,190,255,0)')
      ctx.fillStyle = band
      ctx.fillRect(-width, -height * 0.18, width * 2, height * 0.36)
      ctx.restore()

      ctx.save()
      ctx.globalAlpha = smoothstep(3.4, 5.0, t)
      for (const s of stars) {
        const tw = 0.55 + 0.45 * Math.sin(t * s.f + s.p)
        ctx.globalAlpha = smoothstep(3.4, 5.0, t) * tw
        ctx.fillStyle = '#F3F5FF'
        ctx.fillRect(s.x * width, s.y * height, s.s, s.s)
      }
      ctx.restore()
    }

    const drawPuffs = (t: number) => {
      const m = smoothstep(2.9, 4.8, t)
      const cy = camY(t)
      for (const p of puffs) {
        const k = p.age / p.life
        const env = Math.sin(Math.PI * Math.min(1, Math.pow(k, 0.7)))
        const size = p.size + p.grow * p.age
        const x = p.x
        const y = p.y + cy
        ctx.save()
        ctx.translate(x, y)
        ctx.rotate(p.rot + p.age * 0.12)
        if (m < 0.98) {
          ctx.globalAlpha = p.alpha * env * (1 - m)
          ctx.drawImage(smoke[p.variant % 2], -size / 2, -size / 2, size, size)
        }
        if (m > 0.02) {
          ctx.globalCompositeOperation = 'lighter'
          ctx.globalAlpha = p.alpha * env * m * 0.8
          ctx.drawImage(nebula[p.variant % 3], -size / 2, -size / 2, size, size)
        }
        ctx.restore()
      }
    }

    const frame = (now: number) => {
      const t = (now - start) / 1000
      const dt = Math.min(t - lastT, 0.05)
      lastT = t

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = 1
      ctx.fillStyle = '#02030a'
      ctx.fillRect(0, 0, width, height)

      drawEarth(t)

      const rx = width / 2
      const ry = rocketWorldY(t)
      const lift = t >= 1.6
      const ignite = smoothstep(1.0, 1.7, t)

      // Launch-pad flash on the ground
      if (t > 1.0 && t < 3.6) {
        const gA = ignite * (1 - smoothstep(2.4, 3.6, t))
        const gg = ctx.createRadialGradient(rx, rocketBaseY() + camY(t), 0, rx, rocketBaseY() + camY(t), 260 * scale)
        gg.addColorStop(0, `rgba(255,170,100,${0.5 * gA})`)
        gg.addColorStop(1, 'rgba(255,120,60,0)')
        ctx.globalCompositeOperation = 'lighter'
        ctx.fillStyle = gg
        ctx.fillRect(rx - 300 * scale, rocketBaseY() + camY(t) - 300 * scale, 600 * scale, 600 * scale)
        ctx.globalCompositeOperation = 'source-over'
      }

      // Emit smoke
      if (t > 1.0 && t < 4.9) {
        emitCarry += dt * (t < 2.8 ? 120 : 70)
        while (emitCarry >= 1 && puffs.length < 420) {
          emitCarry -= 1
          if (!lift || t < 2.3) {
            const dir = rand() < 0.5 ? -1 : 1
            spawn({
              x: rx + (rand() - 0.5) * 30 * scale,
              y: rocketBaseY() - rand() * 14 * scale,
              vx: dir * (50 + rand() * 230) * scale,
              vy: -(8 + rand() * 40),
              size: (50 + rand() * 60) * scale,
              grow: (70 + rand() * 90) * scale,
              life: 3 + rand() * 1.8,
              alpha: 0.5,
            })
          } else {
            spawn({
              x: rx + (rand() - 0.5) * 22 * scale,
              y: ry + 14 * scale - camY(t),
              vx: (rand() - 0.5) * 70 * scale,
              vy: 6 + rand() * 24,
              size: (34 + rand() * 40) * scale,
              grow: (80 + rand() * 120) * scale,
              life: 2.4 + rand() * 1.8,
              alpha: 0.42,
            })
          }
        }
      }
      // Big expanding smoke that swallows the frame
      if (t > 2.3 && t < 4.4) {
        bigCarry += dt * 13
        while (bigCarry >= 1) {
          bigCarry -= 1
          spawn(
            {
              x: width * (0.1 + rand() * 0.8),
              y: height * (0.45 + rand() * 0.5) - camY(t),
              vx: (rand() - 0.5) * 30,
              vy: -(10 + rand() * 30),
              size: (320 + rand() * 280) * scale,
              grow: (120 + rand() * 120) * scale,
              life: 2.6 + rand() * 1.4,
              alpha: 0.5,
            },
            true,
          )
        }
      }

      for (let i = puffs.length - 1; i >= 0; i--) {
        const p = puffs[i]
        p.age += dt
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.vx *= 1 - dt * 0.55
        if (p.age >= p.life) puffs.splice(i, 1)
      }

      drawPuffs(t)
      drawStarsAndNebula(t)

      // Rocket (leaves the frame as it climbs)
      const rs = scale * (1 - 0.45 * smoothstep(2.6, 4.8, t))
      if (t > 0.6 && ry < height + 100) {
        const rocketAlpha = smoothstep(0.5, 1.2, t) * (1 - smoothstep(4.2, 4.9, t))
        ctx.globalAlpha = rocketAlpha
        drawRocket(rx, ry + camY(t) * 0.0, rs, ignite * (lift ? 1 : 0.55 + Math.random() * 0.2), t)
        ctx.globalAlpha = 1
      }

      // Overall fade-in from black at the very start
      const start0 = 1 - smoothstep(0, 0.8, t)
      if (start0 > 0) {
        ctx.fillStyle = `rgba(2,3,10,${start0})`
        ctx.fillRect(0, 0, width, height)
      }

      if (!revealed && (t >= REVEAL_AT || skipRef.current !== null)) {
        revealed = true
        callbacks.current.onReveal()
      }

      let opacity = 1
      if (skipRef.current !== null) {
        if (fadeFrom === null) fadeFrom = t
        opacity = 1 - Math.min(1, (t - fadeFrom) / 0.6)
      } else if (t >= FADE_START) {
        if (fadeFrom === null) fadeFrom = t
        opacity = 1 - Math.min(1, (t - fadeFrom) / FADE_DURATION)
      }
      root.style.opacity = String(opacity)

      if (opacity <= 0 && !finished) {
        finished = true
        callbacks.current.onDone()
        return
      }
      raf = requestAnimationFrame(frame)
    }

    resize()
    window.addEventListener('resize', resize)
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
    }
  }, [])

  return (
    <div
      ref={rootRef}
      role="presentation"
      className="fixed inset-0 z-[100] bg-[#02030a]"
      aria-label="Launch sequence"
    >
      <canvas ref={canvasRef} aria-hidden className="block" />
      <button
        type="button"
        onClick={() => {
          skipRef.current = performance.now()
        }}
        className="glass absolute bottom-6 right-6 rounded-full px-4 py-2 font-display text-[11px] uppercase tracking-[0.28em] text-moon transition-colors hover:text-starlight sm:bottom-8 sm:right-8"
      >
        Skip intro
      </button>
    </div>
  )
}
