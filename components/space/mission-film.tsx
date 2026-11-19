'use client'

import type * as ThreeTypes from 'three'
import {
  Captions,
  ChevronLeft,
  ChevronRight,
  Gauge,
  Maximize2,
  Minimize2,
  Pause,
  Play,
  RotateCcw,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Relic } from '@/lib/types'
import { clampSeek, createFrameLoop, holdForNarration } from '@/lib/film-core.mjs'
import { createNarration } from '@/lib/narration.mjs'

/**
 * Mission film — a ten-chapter 3D story generated in the browser.
 *
 * The film follows the hardware from "what is this machine?" to "what did it do
 * after it landed", using only facts the record itself carries (name, agency,
 * year, hardware class, target body, published landing coordinates) plus the
 * definition of what that class of spacecraft does. Nothing is fetched and
 * nothing is invented.
 *
 * Chapters can be jumped to at any time, the scene can be dragged to look
 * around, playback speed changes, and narration holds each shot until the line
 * has been spoken.
 */

// The film draws on a canvas a few hundred pixels wide, so it uses its own
// downscaled copies of the planet maps (1024 px, ~150 KB each) instead of the
// 4K originals the explorers need: same look, a fraction of the decode and GPU
// upload cost.
const BODY_TEXTURE: Record<Relic['planet'], string> = {
  moon: '/space/textures/film/moon.jpg',
  mars: '/space/textures/film/mars.jpg',
}

const EARTH_TEXTURE = '/space/textures/film/earth.jpg'

const BODY_TINT: Record<Relic['planet'], number> = {
  moon: 0xb6c1d4,
  mars: 0xb4674a,
}

const BODY_LABEL: Record<Relic['planet'], string> = {
  moon: "Earth's Moon",
  mars: 'Mars',
}

type VehicleKind = 'rover' | 'crewed' | 'sample' | 'satellite' | 'lander'

const VEHICLE_NAME: Record<VehicleKind, string> = {
  rover: 'rover',
  crewed: 'crewed capsule',
  sample: 'sample-return capsule',
  satellite: 'orbiter',
  lander: 'lander',
}

type Shot = 'vehicle' | 'closeup' | 'pad' | 'ascent' | 'staging' | 'cruise' | 'descent' | 'touchdown' | 'surface' | 'legacy'

const BEATS: { id: string; label: string; seconds: number; shot: Shot }[] = [
  { id: 'meet', label: 'Meet the machine', seconds: 9, shot: 'vehicle' },
  { id: 'inside', label: 'How it works', seconds: 10, shot: 'closeup' },
  { id: 'pad', label: 'On the pad', seconds: 7, shot: 'pad' },
  { id: 'liftoff', label: 'Liftoff', seconds: 7, shot: 'ascent' },
  { id: 'staging', label: 'Staging', seconds: 8, shot: 'staging' },
  { id: 'cruise', label: 'The voyage', seconds: 8, shot: 'cruise' },
  { id: 'descent', label: 'Descent', seconds: 8, shot: 'descent' },
  { id: 'touchdown', label: 'Touchdown', seconds: 6, shot: 'touchdown' },
  { id: 'after', label: 'After landing', seconds: 10, shot: 'surface' },
  { id: 'legacy', label: 'What remains', seconds: 6, shot: 'legacy' },
]

const STARTS: number[] = []
BEATS.reduce((acc, beat) => {
  STARTS.push(acc)
  return acc + beat.seconds
}, 0)
const DURATION = BEATS.reduce((sum, beat) => sum + beat.seconds, 0)

