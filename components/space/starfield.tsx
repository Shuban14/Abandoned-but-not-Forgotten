'use client'

import { useEffect, useRef, type MutableRefObject } from 'react'
import type { PointerState } from './space-scene'

type Props = {
  pointer: MutableRefObject<PointerState>
  reducedMotion: boolean
  shootingEnabled: boolean
}

type Star = { x: number; y: number; depth: number; size: number; speed: number; phase: number; tint: string }
type Constellation = {
  ax: number
  ay: number
  scale: number
  points: [number, number][]
  edges: [number, number][]
}

const CONSTELLATIONS: Constellation[] = [
  {
    // Orion
    ax: 0.12,
    ay: 0.24,
    scale: 1,
    points: [[-0.5, -0.9], [0.5, -0.85], [-0.15, 0], [0, 0.02], [0.15, 0.04], [-0.55, 0.9], [0.55, 0.85], [0, -1.05]],
    edges: [[7, 0], [7, 1], [0, 2], [1, 4], [2, 3], [3, 4], [2, 5], [4, 6]],
  },
  {
    // Big Dipper
    ax: 0.86,
    ay: 0.2,
    scale: 0.95,
    points: [[-1, 0.1], [-0.55, 0.2], [-0.15, 0.12], [0.2, 0.25], [0.25, 0.68], [0.8, 0.62], [0.85, 0.18]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 3]],
  },
  {
    // Cassiopeia
    ax: 0.9,
    ay: 0.62,
    scale: 0.85,
    points: [[-1, 0.2], [-0.5, -0.3], [0, 0.25], [0.5, -0.25], [1, 0.15]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4]],
  },
  {
    // Scorpius
    ax: 0.08,
    ay: 0.74,
    scale: 0.9,
    points: [[0, -1], [0.15, -0.7], [0.2, -0.4], [0.1, -0.1], [0, 0.2], [0.1, 0.5], [0.35, 0.7], [0.6, 0.6], [0.65, 0.35]],
    edges: [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [5, 6], [6, 7], [7, 8]],
  },
  {
    // Cygnus
    ax: 0.66,
    ay: 0.9,
    scale: 0.7,
    points: [[0, -1], [0, -0.35], [0, 0.2], [0, 0.9], [-0.8, -0.15], [0.8, -0.15]],
    edges: [[0, 1], [1, 2], [2, 3], [4, 1], [1, 5]],
  },
  {
    // Lyra
    ax: 0.34,
    ay: 0.07,
    scale: 0.55,
    points: [[0, -0.9], [-0.35, 0], [0.35, 0.05], [-0.3, 0.9], [0.4, 0.95]],
    edges: [[0, 1], [0, 2], [1, 2], [1, 3], [3, 4], [4, 2]],
  },
]

type Shooter = { x: number; y: number; vx: number; vy: number; life: number; duration: number; length: number }

const TINTS = ['243,245,255', '243,245,255', '189,214,255', '131,183,255', '245,214,162']

function makeGlowSprite() {
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.18, 'rgba(255,255,255,0.7)')
  grad.addColorStop(0.5, 'rgba(180,205,255,0.16)')
  grad.addColorStop(1, 'rgba(180,205,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  return c
}

