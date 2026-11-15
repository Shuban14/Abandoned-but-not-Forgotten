'use client'

import type * as ThreeTypes from 'three'
import { Captions, Maximize2, Minimize2, Pause, Play, RotateCcw, Volume2, VolumeX, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Relic } from '@/lib/types'

/**
 * Mission film: a short 3D cinematic generated in the browser from the relic's
 * own dataset values — the target body, the published landing coordinates, the
 * agency, the year and the recorded hardware class.
 *
 * Nothing is fetched, nothing navigates away, and no mission fact is invented:
 * the film visualises the record you are reading, narrates it out loud, and can
 * be expanded to fill the window without losing playback.
 */

const DURATION = 11
const T_INBOUND = 1.4
const T_IMPACT = 4.2
const T_REVEAL = 5.4

const BODY_TEXTURE: Record<Relic['planet'], string> = {
  moon: '/space/textures/moon.jpg',
  mars: '/space/textures/mars.jpg',
}

const BODY_TINT: Record<Relic['planet'], number> = {
  moon: 0xb6c1d4,
  mars: 0xb4674a,
}

const BODY_LABEL: Record<Relic['planet'], string> = {
  moon: "Earth's Moon",
  mars: 'Mars',
}

const PHASE_LABEL = ['Approach', 'Terminal descent', 'Touchdown', 'Site locked'] as const

type VehicleKind = 'rover' | 'crewed' | 'sample' | 'satellite' | 'lander'

const VEHICLE_NAME: Record<VehicleKind, string> = {
  rover: 'rover',
  crewed: 'crewed capsule',
  sample: 'sample-return capsule',
  satellite: 'satellite bus',
  lander: 'lander',
}

/** Pick the hardware model that matches the record's own class. */
function vehicleFor(relic: Relic): VehicleKind {
  const kind = relic.kind.toLowerCase()
  if (relic.category === 'rover' || /rover/.test(kind)) return 'rover'
  if (relic.category === 'sample-return' || /sample/.test(kind)) return 'sample'
  if (relic.category === 'crewed' || /crewed/.test(kind)) return 'crewed'
  if (/orbiter|satellite|flyby|probe|impactor/.test(kind)) return 'satellite'
  return 'lander'
}

function easeInOut(x: number) {
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2
}

/** Lat/lon → a point on a sphere (dataset coordinates, degrees). */
function surfacePoint(lat: number, lon: number, radius: number) {
  const phi = (90 - lat) * (Math.PI / 180)
  const theta = (lon + 180) * (Math.PI / 180)
  return {
    x: -radius * Math.sin(phi) * Math.cos(theta),
    y: radius * Math.cos(phi),
    z: radius * Math.sin(phi) * Math.sin(theta),
  }
}

function fmtCoord(value: number, positive: string, negative: string) {
  return `${Math.abs(value).toFixed(2)}° ${value >= 0 ? positive : negative}`
}