function beatIndexAt(t: number) {
  for (let i = BEATS.length - 1; i >= 0; i -= 1) if (t >= STARTS[i]) return i
  return 0
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

function smoothstep(from: number, to: number, x: number) {
  const t = Math.max(0, Math.min(1, (x - from) / (to - from)))
  return t * t * (3 - 2 * t)
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

type BeatScript = { title: string; narration: string; note: string }

type CraftCopy = {
  noun: string
  meet: string
  parts: string
  after: string
  legacy: string
  surfaceNote: string
}

/**
 * What each class of hardware is and what it did after landing.
 *
 * Every line is either read from the record ({name}, {agency}, {year}, {kind},
 * {body}, {where}) or is the defining job of that spacecraft class — a rover
 * drives, a lander stays put, a sample-return mission brings material home.
 */
const CRAFT: Record<VehicleKind, CraftCopy> = {
  rover: {
    noun: 'rover',
    meet: 'Meet {name}. {agency} sent this rover to {body} in {year}. A rover is a robot on wheels: it lands once, then drives from place to place instead of studying a single spot.',
    parts:
      'Here is how it works. The body carries the cameras, drills and science instruments. A power source — solar panels or a small nuclear unit — keeps them running. Each wheel has its own motor, so it can climb over rocks and crawl out of soft dust. The dish on top is how it talks to Earth.',
    after:
      'And this is the part that matters. After landing, the rover does not stay put. It rolls off its platform and drives, stopping at rocks to photograph them, drill into them and measure the ground. Every day it sends those findings home through its dish, and people on Earth decide where it should drive next.',
    legacy:
      'The rover is still up there at {where}: a machine parked in the dust of {body}, after showing us what that world is really made of.',
    surfaceNote: 'The rover rolls away from the landing site, leaving wheel tracks across the surface.',
  },
  crewed: {
    noun: 'crewed spacecraft',
    meet: 'Meet {name}. {agency}, {year}. This is a crewed mission — it carried people. That changes everything: the spacecraft needs a capsule to keep them alive, and a way to bring them home again.',
    parts:
      'Here is how it works. The capsule holds the crew and their life support. A heat shield protects them on the way down through air. Behind it, a service section carries the engines, fuel and power, and landing legs set the whole thing down gently.',
    after:
      'After landing, the crew gets to work. They step onto the surface, set up experiments, collect rock and soil, take photographs, and leave instruments behind that keep measuring long after the crew has gone home.',
    legacy:
      'The descent stage stayed behind at {where}. The record lists it as {kind}, and it is still there, exactly where the crew left it.',
    surfaceNote: 'Footprints spread out from the lander as the crew works across the site.',
  },
  sample: {
    noun: 'sample-return spacecraft',
    meet: 'Meet {name}. {agency}, {year}. A sample-return mission has a round trip in mind: land on {body}, pick up pieces of it, and bring them back to Earth.',
    parts:
      'Here is how it works. One part lands and collects. Another part is a small rocket that lifts the sealed sample off the surface. A capsule carries it home through Earth’s atmosphere, protected by a heat shield.',
    after:
      'After landing, the collector scoops and drills material from the surface and seals it in a container. Then the ascent stage launches that container back into space, and scientists study the pieces in laboratories on Earth.',
    legacy:
      'What stays behind at {where} is the part that did the landing. The sample itself made the journey home.',
    surfaceNote: 'A small ascent stage lifts the sealed sample away from the landing site.',
  },
  lander: {
    noun: 'lander',
    meet: 'Meet {name}. {agency}, {year}. This is a lander: a spacecraft built to touch down, and then do its work from one place.',
    parts:
      'Here is how it works. A descent engine slows the fall and the legs absorb the touchdown. Once it is down, solar panels unfold for power and a dish points at Earth. Its instruments are fixed in place, so the landing site itself becomes the laboratory.',
    after:
      'After landing, it stays exactly where it touched down. It unfolds its instruments, measures the ground, the sky and the weather, and sends the results back to Earth for as long as it can.',
    legacy: 'It is still at {where}, on the surface of {body}: the record lists it as {kind}.',
    surfaceNote: 'The lander stays put while its dish keeps sending data home.',
  },
  satellite: {
    noun: 'spacecraft',
    meet: 'Meet {name}. {agency}, {year}. This spacecraft was built to reach {body} and work from close orbit rather than from the ground.',
    parts:
      'Here is how it works. A body holds the instruments, solar panels make the power, and a dish sends data back. Small engines make the corrections that keep it on course.',
    after:
      'After arriving, it settles into its planned orbit and begins mapping, photographing and measuring, pass after pass, sending the data home.',
    legacy: 'Its mission ended above {body}; the record ties it to {kind}.',
    surfaceNote: 'The spacecraft works from orbit, circling the world below.',
  },
}

type Part = { label: string; detail: string }

/** What a child can point at on the model, in the order the tour introduces it. */
const PARTS: Record<VehicleKind, Part[]> = {
  rover: [
    { label: 'Cameras', detail: 'Cameras ride high on the mast. They are the rover’s eyes for choosing the next rock.' },
    { label: 'Power', detail: 'Solar panels, or a small nuclear unit, keep the instruments running through the cold nights.' },
    { label: 'Wheels', detail: 'The wheels are independently driven and steered, letting the rover climb rocks and crawl out of soft dust.' },
  ],
  crewed: [
    { label: 'Capsule', detail: 'The capsule holds the crew and everything that keeps them alive.' },
    { label: 'Heat shield', detail: 'The blunt shield on the way down takes the heat of entering an atmosphere.' },
    { label: 'Service section', detail: 'Behind the capsule: engines, fuel and power, plus legs to set the whole thing down gently.' },
  ],
  sample: [
    { label: 'Collector', detail: 'The arm scoops and drills material loose from the surface.' },
    { label: 'Sealed container', detail: 'The sample is sealed so nothing from Earth can contaminate it on the way home.' },
    { label: 'Ascent stage', detail: 'A small rocket lifts the sealed container back off the surface.' },
  ],
  lander: [
    { label: 'Dish', detail: 'The dish points at Earth and carries every measurement home.' },
    { label: 'Instruments', detail: 'Fixed in place, so the landing site itself becomes the laboratory.' },
    { label: 'Legs', detail: 'The legs absorb the touchdown so the instruments survive the landing.' },
  ],
  satellite: [
    { label: 'Dish', detail: 'The dish sends the day’s pictures and measurements back to Earth.' },
    { label: 'Solar panels', detail: 'Panels make the power the instruments need, pass after pass.' },
    { label: 'Instruments', detail: 'Cameras and sensors that map and measure the world below.' },
  ],
}

/**
 * Voice selection and the whole speak/cancel lifecycle live in
 * `lib/narration.mjs`, so the Node test suite exercises the same code the
 * player runs. A local British voice wins; a remote Edge "natural" voice is
 * never preferred, because those stall silently when their service is
 * unreachable.
 */

function fill(template: string, values: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '')
}

function scriptFor(relic: Relic, vehicle: VehicleKind): BeatScript[] {
  const craft = CRAFT[vehicle]
  const values = {
    name: relic.name,
    agency: relic.agency,
    year: String(relic.year),
    body: BODY_LABEL[relic.planet],
    kind: relic.kind,
    where: `${fmtCoord(relic.latitude, 'N', 'S')}, ${fmtCoord(relic.longitude, 'E', 'W')}`,
    noun: craft.noun,
  }
  const say = (text: string) => fill(text, values)

  return [
    { title: BEATS[0].label, narration: say(craft.meet), note: `A slow turn around the ${craft.noun}, lit against the stars.` },
    {
      title: BEATS[1].label,
      narration: say(craft.parts),
      note: 'A close pass over the body, the power source and the dish on top.',
    },
    {
      title: BEATS[2].label,
      narration: say(
        'A {noun} cannot get to {body} on its own. It rides a rocket: the nose cone on top, the lander that will set it down, and underneath, the tanks and engines that lift the whole stack off Earth. The tall tower beside it holds the stack steady and feeds it power until the very last second.',
      ),
      note: `${relic.name} stacked on its launch vehicle, with Earth filling the frame.`,
    },
    {
      title: BEATS[3].label,
      narration: say(
        'Engines light. Thrust beats the rocket’s own weight, so it climbs. The tower and the pad fall away below, and the air thins as the ground shrinks. As the fuel burns the stack gets lighter, so it moves faster and faster.',
      ),
      note: 'The stack climbs on a column of flame; the launch tower falls behind.',
    },
    {
      title: BEATS[4].label,
      narration: say(
        'An empty tank is dead weight. The spent booster drops away and the next engine takes over. Each stage is a rocket on top of a rocket: when its tank runs dry it is thrown away, so the rest does not have to carry it. Then the nose cone splits open, and the {noun} is out in space.',
      ),
      note: 'The spent booster tumbles away as the nose cone opens.',
    },
    {
      title: BEATS[5].label,
      narration: say(
        'Now it coasts. In space there is nothing to push against — the engines finished their work long ago. It is still falling toward {body} the whole way; it simply falls fast enough to keep missing. {body} grows from a tiny dot into a whole world ahead.',
      ),
      note: `Earth behind, ${BODY_LABEL[relic.planet]} ahead, the spacecraft coasting between them.`,
    },
    {
      title: BEATS[6].label,
      narration: say(
        'Arrival is the hard part. The lander has to shed almost all of its speed, then steer down to the published coordinates: {where}. Retro-rockets fire against the direction of travel, and the lander turns upright for the last stretch of the fall.',
      ),
      note: 'Over the landing site, easing down toward the documented coordinates.',
    },
    {
      title: BEATS[7].label,
      narration: say(
        'Contact. The legs take the last of the fall, dust kicks out, and the engines cut. The record lists this as {kind}.',
      ),
      note: 'Contact at the documented coordinates; a dust ring spreads across the surface.',
    },
    { title: BEATS[8].label, narration: say(craft.after), note: craft.surfaceNote },
    {
      title: BEATS[9].label,
      narration: say(craft.legacy),
      note: 'The site marker stays fixed on the surface at the published coordinates.',
    },
  ]
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
  const [beat, setBeat] = useState(0)
  const [failed, setFailed] = useState(false)

  // A failed film for one relic must never bleed into the next one. Reset the
  // failure (and loading) state whenever the selected relic changes.
  useEffect(() => {
    setFailed(false)
  }, [relic.id])
  const [expanded, setExpanded] = useState(false)
  const [voice, setVoice] = useState(true)
  const [captions, setCaptions] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [mounted, setMounted] = useState(false)
  const [partIndex, setPartIndex] = useState(-1)
  const [narrationStatus, setNarrationStatus] = useState<'idle' | 'queued' | 'speaking' | 'failed'>('idle')

  const stageRef = useRef<HTMLDivElement | null>(null)
  const canvasHostRef = useRef<HTMLDivElement | null>(null)
  const canvasElRef = useRef<HTMLCanvasElement | null>(null)
  const resizeFnRef = useRef<(() => void) | null>(null)
  const observerRef = useRef<ResizeObserver | null>(null)
  const observedStageRef = useRef<Element | null>(null)
  const playingRef = useRef(false)
  const elapsedRef = useRef(0)
  const speedRef = useRef(1)
  const voiceRef = useRef(true)
  const speechBusyRef = useRef(false)
  const speechStartedRef = useRef(0)
  const beatRef = useRef(0)
  const renderScheduleRef = useRef<(() => void) | null>(null)
  const narrationRef = useRef<ReturnType<typeof createNarration> | null>(null)

  const vehicle = useMemo(() => vehicleFor(relic), [relic])
  const vehicleName = VEHICLE_NAME[vehicle]
  const script = useMemo(() => scriptFor(relic, vehicle), [relic, vehicle])
  const parts = PARTS[vehicle]
  const current = script[beat] ?? script[0]

  useEffect(() => {
    playingRef.current = playing
    if (playing) renderScheduleRef.current?.()
  }, [playing])

  useEffect(() => {
    speedRef.current = speed
  }, [speed])

  useEffect(() => {
    voiceRef.current = voice
  }, [voice])

  // Portals need a client; keeps the expanded player above the navigation.
  useEffect(() => setMounted(true), [])

  // A chapter change clears the last part callout and keeps the tap handler's
  // view of the current chapter fresh (it lives inside the render loop).
  useEffect(() => {
    beatRef.current = beat
    setPartIndex(-1)
  }, [beat])

  // One narration controller for the lifetime of the player. Owning the
  // queue, the timers and the utterance reference in one place is what makes
  // "one line at a time" enforceable; the previous per-effect cancel() could
  // kill a line that had just been queued (measured in Edge: four cancels and
  // an interrupted unlock within 1.7 s of pressing Play).
  useEffect(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    if (typeof SpeechSynthesisUtterance === 'undefined') return

    const controller = createNarration({
      synth: window.speechSynthesis,
      makeUtterance: (text) => new SpeechSynthesisUtterance(text),
      schedule: (callback, ms) => window.setTimeout(callback, ms),
      cancelTimer: (handle) => window.clearTimeout(handle),
      onStatus: (next) => {
        setNarrationStatus(next as 'idle' | 'queued' | 'speaking' | 'failed')
        speechBusyRef.current = next === 'queued' || next === 'speaking'
        if (next === 'speaking') speechStartedRef.current = Date.now()
      },
    })
    narrationRef.current = controller
    return () => {
      narrationRef.current = null
      controller.dispose()
      speechBusyRef.current = false
    }
  }, [])

  // A different mission selected: back to the poster.
  useEffect(() => {
    setActive(false)
    setPlaying(false)
    setProgress(0)
    setBeat(0)
    elapsedRef.current = 0
  }, [relic.id])

  useEffect(() => {
    if (autoPlayToken === 0) return
    setActive(true)
    setPlaying(true)
  }, [autoPlayToken])

  // Narration follows the current chapter and stops whenever the film is not
  // audibly playing. The controller never cancels a line it has just queued,
  // and reports a line that never starts, so a silent engine can no longer
  // look like a narrated film.
  useEffect(() => {
    const controller = narrationRef.current
    if (!controller) return
    const line = script[beat]?.narration
    if (!active || !voice || !playing || !line) {
      controller.stop()
      return
    }
    controller.speak(line)
  }, [active, voice, playing, beat, script])

  // A background tab can leave the engine idle. Returning to a visible tab
  // re-queues the current line once, and only when the film is playing and
  // nothing is already in flight — no polling, no retry loop.
  useEffect(() => {
    if (!active || !voice) return
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      if (!playingRef.current) return
      const controller = narrationRef.current
      if (controller && !controller.isBusy()) controller.retry()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [active, voice])

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
    const stage = stageRef.current
    if (!stage) return

    let disposed = false
    let teardown: (() => void) | null = null

    const boot = async () => {
      const THREE = await import('three')
      if (disposed) return

      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      })
      // The canvas belongs to the renderer, not to React. Expanding or
      // collapsing the player re-parents this exact element into the new stage
      // node (see the effect below), so the WebGL context, the scene and every
      // texture survive: the only thing that changes is the pixel size.
      const canvas = renderer.domElement
      canvas.className = 'size-full cursor-grab touch-none active:cursor-grabbing'
      canvasElRef.current = canvas
      // replaceChildren, not appendChild: a previous relic's canvas must not be
      // left behind in the host when the film is rebuilt for a new record.
      canvasHostRef.current?.replaceChildren(canvas)
      // 1.5 keeps the film smooth on high-density screens without quadrupling
      // the fragment work of a 3x display.
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5))
      renderer.outputColorSpace = THREE.SRGBColorSpace

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(42, 1, 0.05, 220)
      camera.position.set(0, 1.4, 4)

      const disposeList: { dispose: () => void }[] = []
      function trackDispose<T extends { dispose: () => void }>(item: T): T {
        disposeList.push(item)
        return item
      }

      const loadTexture = (url: string) =>
        new Promise<ThreeTypes.Texture | null>((resolve) => {
          new THREE.TextureLoader().load(
            url,
            (texture) => {
              texture.colorSpace = THREE.SRGBColorSpace
              resolve(trackDispose(texture))
            },
            undefined,
            () => resolve(null),
          )
        })

      const [earthMap, bodyMap] = await Promise.all([
        loadTexture(EARTH_TEXTURE),
        loadTexture(BODY_TEXTURE[relic.planet]),
      ])
      if (disposed) return

      // ---- shared materials -------------------------------------------------
      const metalMat = trackDispose(
        new THREE.MeshStandardMaterial({ color: 0xdde5f3, roughness: 0.34, metalness: 0.65 }),
      )
      const goldMat = trackDispose(
        new THREE.MeshStandardMaterial({ color: 0xd8a444, roughness: 0.42, metalness: 0.8 }),
      )
      const panelMat = trackDispose(
        new THREE.MeshStandardMaterial({ color: 0x35558f, roughness: 0.25, metalness: 0.5 }),
      )
      const darkMat = trackDispose(
        new THREE.MeshStandardMaterial({ color: 0x2b3450, roughness: 0.7, metalness: 0.2 }),
      )
      const hullMat = trackDispose(
        new THREE.MeshStandardMaterial({ color: 0xc9d3e4, roughness: 0.5, metalness: 0.4 }),
      )
      const glowMat = trackDispose(
        new THREE.MeshBasicMaterial({ color: 0x9ec8ff, transparent: true, opacity: 0.9 }),
      )
      const flameMat = trackDispose(
        new THREE.MeshBasicMaterial({
          color: 0xffb066,
          transparent: true,
          opacity: 0.85,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
        }),
      )
      const dustMat = trackDispose(
        new THREE.MeshBasicMaterial({ color: 0xd9c9b5, transparent: true, opacity: 0, depthWrite: false }),
      )

      // ---- vehicle model ----------------------------------------------------
      const makeVehicle = () => {
        const group = new THREE.Group()
        const add = (
          geometry: ThreeTypes.BufferGeometry,
          material: ThreeTypes.Material,
          x = 0,
          y = 0,
          z = 0,
        ) => {
          trackDispose(geometry)
          const mesh = new THREE.Mesh(geometry, material)
          mesh.position.set(x, y, z)
          group.add(mesh)
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
            const leg = add(new THREE.CylinderGeometry(0.004, 0.004, 0.06, 6), metalMat)
            leg.position.set(Math.cos(angle) * 0.032, -0.03, Math.sin(angle) * 0.032)
            leg.rotation.z = Math.cos(angle) * 0.5
            leg.rotation.x = Math.sin(angle) * 0.5
          }
        }
        return group
      }

      // ---- stars (shared by every set) --------------------------------------
      const starCount = 1100
      const starPositions = new Float32Array(starCount * 3)
      for (let i = 0; i < starCount; i += 1) {
        const r = 18 + (i % 9) * 6
        const u = Math.random() * 2 - 1
        const angle = Math.random() * Math.PI * 2
        const s = Math.sqrt(1 - u * u)
        starPositions[i * 3] = r * s * Math.cos(angle)
        starPositions[i * 3 + 1] = r * u
        starPositions[i * 3 + 2] = r * s * Math.sin(angle)
      }
      const starGeo = trackDispose(new THREE.BufferGeometry())
      starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3))
      const starMat = trackDispose(
        new THREE.PointsMaterial({
          color: 0xd6e6ff,
          size: 0.13,
          sizeAttenuation: true,
          transparent: true,
          opacity: 0.85,
        }),
      )
      const stars = new THREE.Points(starGeo, starMat)
      scene.add(stars)

      // ---- lighting ---------------------------------------------------------
      const key = new THREE.DirectionalLight(0xfff4e8, 2.4)
      key.position.set(3.2, 2.4, 3)
      scene.add(key)
      const rim = new THREE.DirectionalLight(0x83b7ff, 1.2)
      rim.position.set(-3, -1.2, -2.4)
      scene.add(rim)
      scene.add(new THREE.AmbientLight(0x2a3352, 1.35))

      // ---- set A: the machine on a turntable --------------------------------
      const vehicleSet = new THREE.Group()
      scene.add(vehicleSet)

      const displayVehicle = makeVehicle()
      displayVehicle.scale.setScalar(2.4)
      vehicleSet.add(displayVehicle)

      const turntable = new THREE.Mesh(
        trackDispose(new THREE.RingGeometry(0.62, 0.66, 64)),
        trackDispose(
          new THREE.MeshBasicMaterial({
            color: 0x83b7ff,
            transparent: true,
            opacity: 0.35,
            side: THREE.DoubleSide,
          }),
        ),
      )
      turntable.rotation.x = -Math.PI / 2
      turntable.position.y = -0.42
      vehicleSet.add(turntable)

      // Three pulsing pointers used during "How it works".
      const pointers: ThreeTypes.Mesh[] = []
      for (let i = 0; i < 3; i += 1) {
        const pointer = new THREE.Mesh(trackDispose(new THREE.SphereGeometry(0.022, 12, 12)), glowMat)
        pointer.visible = false
        vehicleSet.add(pointer)
        pointers.push(pointer)
      }

      // ---- set B: the launch pad --------------------------------------------
      const padSet = new THREE.Group()
      scene.add(padSet)

      // Earth underfoot is a wide flat ground, not a globe: a globe of any
      // sane radius puts its horizon far below the camera's eye line (r = 18
      // under a 2.3-unit camera hides the horizon ~30° down), which framed the
      // pad against empty space. A plane keeps the horizon at eye level, so the
      // launch site reads as a real place on a real world.
      const groundCanvas = document.createElement('canvas')
      groundCanvas.width = 256
      groundCanvas.height = 256
      const groundCtx = groundCanvas.getContext('2d')
      if (groundCtx) {
        const gradient = groundCtx.createRadialGradient(128, 128, 6, 128, 128, 128)
        gradient.addColorStop(0, '#414a42')
        gradient.addColorStop(0.35, '#343d36')
        gradient.addColorStop(0.75, '#242c27')
        gradient.addColorStop(1, '#151b19')
        groundCtx.fillStyle = gradient
        groundCtx.fillRect(0, 0, 256, 256)
      }
      const groundTexture = trackDispose(new THREE.CanvasTexture(groundCanvas))
      groundTexture.colorSpace = THREE.SRGBColorSpace
      const ground = new THREE.Mesh(
        trackDispose(new THREE.CircleGeometry(140, 96)),
        trackDispose(new THREE.MeshStandardMaterial({ map: groundTexture, roughness: 1, metalness: 0 })),
      )
      ground.rotation.x = -Math.PI / 2
      padSet.add(ground)

      // Sky dome: a calm blue atmosphere that thins out as the stack climbs.
      const skyCanvas = document.createElement('canvas')
      skyCanvas.width = 8
      skyCanvas.height = 256
      const skyCtx = skyCanvas.getContext('2d')
      if (skyCtx) {
        const gradient = skyCtx.createLinearGradient(0, 0, 0, 256)
        gradient.addColorStop(0, '#050a14')
        gradient.addColorStop(0.42, '#123c66')
        gradient.addColorStop(0.74, '#3d7fb5')
        gradient.addColorStop(0.92, '#8fb9d9')
        gradient.addColorStop(1, '#b9d4e6')
        skyCtx.fillStyle = gradient
        skyCtx.fillRect(0, 0, 8, 256)
      }
      const skyTexture = trackDispose(new THREE.CanvasTexture(skyCanvas))
      skyTexture.colorSpace = THREE.SRGBColorSpace
      const skyMat = trackDispose(
        new THREE.MeshBasicMaterial({
          map: skyTexture,
          side: THREE.BackSide,
          transparent: true,
          opacity: 1,
          depthWrite: false,
        }),
      )
      const sky = new THREE.Mesh(trackDispose(new THREE.SphereGeometry(150, 40, 24)), skyMat)
      padSet.add(sky)

      const padBase = new THREE.Mesh(
        trackDispose(new THREE.CylinderGeometry(1.5, 1.6, 0.14, 40)),
        trackDispose(new THREE.MeshStandardMaterial({ color: 0x30384d, roughness: 0.9 })),
      )
      padBase.position.y = 0.07
      padSet.add(padBase)

      const tower = new THREE.Group()
      const towerPost = new THREE.Mesh(trackDispose(new THREE.BoxGeometry(0.16, 3.2, 0.16)), darkMat)
      towerPost.position.set(-1.05, 1.6, 0)
      tower.add(towerPost)
      for (const y of [1.1, 2.0, 2.9]) {
        const arm = new THREE.Mesh(trackDispose(new THREE.BoxGeometry(0.55, 0.07, 0.07)), darkMat)
        arm.position.set(-0.78, y, 0)
        tower.add(arm)
      }
      padSet.add(tower)

      // Rocket stack: booster (drops away), upper stage + payload (continues).
      const rocket = new THREE.Group()
      padSet.add(rocket)

      const boosterGroup = new THREE.Group()
      rocket.add(boosterGroup)

      const booster = new THREE.Mesh(trackDispose(new THREE.CylinderGeometry(0.26, 0.31, 2.3, 28)), hullMat)
      booster.position.y = 1.2
      boosterGroup.add(booster)

      const boosterFlame = new THREE.Mesh(trackDispose(new THREE.ConeGeometry(0.2, 1.2, 18)), flameMat)
      boosterFlame.rotation.x = Math.PI
      boosterFlame.position.y = -0.5
      boosterGroup.add(boosterFlame)

      const upperGroup = new THREE.Group()
      rocket.add(upperGroup)

      const interstage = new THREE.Mesh(trackDispose(new THREE.CylinderGeometry(0.25, 0.26, 0.22, 24)), darkMat)
      interstage.position.y = 2.46
      upperGroup.add(interstage)

      const upperStage = new THREE.Mesh(trackDispose(new THREE.CylinderGeometry(0.19, 0.24, 0.85, 24)), hullMat)
      upperStage.position.y = 3.0
      upperGroup.add(upperStage)

      // Nose cone built as two half-shells that swing apart on cue.
      const fairingMat = trackDispose(
        new THREE.MeshStandardMaterial({
          color: 0xdde5f3,
          roughness: 0.34,
          metalness: 0.65,
          side: THREE.DoubleSide,
        }),
      )
      const fairing = new THREE.Group()
      fairing.position.y = 3.6
      const fairingHalves: ThreeTypes.Group[] = []
      for (const side of [-1, 1]) {
        const half = new THREE.Group()
        const shell = new THREE.Mesh(
          trackDispose(new THREE.CylinderGeometry(0.29, 0.29, 0.62, 18, 1, true, 0, Math.PI)),
          fairingMat,
        )
        shell.position.y = 0.31
        half.add(shell)
        const cap = new THREE.Mesh(
          trackDispose(new THREE.ConeGeometry(0.29, 0.44, 18, 1, true, 0, Math.PI)),
          fairingMat,
        )
        cap.position.y = 0.82
        half.add(cap)
        half.rotation.y = side > 0 ? 0 : Math.PI
        fairing.add(half)
        fairingHalves.push(half)
      }
      upperGroup.add(fairing)

      const payload = makeVehicle()
      payload.position.y = 3.58
      payload.scale.setScalar(2.1)
      payload.visible = false
      upperGroup.add(payload)

      const upperFlame = new THREE.Mesh(trackDispose(new THREE.ConeGeometry(0.15, 0.8, 16)), flameMat)
      upperFlame.rotation.x = Math.PI
      upperFlame.position.y = 2.0
      upperFlame.visible = false
      upperGroup.add(upperFlame)

      // A pale concrete apron so the pad reads against the ground.
      const apron = new THREE.Mesh(
        trackDispose(new THREE.RingGeometry(1.6, 3.1, 64)),
        trackDispose(
          new THREE.MeshStandardMaterial({ color: 0x4a5450, roughness: 0.95, metalness: 0.05 }),
        ),
      )
      apron.rotation.x = -Math.PI / 2
      apron.position.y = 0.02
      padSet.add(apron)

      // Ground smoke puffs.
      const puffs: { mesh: ThreeTypes.Mesh; seed: number }[] = []
      for (let i = 0; i < 12; i += 1) {
        const puff = new THREE.Mesh(trackDispose(new THREE.SphereGeometry(0.28, 12, 12)), dustMat.clone())
        trackDispose(puff.material as ThreeTypes.Material)
        const angle = (i / 12) * Math.PI * 2
        puff.position.set(Math.cos(angle) * 0.9, 0.24, Math.sin(angle) * 0.9)
        puff.scale.setScalar(0.25)
        padSet.add(puff)
        puffs.push({ mesh: puff, seed: i * 0.37 })
      }

      // ---- set C: the voyage ------------------------------------------------
      const spaceSet = new THREE.Group()
      scene.add(spaceSet)

      // Earth and the destination both sit behind the craft and both stay in
      // frame: Earth low on the left, the target growing on the right.
      const earthFar = new THREE.Mesh(
        trackDispose(new THREE.SphereGeometry(1.7, 48, 40)),
        trackDispose(
          new THREE.MeshStandardMaterial({
            map: earthMap ?? undefined,
            color: earthMap ? 0xffffff : 0x2b4a7a,
            roughness: 1,
          }),
        ),
      )
      earthFar.position.set(-3.1, -1.15, -6.6)
      spaceSet.add(earthFar)

      const targetFar = new THREE.Mesh(
        trackDispose(new THREE.SphereGeometry(2.05, 56, 44)),
        trackDispose(
          new THREE.MeshStandardMaterial({
            map: bodyMap ?? undefined,
            color: bodyMap ? 0xffffff : BODY_TINT[relic.planet],
            roughness: 1,
          }),
        ),
      )
      targetFar.position.set(2.55, 1.35, -7.4)
      spaceSet.add(targetFar)

      // The cruise stage: a bus, two solar wings and a dish — recognisable at a
      // glance, unlike the surface vehicle seen from far away.
      const cruiseCraft = new THREE.Group()
      spaceSet.add(cruiseCraft)
      const busBody = new THREE.Mesh(trackDispose(new THREE.CylinderGeometry(0.24, 0.24, 0.52, 24)), metalMat)
      cruiseCraft.add(busBody)
      const busDish = new THREE.Mesh(
        trackDispose(new THREE.SphereGeometry(0.2, 26, 12, 0, Math.PI * 2, 0, Math.PI / 2.5)),
        metalMat,
      )
      busDish.position.set(0, 0.3, 0.02)
      busDish.rotation.x = Math.PI
      cruiseCraft.add(busDish)
      for (const side of [-1, 1]) {
        const wing = new THREE.Mesh(trackDispose(new THREE.BoxGeometry(0.66, 0.014, 0.36)), panelMat)
        wing.position.set(side * 0.62, 0.04, 0)
        cruiseCraft.add(wing)
        const strut = new THREE.Mesh(trackDispose(new THREE.BoxGeometry(0.18, 0.03, 0.05)), darkMat)
        strut.position.set(side * 0.28, 0.04, 0)
        cruiseCraft.add(strut)
      }
      const cruiseNozzle = new THREE.Mesh(trackDispose(new THREE.CylinderGeometry(0.07, 0.1, 0.1, 14)), darkMat)
      cruiseNozzle.position.y = -0.3
      cruiseCraft.add(cruiseNozzle)
      const cruiseFlame = new THREE.Mesh(trackDispose(new THREE.ConeGeometry(0.06, 0.24, 12)), flameMat)
      cruiseFlame.rotation.x = Math.PI
      cruiseFlame.position.y = -0.46
      cruiseCraft.add(cruiseFlame)

      // A faint track between the two worlds, passing behind the craft.
      const trackPoints = [
        earthFar.position.clone().add(new THREE.Vector3(0.6, 0.9, -0.4)),
        new THREE.Vector3(-1.2, 0.15, -1.6),
        new THREE.Vector3(0.9, 0.55, -3.4),
        targetFar.position.clone().add(new THREE.Vector3(-1.2, -0.9, 0.7)),
      ]
      const trackCurve = new THREE.CatmullRomCurve3(trackPoints)
      const routeGeometry = trackDispose(new THREE.BufferGeometry().setFromPoints(trackCurve.getPoints(90)))
      const routeMat = trackDispose(
        new THREE.LineBasicMaterial({ color: 0x9ec8ff, transparent: true, opacity: 0.22 }),
      )
      spaceSet.add(new THREE.Line(routeGeometry, routeMat))

      // ---- set D: the landing site -----------------------------------------
      const targetSet = new THREE.Group()
      scene.add(targetSet)

      const body = new THREE.Mesh(
        trackDispose(new THREE.SphereGeometry(1, 64, 64)),
        trackDispose(
          new THREE.MeshStandardMaterial({
            map: bodyMap ?? undefined,
            color: bodyMap ? 0xffffff : BODY_TINT[relic.planet],
            roughness: 0.96,
            metalness: 0,
          }),
        ),
      )
      targetSet.add(body)

      const site = surfacePoint(relic.latitude, relic.longitude, 1.004)
      const markerPos = new THREE.Vector3(site.x, site.y, site.z)
      const siteNormal = markerPos.clone().normalize()
      const siteSide = new THREE.Vector3(0, 1, 0).cross(siteNormal)
      if (siteSide.lengthSq() < 0.001) siteSide.set(1, 0, 0)
      siteSide.normalize()
      const siteUp = siteNormal.clone().cross(siteSide).normalize()

      const marker = new THREE.Mesh(trackDispose(new THREE.SphereGeometry(0.026, 18, 18)), glowMat)
      marker.position.copy(markerPos)
      targetSet.add(marker)

      const siteRing = new THREE.Mesh(
        trackDispose(new THREE.RingGeometry(0.042, 0.058, 56)),
        trackDispose(
          new THREE.MeshBasicMaterial({
            color: 0x9ec8ff,
            transparent: true,
            opacity: 0,
            side: THREE.DoubleSide,
            depthWrite: false,
          }),
        ),
      )
      siteRing.position.copy(markerPos)
      siteRing.lookAt(markerPos.clone().multiplyScalar(4))
      targetSet.add(siteRing)

      // Descent path: high above the site, down onto it.
      const descentStart = markerPos
        .clone()
        .addScaledVector(siteUp, 0.55)
        .addScaledVector(siteSide, 0.22)
        .addScaledVector(siteNormal, 0.26)
      const descentControl = markerPos
        .clone()
        .addScaledVector(siteUp, 0.28)
        .addScaledVector(siteNormal, 0.2)
      const descentCurve = new THREE.QuadraticBezierCurve3(descentStart, descentControl, markerPos.clone())
      const trailGeo = trackDispose(new THREE.BufferGeometry().setFromPoints(descentCurve.getPoints(80)))
      const trailMat = trackDispose(
        new THREE.LineBasicMaterial({ color: 0x9fc4ff, transparent: true, opacity: 0 }),
      )
      targetSet.add(new THREE.Line(trailGeo, trailMat))

      // What actually comes down is the descent stage — a platform with legs
      // and a landing engine, carrying the payload on top — not the surface
      // vehicle flying on its own.
      const descentVehicle = new THREE.Group()
      descentVehicle.visible = false
      targetSet.add(descentVehicle)

      const descentPlatform = new THREE.Mesh(
        trackDispose(new THREE.CylinderGeometry(0.13, 0.16, 0.05, 20)),
        metalMat,
      )
      descentVehicle.add(descentPlatform)
      for (let i = 0; i < 4; i += 1) {
        const angle = (i / 4) * Math.PI * 2 + Math.PI / 4
        const leg = new THREE.Mesh(trackDispose(new THREE.CylinderGeometry(0.008, 0.008, 0.17, 6)), metalMat)
        leg.position.set(Math.cos(angle) * 0.1, -0.11, Math.sin(angle) * 0.1)
        leg.rotation.z = Math.cos(angle) * 0.55
        leg.rotation.x = Math.sin(angle) * 0.55
        descentVehicle.add(leg)
      }
      const descentFlame = new THREE.Mesh(trackDispose(new THREE.ConeGeometry(0.055, 0.3, 14)), flameMat)
      descentFlame.rotation.x = Math.PI
      descentFlame.position.y = -0.27
      descentVehicle.add(descentFlame)
      const descentPayload = makeVehicle()
      descentPayload.scale.setScalar(1.7)
      descentPayload.position.y = 0.09
      descentVehicle.add(descentPayload)

      const landedVehicle = makeVehicle()
      landedVehicle.scale.setScalar(0.7)
      landedVehicle.visible = false
      landedVehicle.position.copy(markerPos)
      landedVehicle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), siteNormal)
      targetSet.add(landedVehicle)

      const roverClone = makeVehicle()
      roverClone.scale.setScalar(0.55)
      roverClone.visible = false
      targetSet.add(roverClone)

      // Surface details used by the "After landing" chapter.
      const footprints: ThreeTypes.Mesh[] = []
      for (let i = 0; i < 9; i += 1) {
        const print = new THREE.Mesh(
          trackDispose(new THREE.CircleGeometry(0.012, 10)),
          trackDispose(
            new THREE.MeshBasicMaterial({ color: 0x6a7386, transparent: true, opacity: 0.75, side: THREE.DoubleSide }),
          ),
        )
        print.position
          .copy(markerPos)
          .addScaledVector(siteSide, 0.05 + i * 0.032)
          .addScaledVector(siteUp, 0.02 * Math.sin(i * 1.3))
          .addScaledVector(siteNormal, 0.002)
        print.lookAt(print.position.clone().multiplyScalar(3))
        print.visible = false
        targetSet.add(print)
        footprints.push(print)
      }

      const antenna = new THREE.Mesh(
        trackDispose(new THREE.ConeGeometry(0.045, 0.03, 18, 1, true)),
        metalMat,
      )
      antenna.position.copy(markerPos).addScaledVector(siteNormal, 0.06)
      antenna.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), siteNormal)
      antenna.visible = false
      targetSet.add(antenna)

      const pingRings: ThreeTypes.Mesh[] = []
      for (let i = 0; i < 2; i += 1) {
        const ring = new THREE.Mesh(
          trackDispose(new THREE.RingGeometry(0.04, 0.052, 40)),
          trackDispose(
            new THREE.MeshBasicMaterial({
              color: 0x9ef0c8,
              transparent: true,
              opacity: 0,
              side: THREE.DoubleSide,
              depthWrite: false,
            }),
          ),
        )
        ring.position.copy(markerPos).addScaledVector(siteNormal, 0.03)
        ring.lookAt(markerPos.clone().multiplyScalar(4))
        targetSet.add(ring)
        pingRings.push(ring)
      }

      const ascentCapsule = new THREE.Mesh(
        trackDispose(new THREE.ConeGeometry(0.03, 0.06, 18)),
        goldMat,
      )
      ascentCapsule.visible = false
      targetSet.add(ascentCapsule)

      // ---- interaction: drag to look around --------------------------------
      let dragYaw = 0
      let dragging = false
      let lastX = 0
      let downX = 0
      let downY = 0
      const onDown = (event: PointerEvent) => {
        dragging = true
        lastX = event.clientX
        downX = event.clientX
        downY = event.clientY
        try {
          canvas.setPointerCapture(event.pointerId)
        } catch {
          // Synthetic pointers (and some touch stacks) have no capturable id;
          // dragging still works through the pointermove listener.
        }
      }
      const onMove = (event: PointerEvent) => {
        if (!dragging) return
        dragYaw += (event.clientX - lastX) * 0.007
        dragYaw = Math.max(-1.4, Math.min(1.4, dragYaw))
        lastX = event.clientX
        // Keep the view live while dragging, even when playback is paused.
        renderScheduleRef.current?.()
      }
      const onUp = (event: PointerEvent) => {
        const wasDrag = Math.abs(event.clientX - downX) > 6 || Math.abs(event.clientY - downY) > 6
        dragging = false
        try {
          canvas.releasePointerCapture(event.pointerId)
        } catch {
          // Nothing captured: harmless.
        }
        // A tap (not a drag) on the machine inspects its parts.
        if (!wasDrag && beatRef.current < 2) setPartIndex((value) => (value + 1) % 3)
      }
      canvas.addEventListener('pointerdown', onDown)
      canvas.addEventListener('pointermove', onMove)
      canvas.addEventListener('pointerup', onUp)
      canvas.addEventListener('pointercancel', onUp)

      const resize = () => {
        // Read the *current* stage node: maximising the player swaps the node,
        // so a captured element would measure the detached one (0 × 0) and the
        // buffer would stay at the inline size.
        const el = stageRef.current
        const w = el?.clientWidth ?? 0
        const h = el?.clientHeight ?? 0
        if (!w || !h) return
        renderer.setSize(w, h, false)
        camera.aspect = w / h
        camera.updateProjectionMatrix()
        renderScheduleRef.current?.()
      }
      const observer = new ResizeObserver(resize)
      observer.observe(stage)
      observerRef.current = observer
      observedStageRef.current = stage
      resizeFnRef.current = resize
      resize()

      // ---- loop -------------------------------------------------------------
      const desiredPos = new THREE.Vector3()
      const desiredLook = new THREE.Vector3()
      const lookAt = new THREE.Vector3(0, 0, 0)
      const scratch = new THREE.Vector3()
      const lookVec = new THREE.Vector3()
      let first = true
      // Ambient clock: keeps every cosmetic motion (slow turns, flame flicker,
      // drifting camera) running smoothly even while the timeline is holding a
      // chapter open for its narration to finish.
      let animClock = 0
      let last = performance.now()
      let lastPct = -1
      let lastBeat = -1
      let lastShot = ''

      const setCamera = (px: number, py: number, pz: number, lx: number, ly: number, lz: number, dt: number) => {
        desiredPos.set(px, py, pz)
        desiredLook.set(lx, ly, lz)
        if (first) {
          camera.position.copy(desiredPos)
          lookAt.copy(desiredLook)
          first = false
        } else {
          const k = 1 - Math.exp(-dt * 2.6)
          camera.position.lerp(desiredPos, k)
          lookAt.lerp(desiredLook, k)
        }
        camera.lookAt(lookAt)
      }

      const tick = () => {
        if (disposed) return
        const now = performance.now()
        const dt = Math.min(0.05, (now - last) / 1000)
        last = now
        animClock += dt
        const anim = animClock

        const index = beatIndexAt(elapsedRef.current)
        const beatDef = BEATS[index]
        const beatEnd = STARTS[index] + beatDef.seconds
        const isLast = index === BEATS.length - 1

        if (playingRef.current) {
          // Hold the last shot of a chapter until its narration finishes.
          const holding = holdForNarration({
            speechBusy: speechBusyRef.current,
            voiceOn: voiceRef.current,
            isLast,
            msSinceSpeechStart: Date.now() - speechStartedRef.current,
            beatSeconds: beatDef.seconds,
          })
          let next = elapsedRef.current + dt * speedRef.current
          if (holding) next = Math.min(next, beatEnd - 0.05)
          elapsedRef.current = Math.min(DURATION, next)
          if (elapsedRef.current >= DURATION) {
            playingRef.current = false
            setPlaying(false)
          }
        }

        const t = elapsedRef.current
        const i = beatIndexAt(t)
        const b = BEATS[i]
        const p = Math.max(0, Math.min(1, (t - STARTS[i]) / b.seconds))

        // A new shot is a cut, not a glide: snap the camera so every chapter
        // opens on its own framing (and so a throttled tab cannot leave the
        // camera stranded between two sets).
        if (b.shot !== lastShot) {
          lastShot = b.shot
          first = true
        }

        // Only the active set is visible.
        vehicleSet.visible = b.shot === 'vehicle' || b.shot === 'closeup'
        padSet.visible = b.shot === 'pad' || b.shot === 'ascent' || b.shot === 'staging'
        spaceSet.visible = b.shot === 'cruise'
        targetSet.visible =
          b.shot === 'descent' || b.shot === 'touchdown' || b.shot === 'surface' || b.shot === 'legacy'
        // The launch set owns its own sky, so the stars are only hidden there.
        if (!padSet.visible) stars.visible = true

        // ---- set A: meet / how it works --------------------------------------
        if (vehicleSet.visible) {
          vehicleSet.rotation.y = dragYaw + anim * (b.shot === 'closeup' ? 0.18 : 0.32)
          displayVehicle.rotation.x = 0
          displayVehicle.position.y = Math.sin(anim * 1.1) * 0.02

          pointers.forEach((pointer, idx) => {
            const angle = anim * 0.6 + (idx / 3) * Math.PI * 2
            const radius = 0.55
            pointer.position.set(
              Math.cos(angle) * radius,
              idx === 0 ? 0.16 : idx === 1 ? -0.18 : 0.32,
              Math.sin(angle) * radius * 0.6,
            )
            pointer.visible = b.shot === 'closeup'
            ;(pointer.material as ThreeTypes.MeshBasicMaterial).opacity = 0.45 + Math.sin(anim * 4 + idx) * 0.35
          })

          // The machine fills the frame: at 2.75 units a 0.2-unit rover was a
          // speck, especially in the small inline player.
          const dist = b.shot === 'closeup' ? 0.88 - 0.12 * Math.sin(p * Math.PI) : 1.18 - 0.14 * p
          setCamera(
            Math.sin(anim * 0.25 + dragYaw) * dist * 0.55,
            0.42 + Math.sin(anim * 0.4) * 0.05 + (b.shot === 'closeup' ? 0.05 * Math.sin(p * 6) : 0),
            dist,
            0,
            0,
            0,
            dt,
          )
        }

        // ---- set B: pad / liftoff / staging ----------------------------------
        if (padSet.visible) {
          // Atmosphere thins with altitude while the ground stays anchored.
          skyMat.opacity = 1 - smoothstep(9, 42, rocket.position.y) * 0.92
          stars.visible = rocket.position.y > 12

          const flameScale =
            b.shot === 'pad' ? 0.45 + Math.sin(anim * 9) * 0.12 : 1.35 + Math.sin(anim * 16) * 0.18
          const flameLength = b.shot === 'pad' ? 1 : 2.6 + Math.sin(anim * 16) * 0.3
          boosterFlame.scale.set(flameScale, flameLength, flameScale)
          ;(boosterFlame.material as ThreeTypes.MeshBasicMaterial).opacity = b.shot === 'pad' ? 0.4 : 0.9
          boosterFlame.visible = b.shot !== 'staging' || p < 0.25

          upperFlame.visible = b.shot === 'staging' && p > 0.3

          if (b.shot === 'pad') {
            rocket.position.y = 0
            rocket.rotation.y = 0
            boosterGroup.position.set(0, 0, 0)
            boosterGroup.rotation.set(0, 0, 0)
            boosterGroup.visible = true
            fairing.visible = true
            fairingHalves.forEach((half) => {
              half.rotation.z = 0
              half.position.x = 0
            })
            payload.visible = false
            upperFlame.visible = false

            const drift = anim * 0.05
            setCamera(
              5.9 + Math.sin(drift) * 0.35,
              2.9,
              7.6 + Math.cos(drift) * 0.25,
              0,
              2.0,
              0,
              dt,
            )

            puffs.forEach(({ mesh, seed }) => {
              const life = (anim * 0.35 + seed) % 1
              mesh.scale.setScalar(0.2 + life * 0.55)
              ;(mesh.material as ThreeTypes.MeshBasicMaterial).opacity = 0.16 * (1 - life)
              mesh.position.y = 0.2 + life * 0.3
            })
          } else {
            const climb = b.shot === 'ascent' ? easeInOut(p) * 26 : 26 + p * 2.5
            rocket.position.y = climb
            rocket.rotation.y = b.shot === 'ascent' ? 0 : 0.5

            if (b.shot === 'staging') {
              const sep = smoothstep(0.1, 0.7, p)
              boosterGroup.position.set(sep * 1.9, -sep * 5.2, sep * 0.5)
              boosterGroup.rotation.set(sep * 0.9, sep * 0.5, sep * 1.4)
              boosterGroup.visible = sep < 0.96
              fairingHalves.forEach((half, index) => {
                const sign = index === 0 ? 1 : -1
                half.rotation.z = sign * sep * 1.05
                half.position.x = sign * sep * 0.34
              })
              fairing.visible = sep < 0.9
              payload.visible = sep > 0.35
              payload.rotation.y = anim * 0.8
            } else {
              boosterGroup.visible = true
              fairing.visible = true
              fairingHalves.forEach((half) => {
                half.rotation.z = 0
                half.position.x = 0
              })
              payload.visible = false
            }

            if (b.shot === 'ascent') {
              // The camera stays near the pad and tilts up, so the stack is seen
              // rising away from Earth instead of sitting still in the frame.
              setCamera(7.4 + p * 1.1, 3.0 + p * 1.4, 9.6, 0, 1.6 + climb * 0.62, 0, dt)
            } else {
              setCamera(6.9, climb + 3.5, 8.4, 0, climb + 1.35, 0, dt)
            }

            puffs.forEach(({ mesh, seed }) => {
              const life = (p + seed * 0.2) % 1
              mesh.scale.setScalar(0.4 + life * 1.6)
              ;(mesh.material as ThreeTypes.MeshBasicMaterial).opacity = 0.3 * (1 - life)
            })
          }
        }

        // ---- set C: the voyage ----------------------------------------------
        if (spaceSet.visible) {
          earthFar.rotation.y = anim * 0.06
          targetFar.rotation.y = anim * 0.045
          targetFar.scale.setScalar(0.78 + p * 0.3)
          cruiseCraft.position.set(0, 0.04 + Math.sin(anim * 0.7) * 0.03, 0)
          cruiseCraft.rotation.set(
            0.08,
            -0.44 + dragYaw * 0.5 + Math.sin(anim * 0.3) * 0.05,
            0.04 * Math.sin(anim * 0.5),
          )
          cruiseFlame.visible = Math.sin(anim * 0.9) > -0.4
          routeMat.opacity = 0.14 + p * 0.24
          setCamera(
            Math.sin(anim * 0.16) * 0.35,
            1.05 + Math.sin(anim * 0.24) * 0.06,
            5.2,
            Math.sin(anim * 0.12) * 0.12,
            0.1,
            -2,
            dt,
          )
        }

        // ---- set D: landing site ---------------------------------------------
        if (targetSet.visible) {
          targetSet.rotation.y = dragYaw * 0.5
          body.rotation.y = b.shot === 'legacy' ? anim * 0.06 : 0

          marker.scale.setScalar(1 + Math.sin(anim * 5) * 0.15)

          const camDist =
            b.shot === 'descent' ? 2.3 : b.shot === 'touchdown' ? 1.85 : b.shot === 'surface' ? 2.6 : 4.1
          scratch.copy(siteNormal).multiplyScalar(camDist)
          scratch.addScaledVector(siteSide, b.shot === 'descent' ? 0.95 : b.shot === 'legacy' ? 0.5 : 0.7)
          scratch.addScaledVector(siteUp, b.shot === 'descent' ? 0.62 : b.shot === 'legacy' ? 0.7 : 0.32)

          // During descent the camera looks up the flight path so both the
          // falling craft and its landing point stay in frame.
          lookVec
            .copy(markerPos)
            .multiplyScalar(1.004)
            .addScaledVector(siteUp, b.shot === 'descent' ? 0.2 : 0.02)

          setCamera(scratch.x, scratch.y, scratch.z, lookVec.x, lookVec.y, lookVec.z, dt)

          // descent + touchdown
          trailMat.opacity = b.shot === 'descent' ? 0.55 : b.shot === 'touchdown' ? 0.22 : 0
          if (b.shot === 'descent') {
            descentVehicle.visible = true
            const e = easeInOut(p)
            const point = descentCurve.getPoint(e)
            descentVehicle.position.copy(point)
            descentVehicle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), siteNormal)
            descentVehicle.rotateY(Math.sin(anim * 0.4) * 0.08)
            descentFlame.scale.setScalar(0.85 + Math.sin(anim * 18) * 0.18)
            landedVehicle.visible = false
          } else if (b.shot === 'touchdown') {
            descentVehicle.visible = p < 0.45
            if (descentVehicle.visible) {
              descentVehicle.position.copy(markerPos).addScaledVector(siteNormal, 0.02)
              descentVehicle.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), siteNormal)
            }
            landedVehicle.visible = p >= 0.45
            const cycle = (p % 0.5) / 0.5
            siteRing.scale.setScalar(1 + cycle * 5.5)
            ;(siteRing.material as ThreeTypes.MeshBasicMaterial).opacity = 0.85 * (1 - cycle)
          } else {
            descentVehicle.visible = false
            ;(siteRing.material as ThreeTypes.MeshBasicMaterial).opacity = 0
          }

          // after landing: the class's own post-touchdown story
          const surfaceActive = b.shot === 'surface' || b.shot === 'legacy'
          roverClone.visible = false
          antenna.visible = false
          ascentCapsule.visible = false
          footprints.forEach((print) => {
            print.visible = false
          })
          pingRings.forEach((ring) => {
            ;(ring.material as ThreeTypes.MeshBasicMaterial).opacity = 0
          })

          if (surfaceActive) {
            landedVehicle.visible = true

            if (vehicle === 'rover') {
              roverClone.visible = true
              const along = Math.min(1, p * 1.1)
              const heading = markerPos
                .clone()
                .addScaledVector(siteSide, 0.08 + along * 0.26)
                .normalize()
                .multiplyScalar(1.004)
              roverClone.position.copy(heading)
              roverClone.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), siteNormal)
              roverClone.rotateY(-Math.PI / 2)
              roverClone.position.addScaledVector(siteNormal, 0.012)
            } else if (vehicle === 'crewed') {
              footprints.forEach((print, idx) => {
                print.visible = p > (idx / footprints.length) * 0.75
              })
            } else if (vehicle === 'sample') {
              antenna.visible = true
              if (p > 0.45) {
                ascentCapsule.visible = true
                const rise = (p - 0.45) / 0.55
                ascentCapsule.position
                  .copy(markerPos)
                  .addScaledVector(siteNormal, 0.05 + rise * 0.5)
                  .addScaledVector(siteUp, rise * 0.12)
              }
            } else if (vehicle === 'lander') {
              antenna.visible = true
              pingRings.forEach((ring, idx) => {
                const cycle = (p * 0.9 + idx * 0.5) % 1
                ring.scale.setScalar(1 + cycle * 4)
                ;(ring.material as ThreeTypes.MeshBasicMaterial).opacity = 0.55 * (1 - cycle)
              })
            } else {
              antenna.visible = true
            }
          } else if (b.shot === 'touchdown' || b.shot === 'descent') {
            landedVehicle.visible = b.shot === 'touchdown' && p >= 0.45
          }
        }

        const pct = Math.round((t / DURATION) * 100)
        if (pct !== lastPct) {
          lastPct = pct
          setProgress(pct)
        }
        if (i !== lastBeat) {
          lastBeat = i
          setBeat(i)
        }

        renderer.render(scene, camera)
        if (playingRef.current) loop.schedule()
      }

      // One frame loop for the lifetime of this scene. `createFrameLoop` clears
      // its handle *before* running the frame, so a frame that has just finished
      // can queue the next one. The previous inline scheduler kept the old handle
      // set, so the animation stopped after a single frame and only restarted
      // when some unrelated event happened to call it again.
      const loop = createFrameLoop({
        requestFrame: (callback: FrameRequestCallback) => requestAnimationFrame(callback),
        cancelFrame: (handle: number) => cancelAnimationFrame(handle),
        onFrame: tick,
      })
      renderScheduleRef.current = () => loop.schedule()
      loop.schedule()

      // A hidden tab stops receiving frames. On return, drop the stale timestamp
      // so the first frame does not jump, and make sure the loop is alive again.
      const onVisibility = () => {
        if (document.visibilityState !== 'visible') return
        last = performance.now()
        loop.schedule()
      }
      document.addEventListener('visibilitychange', onVisibility)

      teardown = () => {
        loop.cancel()
        document.removeEventListener('visibilitychange', onVisibility)
        renderScheduleRef.current = null
        observer.disconnect()
        observerRef.current = null
        observedStageRef.current = null
        resizeFnRef.current = null
        canvasElRef.current = null
        canvas.remove()
        canvas.removeEventListener('pointerdown', onDown)
        canvas.removeEventListener('pointermove', onMove)
        canvas.removeEventListener('pointerup', onUp)
        canvas.removeEventListener('pointercancel', onUp)
        for (const item of disposeList) item.dispose()
        renderer.dispose()
      }
    }

    boot().catch(() => {
      if (!disposed) setFailed(true)
    })

    return () => {
      disposed = true
      renderScheduleRef.current = null
      teardown?.()
    }
    // Deliberately no `expanded` here: maximising the player must not rebuild
    // the scene. The canvas is re-parented into the new stage node instead.
  }, [active, relic.id, relic.planet, relic.latitude, relic.longitude, vehicle])

  // Keep the single canvas attached to whichever stage node currently exists,
  // and keep the ResizeObserver pointed at it. This runs after every commit, so
  // expanding or collapsing only costs a re-parent and a resize — never a
  // rebuild of the scene.
  useEffect(() => {
    const host = canvasHostRef.current
    const canvas = canvasElRef.current
    if (host && canvas && canvas.parentElement !== host) host.appendChild(canvas)

    const stage = stageRef.current
    const observer = observerRef.current
    if (stage && observer && observedStageRef.current !== stage) {
      if (observedStageRef.current) observer.unobserve(observedStageRef.current)
      observer.observe(stage)
      observedStageRef.current = stage
      resizeFnRef.current?.()
    }
  })

  /**
   * Edge and Chromium only let the speech engine run once the document has a
   * real user gesture, and a fresh engine can sit paused. Calling this straight
   * from the click handler unlocks it before the narration effect schedules the
   * first line. The unlock utterance is silent, so nothing is heard twice.
   */
  const primeSpeech = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return
    const synth = window.speechSynthesis
    try {
      synth.resume()
    } catch {
      // older engines have no resume()
    }
    try {
      const unlock = new SpeechSynthesisUtterance(' ')
      unlock.volume = 0
      unlock.rate = 2
      synth.speak(unlock)
    } catch {
      // nothing to unlock on this engine
    }
  }, [])

  const toggle = useCallback(() => {
    primeSpeech()
    if (!active) {
      setActive(true)
      setPlaying(true)
      return
    }
    // At the very end of the story the play button used to resume a timeline
    // that was already full, so the first frame finished it again and nothing
    // happened. Starting from the top is what the button promises there.
    if (!playingRef.current && elapsedRef.current >= DURATION - 0.01) {
      elapsedRef.current = 0
      setProgress(0)
      setBeat(0)
      setPlaying(true)
      return
    }
    setPlaying((value) => !value)
  }, [active, primeSpeech])

  const replay = useCallback(() => {
    primeSpeech()
    elapsedRef.current = 0
    setProgress(0)
    setBeat(0)
    setActive(true)
    setPlaying(true)
  }, [primeSpeech])

  const seekTime = useCallback((seconds: number) => {
    const clamped = clampSeek(seconds, DURATION)
    elapsedRef.current = clamped
    setBeat(beatIndexAt(clamped))
    setProgress(Math.round((clamped / DURATION) * 100))
    setActive(true)
    renderScheduleRef.current?.()
  }, [])

  const seekTo = useCallback(
    (index: number) => {
      const safe = Math.max(0, Math.min(BEATS.length - 1, index))
      seekTime(STARTS[safe] + 0.001)
      setPlaying(true)
    },
    [seekTime],
  )

  // Click or drag anywhere on the timeline to scrub the whole story.
  const scrub = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect()
      if (!rect.width) return
      const ratio = Math.max(0, Math.min(0.999, (event.clientX - rect.left) / rect.width))
      seekTime(ratio * DURATION)
    },
    [seekTime],
  )

  const stepChapter = useCallback(
    (delta: number) => {
      seekTo(beatIndexAt(elapsedRef.current) + delta)
    },
    [seekTo],
  )

  const cycleSpeed = useCallback(() => {
    setSpeed((value) => (value === 1 ? 1.25 : value === 1.25 ? 1.5 : value === 1.5 ? 0.75 : 1))
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
          <span className="font-mono text-[9px] uppercase tracking-[0.16em] text-moon/45">
            {beat + 1}/{BEATS.length}
          </span>
          {expanded && (
            <span className="hidden font-display text-[9px] uppercase tracking-[0.18em] text-moon/60 sm:inline">
              {relic.name}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {voice && narrationStatus === 'failed' && (
            <button
              type="button"
              onClick={() => {
                primeSpeech()
                narrationRef.current?.retry()
              }}
              aria-label="Retry narration"
              className="rounded-full border border-amber-300/50 bg-amber-300/10 px-2 py-0.5 font-display text-[9px] uppercase tracking-[0.14em] text-amber-200 transition-colors hover:border-amber-300 hover:text-amber-100"
            >
              Retry audio
            </button>
          )}
          <p className="mr-1 hidden font-mono text-[9px] uppercase tracking-[0.16em] text-moon/45 sm:block">
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
        tabIndex={active ? 0 : -1}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') {
            event.preventDefault()
            stepChapter(1)
          } else if (event.key === 'ArrowLeft') {
            event.preventDefault()
            stepChapter(-1)
          } else if (event.key === ' ') {
            event.preventDefault()
            toggle()
          } else if (/^[1-9]$/.test(event.key)) {
            event.preventDefault()
            seekTo(Number(event.key) - 1)
          } else if (event.key === '0') {
            event.preventDefault()
            seekTo(9)
          }
        }}
        aria-label="Mission film scene. Arrow keys change chapter."
        className={`relative w-full overflow-hidden bg-[#05060f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-electric/60 ${
          expanded ? 'min-h-0 flex-1 rounded-xl' : 'mt-2 aspect-[16/9]'
        }`}
      >
        <div ref={canvasHostRef} className="absolute inset-0" />
        {!active && (
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
              {BEATS.length} chapters · ≈ {DURATION} s · narrated · drag to look · keys 1-0
            </p>
          </div>
        )}

        {active && !failed && (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 bg-gradient-to-b from-void/85 to-transparent p-2.5">
            <span className="font-display text-[9px] uppercase tracking-[0.2em] text-starlight/90">
              {String(beat + 1).padStart(2, '0')} · {current.title}
            </span>
            <span className="max-w-[58%] text-right font-mono text-[9px] leading-relaxed text-moon/75">
              {relic.agency} · {relic.year} · {relic.kind}
            </span>
          </div>
        )}

        {active && failed && (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center">
            <p className="text-xs leading-relaxed text-moon/80">
              3D playback is unavailable on this device, so the narration and the mission record above stand as the
              source.
            </p>
          </div>
        )}

        {active && !failed && beat < 2 && (
          <div className="pointer-events-none absolute left-2.5 top-9 flex max-w-[74%] flex-col gap-1">
            <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-moon/45">
              {partIndex < 0 ? 'Tap the machine to inspect it' : `Part ${partIndex + 1} of 3 · tap again`}
            </span>
            {partIndex >= 0 && (
              <div className="rounded-lg border border-electric/30 bg-void/85 px-2.5 py-1.5">
                <p className="font-display text-[9px] uppercase tracking-[0.18em] text-electric">
                  {parts[partIndex].label}
                </p>
                <p className="mt-0.5 text-[10px] leading-snug text-starlight/85">{parts[partIndex].detail}</p>
              </div>
            )}
          </div>
        )}

        {active && !failed && captions && (
          <p className="pointer-events-none absolute inset-x-0 bottom-12 mx-auto max-w-[92%] rounded-lg bg-void/75 px-3 py-1.5 text-center text-[11px] leading-snug text-starlight/90">
            {current.narration}
          </p>
        )}

        {active && !failed && (
          <p className="pointer-events-none absolute bottom-10 left-2.5 max-w-[60%] font-mono text-[8px] leading-snug text-moon/45">
            Illustrative mission sequence. Visual stages are simplified representations and may not reproduce the exact historical flight profile.
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
            <button
              type="button"
              onClick={() => stepChapter(-1)}
              aria-label="Previous chapter"
              className="flex size-7 items-center justify-center rounded-full border border-orbit/40 bg-void/60 text-moon transition-colors hover:border-electric/70 hover:text-starlight"
            >
              <ChevronLeft className="size-3" aria-hidden />
            </button>
            <button
              type="button"
              onClick={() => stepChapter(1)}
              aria-label="Next chapter"
              className="flex size-7 items-center justify-center rounded-full border border-orbit/40 bg-void/60 text-moon transition-colors hover:border-electric/70 hover:text-starlight"
            >
              <ChevronRight className="size-3" aria-hidden />
            </button>

            <div
              role="slider"
              tabIndex={0}
              aria-label="Film timeline. Click or drag to scrub."
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={progress}
              onPointerDown={scrub}
              onPointerMove={(event) => {
                if (event.buttons === 1) scrub(event)
              }}
              className="flex flex-1 cursor-pointer items-center gap-[3px] py-1"
            >
              {BEATS.map((item, index) => {
                const share = (item.seconds / DURATION) * 100
                const filled = index < beat ? 100 : index === beat ? ((elapsedRef.current - STARTS[index]) / item.seconds) * 100 : 0
                return (
                  <span key={item.id} className="h-[3px] overflow-hidden rounded-full bg-white/10" style={{ width: `${share}%` }}>
                    <span
                      className="block h-full rounded-full bg-electric"
                      style={{ width: `${Math.max(0, Math.min(100, filled))}%` }}
                    />
                  </span>
                )
              })}
            </div>
            <span className="font-mono text-[9px] text-moon/55">{progress}%</span>
            <button
              type="button"
              onClick={cycleSpeed}
              aria-label={`Playback speed ${speed} times. Change speed.`}
              className="flex items-center gap-1 rounded-full border border-orbit/40 bg-void/60 px-1.5 py-0.5 font-mono text-[9px] text-moon transition-colors hover:border-electric/70 hover:text-starlight"
            >
              <Gauge className="size-3" aria-hidden />
              {speed}×
            </button>
          </div>
        )}
      </div>

      {/* Chapter rail: jump to any part of the story. */}
      <div className="flex flex-wrap gap-1.5 px-1 pt-1 sm:px-0">
        {BEATS.map((item, index) => (
          <button
            key={item.id}
            type="button"
            onClick={() => seekTo(index)}
            aria-current={index === beat ? 'step' : undefined}
            className={`flex items-center gap-1 rounded-full border px-2 py-0.5 font-display text-[9px] uppercase tracking-[0.12em] transition-colors ${
              index === beat
                ? 'border-electric/60 bg-electric/10 text-starlight'
                : 'border-orbit/25 text-moon/60 hover:border-electric/40 hover:text-starlight'
            }`}
          >
            <span className="font-mono text-[8px] opacity-60">{String(index + 1).padStart(2, '0')}</span>
            {item.label}
          </button>
        ))}
      </div>

      <div className="px-1 sm:px-0">
        <p className="py-2 text-[10px] leading-relaxed text-moon/55">
          <span className="text-moon/80">On screen:</span> {current.note}
        </p>
        {!expanded && (
          <p className="pb-2 text-[10px] leading-relaxed text-moon/40">
            Rendered live from this record&apos;s own dataset values. Drag the scene to look around, or jump to any
            chapter.
          </p>
        )}
      </div>
    </div>
  )

  return expanded && mounted ? createPortal(card, document.body) : card
}