export default function Starfield({ pointer, reducedMotion, shootingEnabled }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const shootingRef = useRef(shootingEnabled)

  useEffect(() => {
    shootingRef.current = shootingEnabled
  }, [shootingEnabled])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const glow = makeGlowSprite()
    let width = 0
    let height = 0
    let dpr = 1
    let stars: Star[] = []
    const hover = CONSTELLATIONS.map(() => 0)
    const mouse = { x: -9999, y: -9999 }
    const shooters: Shooter[] = []
    let nextShooterAt = 0
    let raf = 0
    let last = performance.now()
    let time = 0

    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      width = window.innerWidth
      height = window.innerHeight
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      canvas.style.width = `${width}px`
      canvas.style.height = `${height}px`
      const count = Math.round(Math.min(320, Math.max(110, (width * height) / 7500)))
      stars = Array.from({ length: count }, () => ({
        x: Math.random(),
        y: Math.random(),
        depth: 0.25 + Math.random() * 0.75,
        size: Math.random() < 0.08 ? 1.6 + Math.random() * 0.8 : 0.5 + Math.random() * 0.9,
        speed: 0.5 + Math.random() * 1.6,
        phase: Math.random() * Math.PI * 2,
        tint: TINTS[Math.floor(Math.random() * TINTS.length)],
      }))
    }

    const onMove = (e: PointerEvent) => {
      mouse.x = e.clientX
      mouse.y = e.clientY
    }
    const onLeave = () => {
      mouse.x = mouse.y = -9999
    }

    const scheduleShooter = (now: number, first = false) => {
      nextShooterAt = now + (first ? 2500 + Math.random() * 3000 : 8000 + Math.random() * 8000)
    }

    const spawnShooter = () => {
      const fromLeft = Math.random() < 0.5
      const angle = ((12 + Math.random() * 38) * Math.PI) / 180
      const dir = fromLeft ? 1 : -1
      const speed = 900 + Math.random() * 600
      const x = fromLeft ? -40 + Math.random() * width * 0.45 : width + 40 - Math.random() * width * 0.45
      const y = Math.random() * height * 0.45
      shooters.push({
        x,
        y,
        vx: Math.cos(angle) * speed * dir,
        vy: Math.sin(angle) * speed,
        life: 0,
        duration: 0.95 + Math.random() * 0.5,
        length: 150 + Math.random() * 130,
      })
    }

    const drawStarGlow = (x: number, y: number, size: number, alpha: number) => {
      ctx.globalAlpha = alpha
      ctx.drawImage(glow, x - size, y - size, size * 2, size * 2)
    }

    const frame = (now: number) => {
      const dt = Math.min((now - last) / 1000, 0.05)
      last = now
      time += dt
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, width, height)

      const px = reducedMotion ? 0 : pointer.current.x
      const py = reducedMotion ? 0 : pointer.current.y
      const sy = window.scrollY

      for (const s of stars) {
        const tw = reducedMotion ? 0.8 : 0.5 + 0.5 * Math.sin(time * s.speed + s.phase)
        const alpha = 0.25 + tw * 0.75 * (0.5 + s.depth * 0.5)
        const x = s.x * width - px * 16 * s.depth
        const y = (((s.y * height - sy * 0.05 * s.depth - py * 12 * s.depth) % height) + height) % height
        ctx.globalAlpha = alpha
        ctx.fillStyle = `rgb(${s.tint})`
        if (s.size > 1.4) {
          drawStarGlow(x, y, s.size * 4.5, alpha * 0.55)
          ctx.globalAlpha = alpha
        }
        ctx.beginPath()
        ctx.arc(x, y, s.size * 0.7, 0, Math.PI * 2)
        ctx.fill()
      }

      const unit = Math.min(Math.max(Math.min(width, height) * 0.085, 24), 84)
      CONSTELLATIONS.forEach((c, ci) => {
        const depth = 0.55
        const ox = c.ax * width - px * 16 * depth
        const oy = c.ay * height - sy * 0.05 * depth - py * 12 * depth
        const u = unit * c.scale
        const pts = c.points.map(([x, y]) => [ox + x * u, oy + y * u] as const)

        let minX = Infinity
        let maxX = -Infinity
        let minY = Infinity
        let maxY = -Infinity
        for (const [x, y] of pts) {
          minX = Math.min(minX, x)
          maxX = Math.max(maxX, x)
          minY = Math.min(minY, y)
          maxY = Math.max(maxY, y)
        }
        const pad = 36
        const inside =
          mouse.x > minX - pad && mouse.x < maxX + pad && mouse.y > minY - pad && mouse.y < maxY + pad
        hover[ci] += ((inside ? 1 : 0) - hover[ci]) * Math.min(1, dt * 5)
        const b = hover[ci]
        const breathe = reducedMotion ? 0.8 : 0.7 + 0.3 * Math.sin(time * 0.6 + ci * 1.7)

        ctx.lineWidth = 0.8
        ctx.strokeStyle = '#8196C4'
        ctx.globalAlpha = (0.13 + 0.42 * b) * breathe
        ctx.beginPath()
        for (const [a, e] of c.edges) {
          ctx.moveTo(pts[a][0], pts[a][1])
          ctx.lineTo(pts[e][0], pts[e][1])
        }
        ctx.stroke()

        pts.forEach(([x, y], i) => {
          const tw = reducedMotion ? 0.8 : 0.55 + 0.45 * Math.sin(time * (0.9 + (i % 4) * 0.35) + i * 2.1 + ci * 5)
          const a = Math.min(1, (0.55 + 0.45 * tw) * (0.8 + 0.6 * b))
          drawStarGlow(x, y, 9 + 6 * b, a * 0.7)
          ctx.globalAlpha = a
          ctx.fillStyle = '#F3F5FF'
          ctx.beginPath()
          ctx.arc(x, y, 1.35 + 0.5 * b, 0, Math.PI * 2)
          ctx.fill()
        })
      })

      if (!reducedMotion) {
        if (shootingRef.current) {
          if (nextShooterAt === 0) scheduleShooter(now, true)
          if (now >= nextShooterAt) {
            if (shooters.length < 2) {
              spawnShooter()
              if (shooters.length < 2 && Math.random() < 0.2) spawnShooter()
            }
            scheduleShooter(now)
          }
        }
        for (let i = shooters.length - 1; i >= 0; i--) {
          const s = shooters[i]
          s.life += dt
          s.x += s.vx * dt
          s.y += s.vy * dt
          const p = s.life / s.duration
          if (p >= 1) {
            shooters.splice(i, 1)
            continue
          }
          const env = Math.sin(Math.PI * Math.min(1, p)) // fade in, fade out
          const speed = Math.hypot(s.vx, s.vy)
          const tx = s.x - (s.vx / speed) * s.length
          const ty = s.y - (s.vy / speed) * s.length
          const g = ctx.createLinearGradient(s.x, s.y, tx, ty)
          g.addColorStop(0, 'rgba(243,245,255,1)')
          g.addColorStop(0.15, 'rgba(189,214,255,0.55)')
          g.addColorStop(1, 'rgba(131,183,255,0)')
          ctx.globalAlpha = env
          ctx.strokeStyle = g
          ctx.lineWidth = 1.6
          ctx.lineCap = 'round'
          ctx.beginPath()
          ctx.moveTo(s.x, s.y)
          ctx.lineTo(tx, ty)
          ctx.stroke()
          drawStarGlow(s.x, s.y, 12, env)
        }
      }

      ctx.globalAlpha = 1
      raf = requestAnimationFrame(frame)
    }

    resize()
    window.addEventListener('resize', resize)
    window.addEventListener('pointermove', onMove, { passive: true })
    document.addEventListener('pointerleave', onLeave)
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', resize)
      window.removeEventListener('pointermove', onMove)
      document.removeEventListener('pointerleave', onLeave)
    }
  }, [pointer, reducedMotion])

  return <canvas ref={canvasRef} aria-hidden className="pointer-events-none fixed inset-0 z-0" />
}