export default function MissionFilm({
  relic,
  autoPlayToken = 0,
}: {
  relic: Relic
  autoPlayToken?: number
}) {
  const [active, setActive] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [progress, setProgress] = useState(0)
  const [phase, setPhase] = useState(0)
  const [failed, setFailed] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [voice, setVoice] = useState(true)
  const [captions, setCaptions] = useState(true)
  const [mounted, setMounted] = useState(false)

  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const playingRef = useRef(false)
  const elapsedRef = useRef(0)

  const vehicle = useMemo(() => vehicleFor(relic), [relic])
  const vehicleName = VEHICLE_NAME[vehicle]
  const latText = fmtCoord(relic.latitude, 'N', 'S')
  const lonText = fmtCoord(relic.longitude, 'E', 'W')

  /** Spoken + written explanation for each beat of the film. */
  const narration = useMemo(
    () => [
      `${relic.name}. ${relic.agency}, ${relic.year}. Approaching ${BODY_LABEL[relic.planet]}.`,
      `A ${vehicleName} descends toward the published landing coordinates: ${latText}, ${lonText}.`,
      `Touchdown. The record lists this as: ${relic.kind}.`,
      `Site locked. Marker placed from the NASA dataset coordinates. That is the ${relic.name} story.`,
    ],
    [relic.name, relic.agency, relic.year, relic.planet, relic.kind, vehicleName, latText, lonText],
  )

  /** Plain-language note describing what is on screen right now. */
  const sceneNote = useMemo(
    () => [
      `A textured globe of ${BODY_LABEL[relic.planet]} with the descent track beginning out in space.`,
      `The ${vehicleName} rides the track down to ${latText}, ${lonText}.`,
      `A ring marks the touchdown point named in the dataset.`,
      `The site marker stays fixed on the surface at the documented coordinates.`,
    ],
    [relic.planet, vehicleName, latText, lonText],
  )

  useEffect(() => {
    playingRef.current = playing
  }, [playing])

  // Portals need a client; keeps the expanded player out of the page's stacking
  // context so the navbar cannot paint over it.
  useEffect(() => setMounted(true), [])

  // A different mission selected: back to the poster.
  useEffect(() => {
    setActive(false)
    setPlaying(false)
    setProgress(0)
    setPhase(0)
    elapsedRef.current = 0
  }, [relic.id])

  useEffect(() => {
    if (autoPlayToken === 0) return
    setActive(true)
    setPlaying(true)
  }, [autoPlayToken])

  // Narration follows the film, and stops the moment it pauses or closes.
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const synth = window.speechSynthesis
    if (!active || !voice || !playing) {
      synth.cancel()
      return
    }
    synth.cancel()
    const utterance = new SpeechSynthesisUtterance(narration[phase])
    utterance.rate = 0.94
    utterance.pitch = 1
    utterance.volume = 1
    synth.speak(utterance)
    return () => synth.cancel()
  }, [phase, playing, voice, active, narration])

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel()
    }
  }, [])

  // Expanded player: Esc closes, page scroll is parked.
  useEffect(() => {
    if (!expanded) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setExpanded(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = previous
      window.removeEventListener('keydown', onKey)
    }
  }, [expanded])

  useEffect(() => {
    if (!active) return
    const canvas = canvasRef.current
    const stage = stageRef.current
    if (!canvas || !stage) return

    let disposed = false
    let raf = 0
    let teardown: (() => void) | null = null

    const boot = async () => {
      const THREE = await import('three')
      if (disposed) return

      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75))
      renderer.outputColorSpace = THREE.SRGBColorSpace

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 120)
      const world = new THREE.Group()
      scene.add(world)

      // ---- body -------------------------------------------------------------
      const loader = new THREE.TextureLoader()
      const map = await new Promise<ThreeTypes.Texture | null>((resolve) => {
        loader.load(BODY_TEXTURE[relic.planet], (texture) => resolve(texture), undefined, () => resolve(null))
      })
      if (disposed) return
      if (map) map.colorSpace = THREE.SRGBColorSpace

      const bodyGeo = new THREE.SphereGeometry(1, 64, 64)
      const bodyMat = new THREE.MeshStandardMaterial({
        map: map ?? undefined,
        color: map ? 0xffffff : BODY_TINT[relic.planet],
        roughness: 0.96,
        metalness: 0,
      })
      world.add(new THREE.Mesh(bodyGeo, bodyMat))

      const key = new THREE.DirectionalLight(0xfff4e8, 2.4)
      key.position.set(2.6, 1.9, 2.4)
      scene.add(key)
      const rim = new THREE.DirectionalLight(0x83b7ff, 1.1)
      rim.position.set(-2.6, -1.1, -1.9)
      scene.add(rim)
      scene.add(new THREE.AmbientLight(0x2a3352, 1.3))

      // ---- stars ------------------------------------------------------------
      const starCount = 900
      const starPositions = new Float32Array(starCount * 3)
      for (let i = 0; i < starCount; i += 1) {
        const r = 16 + (i % 8) * 4
        const u = Math.random() * 2 - 1
        const angle = Math.random() * Math.PI * 2
        const s = Math.sqrt(1 - u * u)
        starPositions[i * 3] = r * s * Math.cos(angle)
        starPositions[i * 3 + 1] = r * u
        starPositions[i * 3 + 2] = r * s * Math.sin(angle)
      }
      const starGeo = new THREE.BufferGeometry()
      starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
      const starMat = new THREE.PointsMaterial({
        color: 0xd6e6ff,
        size: 0.11,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.85,
      })
      scene.add(new THREE.Points(starGeo, starMat))

      // ---- landing site -----------------------------------------------------
      const site = surfacePoint(relic.latitude, relic.longitude, 1.004)
      const markerPos = new THREE.Vector3(site.x, site.y, site.z)
      const baseYaw = -Math.atan2(markerPos.x, markerPos.z)
      world.rotation.y = baseYaw

      const markerGeo = new THREE.SphereGeometry(0.028, 20, 20)
      const markerMat = new THREE.MeshBasicMaterial({ color: 0x9ec8ff })
      const marker = new THREE.Mesh(markerGeo, markerMat)
      marker.position.copy(markerPos)
      world.add(marker)

      const ringGeo = new THREE.RingGeometry(0.046, 0.062, 56)
      const ringMat = new THREE.MeshBasicMaterial({
        color: 0x9ec8ff,
        transparent: true,
        opacity: 0,
        side: THREE.DoubleSide,
        depthWrite: false,
      })
      const ring = new THREE.Mesh(ringGeo, ringMat)
      ring.position.copy(markerPos)
      ring.lookAt(markerPos.clone().multiplyScalar(4))
      world.add(ring)

      // ---- descent track ----------------------------------------------------
      const start = new THREE.Vector3(0.85, 0.95, 3.15)
      const control = markerPos.clone().normalize().multiplyScalar(2.0).add(new THREE.Vector3(0, 0.55, 0))
      const curve = new THREE.QuadraticBezierCurve3(start, control, markerPos.clone().multiplyScalar(1.02))

      const trailGeo = new THREE.BufferGeometry().setFromPoints(curve.getPoints(72))
      const trailMat = new THREE.LineBasicMaterial({ color: 0x9fc4ff, transparent: true, opacity: 0 })
      world.add(new THREE.Line(trailGeo, trailMat))

      // ---- vehicle: the hardware class recorded for this mission ------------
      const vehicleGroup = new THREE.Group()
      const metalMat = new THREE.MeshStandardMaterial({ color: 0xdde5f3, roughness: 0.34, metalness: 0.65 })
      const goldMat = new THREE.MeshStandardMaterial({ color: 0xd8a444, roughness: 0.42, metalness: 0.8 })
      const panelMat = new THREE.MeshStandardMaterial({ color: 0x35558f, roughness: 0.25, metalness: 0.5 })
      const darkMat = new THREE.MeshStandardMaterial({ color: 0x2b3450, roughness: 0.7, metalness: 0.2 })
      const parts: ThreeTypes.BufferGeometry[] = []

      const add = (geometry: ThreeTypes.BufferGeometry, material: ThreeTypes.Material, x = 0, y = 0, z = 0) => {
        parts.push(geometry)
        const mesh = new THREE.Mesh(geometry, material)
        mesh.position.set(x, y, z)
        vehicleGroup.add(mesh)
        return mesh
      }

      if (vehicle === 'rover') {
        add(new THREE.BoxGeometry(0.1, 0.038, 0.062), goldMat)
        add(new THREE.BoxGeometry(0.07, 0.006, 0.05), panelMat, 0, 0.03, 0)
        add(new THREE.CylinderGeometry(0.005, 0.005, 0.06, 8), metalMat, 0, 0.05, -0.012)
        add(new THREE.BoxGeometry(0.016, 0.012, 0.012), darkMat, 0, 0.082, -0.012)
        for (const x of [-0.034, 0, 0.034]) {
          for (const z of [-0.036, 0.036]) {
            const wheel = add(new THREE.CylinderGeometry(0.018, 0.018, 0.012, 16), darkMat, x, -0.03, z)
            wheel.rotation.z = Math.PI / 2
          }
        }
      } else if (vehicle === 'crewed') {
        add(new THREE.ConeGeometry(0.052, 0.075, 24), metalMat, 0, 0.02, 0)
        add(new THREE.CylinderGeometry(0.05, 0.052, 0.03, 24), goldMat, 0, -0.035, 0)
        add(new THREE.CylinderGeometry(0.012, 0.012, 0.02, 12), metalMat, 0, 0.065, 0)
      } else if (vehicle === 'sample') {
        add(new THREE.ConeGeometry(0.045, 0.045, 20), metalMat, 0, 0.01, 0)
        add(new THREE.SphereGeometry(0.032, 20, 14), goldMat, 0, -0.026, 0)
        add(new THREE.CylinderGeometry(0.004, 0.004, 0.03, 8), metalMat, 0, 0.045, 0)
      } else if (vehicle === 'satellite') {
        add(new THREE.BoxGeometry(0.05, 0.05, 0.05), metalMat)
        add(new THREE.BoxGeometry(0.085, 0.004, 0.05), panelMat, -0.075, 0, 0)
        add(new THREE.BoxGeometry(0.085, 0.004, 0.05), panelMat, 0.075, 0, 0)
        add(new THREE.CylinderGeometry(0.015, 0.02, 0.012, 16), goldMat, 0, 0.036, 0)
      } else {
        add(new THREE.CylinderGeometry(0.045, 0.045, 0.05, 20), metalMat)
        add(new THREE.CylinderGeometry(0.03, 0.045, 0.018, 20), goldMat, 0, -0.034, 0)
        add(new THREE.CylinderGeometry(0.003, 0.003, 0.05, 8), metalMat, 0, 0.045, 0)
        for (let i = 0; i < 4; i += 1) {
          const angle = (i / 4) * Math.PI * 2 + Math.PI / 4
          const legGeo = new THREE.CylinderGeometry(0.004, 0.004, 0.06, 6)
          parts.push(legGeo)
          const leg = new THREE.Mesh(legGeo, metalMat)
          leg.position.set(Math.cos(angle) * 0.032, -0.03, Math.sin(angle) * 0.032)
          leg.rotation.z = Math.cos(angle) * 0.5
          leg.rotation.x = Math.sin(angle) * 0.5
          vehicleGroup.add(leg)
        }
      }

      const vehiclePivot = new THREE.Group()
      vehiclePivot.add(vehicleGroup)
      vehiclePivot.visible = false
      world.add(vehiclePivot)

      // ---- framing ----------------------------------------------------------
      const orbit = { theta: 0, phi: 0.14, radius: 4.6 }
      const place = () => {
        const cosPhi = Math.cos(orbit.phi)
        camera.position.set(
          Math.sin(orbit.theta) * cosPhi * orbit.radius,
          Math.sin(orbit.phi) * orbit.radius,
          Math.cos(orbit.theta) * cosPhi * orbit.radius,
        )
        camera.lookAt(0, 0, 0)
      }

      const resize = () => {
        const w = stage.clientWidth
        const h = stage.clientHeight
        if (!w || !h) return
        renderer.setSize(w, h, false)
        camera.aspect = w / h
        camera.updateProjectionMatrix()
      }
      const observer = new ResizeObserver(resize)
      observer.observe(stage)
      resize()

      // ---- interaction: drag to look around ---------------------------------
      let dragging = false
      let lastX = 0
      let lastY = 0
      const onDown = (event: PointerEvent) => {
        dragging = true
        lastX = event.clientX
        lastY = event.clientY
        canvas.setPointerCapture?.(event.pointerId)
      }
      const onMove = (event: PointerEvent) => {
        if (!dragging) return
        orbit.theta -= (event.clientX - lastX) * 0.006
        orbit.phi = Math.max(-0.85, Math.min(1.05, orbit.phi + (event.clientY - lastY) * 0.004))
        lastX = event.clientX
        lastY = event.clientY
      }
      const onUp = (event: PointerEvent) => {
        dragging = false
        canvas.releasePointerCapture?.(event.pointerId)
      }
      canvas.addEventListener('pointerdown', onDown)
      canvas.addEventListener('pointermove', onMove)
      canvas.addEventListener('pointerup', onUp)
      canvas.addEventListener('pointercancel', onUp)

      // ---- loop -------------------------------------------------------------
      let last = performance.now()
      let lastPct = -1
      let lastPhase = -1

      const loop = () => {
        if (disposed) return
        const now = performance.now()
        const dt = Math.min(0.05, (now - last) / 1000)
        last = now

        if (playingRef.current) {
          elapsedRef.current = Math.min(DURATION, elapsedRef.current + dt)
          if (elapsedRef.current >= DURATION) {
            playingRef.current = false
            setPlaying(false)
          }
        }
        const t = elapsedRef.current

        const targetRadius = t < T_INBOUND ? 4.6 - 1.05 * (t / T_INBOUND) : t < T_IMPACT ? 3.55 : 2.95
        orbit.radius += (targetRadius - orbit.radius) * Math.min(1, dt * 2.4)
        place()

        world.rotation.y = baseYaw + Math.sin(t * 0.16) * 0.12

        const inbound = Math.max(0, Math.min(1, (t - T_INBOUND) / (T_IMPACT - T_INBOUND)))
        trailMat.opacity = inbound > 0 ? 0.45 * (1 - inbound * 0.3) : 0
        vehiclePivot.visible = inbound > 0 && inbound < 1
        if (vehiclePivot.visible) {
          const e = easeInOut(inbound)
          const point = curve.getPoint(e)
          const tangent = curve.getTangent(e).normalize()
          vehiclePivot.position.copy(point)
          vehiclePivot.lookAt(point.clone().add(tangent))
          vehicleGroup.rotation.y = t * 0.6
        }

        const sinceImpact = t - T_IMPACT
        if (sinceImpact > 0) {
          const cycle = (sinceImpact % 1.9) / 1.9
          ring.scale.setScalar(1 + cycle * 5.5)
          ringMat.opacity = 0.8 * (1 - cycle)
        } else {
          ringMat.opacity = 0
        }
        marker.scale.setScalar(1 + Math.sin(t * 6) * 0.12)

        const pct = Math.round((t / DURATION) * 100)
        if (pct !== lastPct) {
          lastPct = pct
          setProgress(pct)
        }
        const nextPhase = t < T_INBOUND ? 0 : t < T_IMPACT ? 1 : t < T_REVEAL ? 2 : 3
        if (nextPhase !== lastPhase) {
          lastPhase = nextPhase
          setPhase(nextPhase)
        }

        renderer.render(scene, camera)
        raf = requestAnimationFrame(loop)
      }
      raf = requestAnimationFrame(loop)

      teardown = () => {
        observer.disconnect()
        canvas.removeEventListener('pointerdown', onDown)
        canvas.removeEventListener('pointermove', onMove)
        canvas.removeEventListener('pointerup', onUp)
        canvas.removeEventListener('pointercancel', onUp)
        starGeo.dispose()
        starMat.dispose()
        bodyGeo.dispose()
        bodyMat.dispose()
        map?.dispose()
        markerGeo.dispose()
        markerMat.dispose()
        ringGeo.dispose()
        ringMat.dispose()
        trailGeo.dispose()
        trailMat.dispose()
        for (const geometry of parts) geometry.dispose()
        metalMat.dispose()
        goldMat.dispose()
        panelMat.dispose()
        darkMat.dispose()
        renderer.dispose()
      }
    }

    boot().catch(() => {
      if (!disposed) setFailed(true)
    })

    return () => {
      disposed = true
      cancelAnimationFrame(raf)
      teardown?.()
    }
  }, [active, relic.id, relic.planet, relic.latitude, relic.longitude, vehicle, expanded])

  const toggle = useCallback(() => {
    if (!active) {
      setActive(true)
      setPlaying(true)
      return
    }
    setPlaying((value) => !value)
  }, [active])

  const replay = useCallback(() => {
    elapsedRef.current = 0
    setProgress(0)
    setActive(true)
    setPlaying(true)
  }, [])

  const card = (
    <div
      className={
        expanded
          ? 'fixed inset-0 z-[100] flex flex-col gap-2 bg-[#04050c]/96 p-3 backdrop-blur-md sm:p-6'
          : 'mt-5 overflow-hidden rounded-2xl border border-orbit/25 bg-void/60'
      }
    >
      <div className="flex items-center justify-between gap-2 px-1 sm:px-0">
        <div className="flex items-center gap-2">
          <p className="font-display text-[9px] uppercase tracking-[0.24em] text-electric">Mission film</p>
          {expanded && (
            <span className="font-display text-[9px] uppercase tracking-[0.18em] text-moon/60">{relic.name}</span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <p className="mr-1 font-mono text-[9px] uppercase tracking-[0.16em] text-moon/45">
            {BODY_LABEL[relic.planet]} · {vehicleName}
          </p>
          <button
            type="button"
            onClick={() => setCaptions((value) => !value)}
            aria-pressed={captions}
            aria-label={captions ? 'Hide subtitles' : 'Show subtitles'}
            className={`flex size-6 items-center justify-center rounded-full border transition-colors ${
              captions ? 'border-electric/60 text-starlight' : 'border-orbit/30 text-moon/60 hover:text-starlight'
            }`}
          >
            <Captions className="size-3" aria-hidden />
          </button>
          <button
            type="button"
            onClick={() => setVoice((value) => !value)}
            aria-pressed={voice}
            aria-label={voice ? 'Mute narration' : 'Unmute narration'}
            className={`flex size-6 items-center justify-center rounded-full border transition-colors ${
              voice ? 'border-electric/60 text-starlight' : 'border-orbit/30 text-moon/60 hover:text-starlight'
            }`}
          >
            {voice ? <Volume2 className="size-3" aria-hidden /> : <VolumeX className="size-3" aria-hidden />}
          </button>
          <button
            type="button"
            onClick={() => setExpanded((value) => !value)}
            aria-label={expanded ? 'Collapse film' : 'Expand film'}
            className="flex size-6 items-center justify-center rounded-full border border-orbit/30 text-moon transition-colors hover:border-electric/60 hover:text-starlight"
          >
            {expanded ? <Minimize2 className="size-3" aria-hidden /> : <Maximize2 className="size-3" aria-hidden />}
          </button>
          {expanded && (
            <button
              type="button"
              onClick={() => setExpanded(false)}
              aria-label="Close film"
              className="flex size-6 items-center justify-center rounded-full border border-orbit/30 text-moon transition-colors hover:border-electric/60 hover:text-starlight"
            >
              <X className="size-3" aria-hidden />
            </button>
          )}
        </div>
      </div>

      <div
        ref={stageRef}
        className={`relative w-full overflow-hidden bg-[#05060f] ${
          expanded ? 'min-h-0 flex-1 rounded-xl' : 'mt-2 aspect-[16/9]'
        }`}
      >
        {active ? (
          <canvas ref={canvasRef} className="size-full cursor-grab touch-none active:cursor-grabbing" />
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-[radial-gradient(120%_120%_at_50%_120%,#1a2340_0%,#05060f_65%)]">
            <p className="px-6 text-center font-display text-[11px] uppercase tracking-[0.2em] text-starlight/90">
              {relic.name}
            </p>
            <button
              type="button"
              onClick={toggle}
              className="group flex items-center gap-2 rounded-full border border-electric/40 bg-electric/10 px-4 py-2 font-display text-[10px] uppercase tracking-[0.2em] text-starlight transition-all hover:border-electric/80 hover:bg-electric/20 hover:shadow-[0_0_28px_rgba(131,183,255,0.3)]"
            >
              <Play className="size-3.5" aria-hidden />
              Play film
            </button>
            <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-moon/40">
              ≈ {DURATION} s · narrated · plays here
            </p>
          </div>
        )}

        {active && !failed && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 bg-gradient-to-b from-void/85 to-transparent p-2.5">
            <span className="font-display text-[9px] uppercase tracking-[0.2em] text-starlight/90">
              {PHASE_LABEL[phase]}
            </span>
            <span className="max-w-[62%] text-right font-mono text-[9px] leading-relaxed text-moon/75">
              {relic.agency} · {relic.year} · {relic.kind}
            </span>
          </div>
        )}

        {active && failed && (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center">
            <p className="text-xs leading-relaxed text-moon/80">
              3D playback is unavailable on this device, so the mission record above stands as the source.
            </p>
          </div>
        )}

        {active && !failed && captions && (
          <p className="pointer-events-none absolute inset-x-0 bottom-12 mx-auto max-w-[92%] rounded-lg bg-void/70 px-3 py-1.5 text-center text-[11px] leading-snug text-starlight/90">
            {narration[phase]}
          </p>
        )}

        {active && !failed && (
          <div className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-gradient-to-t from-void/90 to-transparent p-2.5">
            <button
              type="button"
              onClick={toggle}
              aria-label={playing ? 'Pause film' : 'Play film'}
              className="flex size-7 items-center justify-center rounded-full border border-orbit/40 bg-void/60 text-starlight transition-colors hover:border-electric/70"
            >
              {playing ? <Pause className="size-3" aria-hidden /> : <Play className="size-3" aria-hidden />}
            </button>
            <button
              type="button"
              onClick={replay}
              aria-label="Replay film"
              className="flex size-7 items-center justify-center rounded-full border border-orbit/40 bg-void/60 text-moon transition-colors hover:border-electric/70 hover:text-starlight"
            >
              <RotateCcw className="size-3" aria-hidden />
            </button>
            <div className="h-[3px] flex-1 overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full rounded-full bg-electric transition-[width] duration-150 ease-linear"
                style={{ width: `${progress}%` }}
              />
            </div>
            <span className="font-mono text-[9px] text-moon/55">{progress}%</span>
          </div>
        )}
      </div>

      <div className="px-1 sm:px-0">
        <p className="py-2 text-[10px] leading-relaxed text-moon/55">
          <span className="text-moon/80">On screen:</span> {sceneNote[phase]}
        </p>
        {!expanded && (
          <p className="pb-2 text-[10px] leading-relaxed text-moon/40">
            Rendered live from this record&apos;s own NASA dataset values. Drag the scene to look around.
          </p>
        )}
      </div>
    </div>
  )

  return expanded && mounted ? createPortal(card, document.body) : card
}
