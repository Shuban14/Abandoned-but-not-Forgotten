'use client'

import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import * as THREE from 'three'
import type { PlanetId } from '@/lib/space-data'
import type { SpaceLayout, PlanetSlot } from '@/lib/space-layout'
import {
  createCloudTexture,
  createGlowTexture,
  createMarsTextures,
  createMoonTextures,
  type PlanetTextures,
} from '@/lib/planet-textures'
import { mulberry32 } from '@/lib/noise'

export type PointerState = { x: number; y: number; yaw: number; pitch: number; dragging: boolean }

type SceneProps = {
  layout: SpaceLayout
  hovered: PlanetId | null
  focused: PlanetId | null
  revealed: boolean
  reducedMotion: boolean
  pointer: MutableRefObject<PointerState>
}

const CAMERA_Z = 10
const FOV = 35
const damp = THREE.MathUtils.damp
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3)

const ATMO_VERT = /* glsl */ `
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vN = normalize(normalMatrix * normal);
    vV = normalize(-mv.xyz);
    gl_Position = projectionMatrix * mv;
  }
`
const ATMO_FRAG = /* glsl */ `
  uniform vec3 uColor;
  uniform float uIntensity;
  uniform float uPower;
  uniform float uBack;
  uniform vec3 uLight;
  varying vec3 vN;
  varying vec3 vV;
  void main() {
    float d = dot(normalize(vN), normalize(vV));
    float t = uBack > 0.5 ? pow(clamp(-d, 0.0, 1.0), uPower) : pow(clamp(1.0 - d, 0.0, 1.0), uPower);
    float lit = 0.45 + 0.55 * max(dot(normalize(vN), normalize(uLight)), 0.0);
    float a = t * uIntensity * lit;
    gl_FragColor = vec4(uColor * a, a);
  }
`

function createAtmosphere(color: string, power: number, back: boolean) {
  return new THREE.ShaderMaterial({
    vertexShader: ATMO_VERT,
    fragmentShader: ATMO_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: back ? THREE.BackSide : THREE.FrontSide,
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uIntensity: { value: 1 },
      uPower: { value: power },
      uBack: { value: back ? 1 : 0 },
      uLight: { value: new THREE.Vector3(-0.6, 0.4, 0.7) },
    },
  })
}

type SharedRefs = {
  reveal: MutableRefObject<number>
  upp: number
}

type PlanetProps = {
  id: PlanetId
  slot: PlanetSlot
  textures: PlanetTextures | null
  hovered: boolean
  focus: 'this' | 'other' | 'none'
  shared: SharedRefs
  pointer: MutableRefObject<PointerState>
  reducedMotion: boolean
  config: {
    rim: string
    halo: string
    rimBase: number
    rimHover: number
    haloBase: number
    haloHover: number
    ring: string
    ringHover: string
    spin: number
    tilt: number
    bumpScale: number
    ringTilt: number
  }
}

function Planet({ id, slot, textures, hovered, focus, shared, pointer, reducedMotion, config }: PlanetProps) {
  const root = useRef<THREE.Group>(null)
  const body = useRef<THREE.Group>(null)
  const mesh = useRef<THREE.Mesh>(null)
  const ringGroup = useRef<THREE.Group>(null)
  const ringMat = useRef<THREE.MeshBasicMaterial>(null)
  const ringGlowMat = useRef<THREE.MeshBasicMaterial>(null)
  const dot = useRef<THREE.Mesh>(null)
  const anim = useRef({ hover: 0, focus: 0, hide: 0, spin: id === 'mars' ? 2.2 : 0.6 })

  const rimMat = useMemo(() => createAtmosphere(config.rim, 2.6, false), [config.rim])
  const haloMat = useMemo(() => createAtmosphere(config.halo, 1.7, true), [config.halo])

  const material = useMemo(() => {
    if (!textures) return null
    const map = new THREE.CanvasTexture(textures.map)
    map.colorSpace = THREE.SRGBColorSpace
    map.anisotropy = 8
    const bump = new THREE.CanvasTexture(textures.bump)
    bump.anisotropy = 8
    return new THREE.MeshStandardMaterial({
      map,
      bumpMap: bump,
      bumpScale: config.bumpScale,
      roughness: 1,
      metalness: 0,
    })
  }, [textures, config.bumpScale])

  const ringA = 1.55
  const ringB = 1.24

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    const a = anim.current
    a.hover = damp(a.hover, hovered ? 1 : 0, 8, dt)
    a.focus = damp(a.focus, focus === 'this' ? 1 : 0, 2.8, dt)
    a.hide = damp(a.hide, focus === 'other' ? 1 : 0, 4, dt)

    const reveal = easeOut(shared.reveal.current)
    const upp = shared.upp
    const baseR = slot.r * upp * (0.5 + 0.5 * reveal)
    const focusScale = 1 + 0.85 * a.focus
    const visibility = (1 - a.hide) * Math.min(1, reveal * 1.6)

    if (root.current) {
      root.current.visible = reveal > 0.01 && a.hide < 0.995
      root.current.position.set(
        slot.x * upp * (1 - a.focus * 0.92),
        -slot.y * upp * (1 - a.focus * 0.4),
        a.focus * 1.2,
      )
    }
    if (body.current) body.current.scale.setScalar(baseR * focusScale * (1 + 0.07 * a.hover) * Math.max(visibility, 0.001))
    if (mesh.current) {
      if (!reducedMotion) a.spin += dt * config.spin
      mesh.current.rotation.y = a.spin + pointer.current.yaw * 1.4
      mesh.current.rotation.x = pointer.current.pitch * 1.2
    }
    rimMat.uniforms.uIntensity.value = damp(
      rimMat.uniforms.uIntensity.value,
      (config.rimBase + (config.rimHover - config.rimBase) * a.hover) * visibility,
      8,
      dt,
    )
    haloMat.uniforms.uIntensity.value = damp(
      haloMat.uniforms.uIntensity.value,
      (config.haloBase + (config.haloHover - config.haloBase) * a.hover) * visibility,
      8,
      dt,
    )

    if (ringGroup.current) {
      ringGroup.current.scale.setScalar(baseR * focusScale * Math.max(visibility, 0.001))
      const t = state.clock.elapsedTime
      ringGroup.current.rotation.set(
        reducedMotion ? 0.2 : 0.2 + Math.sin(t * 0.18 + slot.x) * 0.16 + pointer.current.pitch * 0.5,
        reducedMotion ? 0 : Math.sin(t * 0.14 + slot.r) * 0.2 + pointer.current.yaw * 0.5,
        config.ringTilt,
      )
    }
    if (ringMat.current) ringMat.current.opacity = (0.24 + 0.5 * a.hover) * (1 - a.focus)
    if (ringGlowMat.current) ringGlowMat.current.opacity = 0.32 * a.hover * (1 - a.focus)
    if (dot.current && !reducedMotion) {
      const th = state.clock.elapsedTime * (id === 'moon' ? 0.32 : 0.24) + (id === 'moon' ? 0.6 : 2.4)
      dot.current.position.set(ringA * Math.cos(th), ringB * Math.sin(th), 0)
    }
  })

  return (
    <>
      <group ref={root} visible={false}>
        <group ref={body} rotation={[0, 0, config.tilt]}>
          {material && (
            <mesh ref={mesh} material={material}>
              <sphereGeometry args={[1, 96, 64]} />
            </mesh>
          )}
          <mesh scale={1.004} material={rimMat}>
            <sphereGeometry args={[1, 64, 48]} />
          </mesh>
          <mesh scale={1.16} material={haloMat}>
            <sphereGeometry args={[1, 64, 48]} />
          </mesh>
        </group>
        <group ref={ringGroup}>
          <mesh scale={[ringA, ringB, 1]}>
            <torusGeometry args={[1, 0.0032, 6, 220]} />
            <meshBasicMaterial
              ref={ringMat}
              color={hovered ? config.ringHover : config.ring}
              transparent
              opacity={0.24}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          <mesh scale={[ringA, ringB, 1]}>
            <torusGeometry args={[1, 0.016, 6, 220]} />
            <meshBasicMaterial
              ref={ringGlowMat}
              color={config.ringHover}
              transparent
              opacity={0}
              blending={THREE.AdditiveBlending}
              depthWrite={false}
              toneMapped={false}
            />
          </mesh>
          <mesh ref={dot} position={[ringA, 0, 0]}>
            <sphereGeometry args={[0.022, 12, 12]} />
            <meshBasicMaterial color={config.ringHover} toneMapped={false} />
          </mesh>
        </group>
      </group>
    </>
  )
}

function BigOrbits({ upp, width, reducedMotion }: { upp: number; width: number; reducedMotion: boolean }) {
  const a = useRef<THREE.Group>(null)
  const b = useRef<THREE.Group>(null)
  const z = -1.6
  const k = (CAMERA_Z - z) / CAMERA_Z
  const rx1 = Math.min(width * 0.47, 820) * upp * k
  const rx2 = Math.min(width * 0.36, 620) * upp * k

  useFrame((state) => {
    if (reducedMotion) return
    const t = state.clock.elapsedTime
    if (a.current) a.current.rotation.set(0.5 + Math.sin(t * 0.09) * 0.07, Math.sin(t * 0.07) * 0.08, -0.12 + Math.sin(t * 0.05) * 0.03)
    if (b.current) b.current.rotation.set(0.62 + Math.cos(t * 0.08) * 0.06, Math.cos(t * 0.06) * 0.07, 0.16 + Math.cos(t * 0.04) * 0.03)
  })

  return (
    <group position={[0, -0.1, z]}>
      <group ref={a} scale={[rx1, rx1 * 0.62, 1]}>
        <mesh>
          <torusGeometry args={[1, 0.0016, 4, 300]} />
          <meshBasicMaterial color="#8196C4" transparent opacity={0.2} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
      <group ref={b} scale={[rx2, rx2 * 0.7, 1]}>
        <mesh>
          <torusGeometry args={[1, 0.0016, 4, 300]} />
          <meshBasicMaterial color="#83B7FF" transparent opacity={0.13} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
        </mesh>
      </group>
    </group>
  )
}

function MilkyWay({ pointer, reducedMotion }: { pointer: MutableRefObject<PointerState>; reducedMotion: boolean }) {
  const outer = useRef<THREE.Group>(null)
  const inner = useRef<THREE.Group>(null)
  const glow = useMemo(() => {
    const t = new THREE.CanvasTexture(createGlowTexture(64))
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [])
  const coreGlow = useMemo(() => {
    const t = new THREE.CanvasTexture(createCloudTexture([245, 214, 162], 5, 256))
    t.colorSpace = THREE.SRGBColorSpace
    return t
  }, [])

  const geometry = useMemo(() => {
    const rand = mulberry32(99)
    const count = 9000
    const positions = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)
    const core = new THREE.Color('#F5D6A2')
    const mid = new THREE.Color('#83B7FF')
    const edge = new THREE.Color('#66558F')
    const white = new THREE.Color('#F3F5FF')
    const tmp = new THREE.Color()
    const R = 11
    for (let i = 0; i < count; i++) {
      const arm = i % 3
      const r = Math.pow(rand(), 1.45) * R
      const spin = r * 0.46
      const branch = (arm / 3) * Math.PI * 2
      const scatter = Math.pow(rand(), 2.4) * (rand() < 0.5 ? 1 : -1) * (0.25 + r * 0.16)
      const scatterY = Math.pow(rand(), 2.4) * (rand() < 0.5 ? 1 : -1) * (0.15 + r * 0.05)
      const scatterZ = Math.pow(rand(), 2.4) * (rand() < 0.5 ? 1 : -1) * (0.25 + r * 0.16)
      positions[i * 3] = Math.cos(branch + spin) * r + scatter
      positions[i * 3 + 1] = scatterY
      positions[i * 3 + 2] = Math.sin(branch + spin) * r + scatterZ
      const f = r / R
      if (f < 0.35) tmp.copy(core).lerp(white, rand() * 0.5)
      else if (f < 0.7) tmp.copy(white).lerp(mid, (f - 0.35) / 0.35)
      else tmp.copy(mid).lerp(edge, (f - 0.7) / 0.3)
      tmp.multiplyScalar(0.5 + rand() * 0.6)
      colors[i * 3] = tmp.r
      colors[i * 3 + 1] = tmp.g
      colors[i * 3 + 2] = tmp.b
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    return g
  }, [])

  useFrame((state, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    if (inner.current) {
      if (!reducedMotion) inner.current.rotation.y += dt * 0.012
    }
    if (outer.current) {
      outer.current.rotation.x = 0.42 + pointer.current.pitch * 0.5
      outer.current.rotation.y = pointer.current.yaw * 0.6
    }
  })

  return (
    <group position={[1.2, 1.4, -15]}>
      <group ref={outer} rotation={[0.42, 0, 0.5]}>
        <group ref={inner}>
          <points geometry={geometry}>
            <pointsMaterial
              map={glow}
              size={0.16}
              sizeAttenuation
              vertexColors
              transparent
              opacity={0.85}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </points>
          <sprite scale={[7, 7, 1]} rotation={[0, 0, 0]}>
            <spriteMaterial map={coreGlow} transparent opacity={0.4} depthWrite={false} blending={THREE.AdditiveBlending} />
          </sprite>
        </group>
      </group>
    </group>
  )
}

const NEBULAE: { color: [number, number, number]; seed: number; pos: [number, number, number]; scale: number; opacity: number; speed: number }[] = [
  { color: [90, 100, 210], seed: 3, pos: [-7, 3.2, -16], scale: 18, opacity: 0.42, speed: 0.006 },
  { color: [118, 92, 170], seed: 8, pos: [6.5, 2.2, -18], scale: 20, opacity: 0.4, speed: -0.005 },
  { color: [70, 130, 230], seed: 14, pos: [0, -3.5, -17], scale: 22, opacity: 0.3, speed: 0.004 },
  { color: [200, 110, 80], seed: 21, pos: [9, -4, -20], scale: 14, opacity: 0.2, speed: -0.004 },
  { color: [130, 110, 220], seed: 27, pos: [-9.5, -3.2, -19], scale: 14, opacity: 0.28, speed: 0.005 },
]

function Nebulae({ reducedMotion }: { reducedMotion: boolean }) {
  const materials = useRef<(THREE.SpriteMaterial | null)[]>([])
  const textures = useMemo(
    () =>
      NEBULAE.map((n) => {
        const t = new THREE.CanvasTexture(createCloudTexture(n.color, n.seed, 256))
        t.colorSpace = THREE.SRGBColorSpace
        return t
      }),
    [],
  )
  useFrame((_, dt) => {
    if (reducedMotion) return
    materials.current.forEach((m, i) => {
      if (m) m.rotation += Math.min(dt, 0.05) * NEBULAE[i].speed
    })
  })
  return (
    <>
      {NEBULAE.map((n, i) => (
        <sprite key={i} position={n.pos} scale={[n.scale, n.scale, 1]}>
          <spriteMaterial
            ref={(m) => {
              materials.current[i] = m
            }}
            map={textures[i]}
            transparent
            opacity={n.opacity}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
      ))}
    </>
  )
}

function CameraRig({ pointer, reducedMotion }: { pointer: MutableRefObject<PointerState>; reducedMotion: boolean }) {
  const { camera } = useThree()
  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05)
    const tx = reducedMotion ? 0 : THREE.MathUtils.clamp(pointer.current.x, -1, 1) * 0.42
    const ty = reducedMotion ? 0 : THREE.MathUtils.clamp(-pointer.current.y, -1, 1) * 0.28
    camera.position.x = damp(camera.position.x, tx, 2.6, dt)
    camera.position.y = damp(camera.position.y, ty, 2.6, dt)
    camera.lookAt(0, 0, 0)
    if (!pointer.current.dragging) {
      pointer.current.yaw = damp(pointer.current.yaw, 0, 1.4, dt)
      pointer.current.pitch = damp(pointer.current.pitch, 0, 1.4, dt)
    }
  })
  return null
}

const MOON_CONFIG: PlanetProps['config'] = {
  rim: '#9CC6FF',
  halo: '#83B7FF',
  rimBase: 1.0,
  rimHover: 2.1,
  haloBase: 0.75,
  haloHover: 1.7,
  ring: '#8196C4',
  ringHover: '#B6D4FF',
  spin: 0.055,
  tilt: 0.05,
  bumpScale: 2.4,
  ringTilt: -0.32,
}
const MARS_CONFIG: PlanetProps['config'] = {
  rim: '#F0A27A',
  halo: '#E0764A',
  rimBase: 1.25,
  rimHover: 2.4,
  haloBase: 0.8,
  haloHover: 1.8,
  ring: '#B98C88',
  ringHover: '#F2A47F',
  spin: 0.065,
  tilt: 0.44,
  bumpScale: 1.6,
  ringTilt: 0.34,
}

function Scene({ layout, hovered, focused, revealed, reducedMotion, pointer }: SceneProps) {
  const size = useThree((s) => s.size)
  const upp = (2 * CAMERA_Z * Math.tan(THREE.MathUtils.degToRad(FOV / 2))) / size.height
  const reveal = useRef(0)
  const [moonTex, setMoonTex] = useState<PlanetTextures | null>(null)
  const [marsTex, setMarsTex] = useState<PlanetTextures | null>(null)

  useEffect(() => {
    let alive = true
    createMoonTextures().then((t) => alive && setMoonTex(t))
    createMarsTextures().then((t) => alive && setMarsTex(t))
    return () => {
      alive = false
    }
  }, [])

  useFrame((_, dt) => {
    reveal.current = Math.min(1, Math.max(0, reveal.current + (revealed ? dt / 2.4 : 0)))
  })

  const shared: SharedRefs = { reveal, upp }
  const focusFor = (id: PlanetId) => (focused === null ? 'none' : focused === id ? 'this' : 'other')

  return (
    <>
      <ambientLight intensity={0.22} color="#8196C4" />
      <directionalLight position={[-6, 4, 6]} intensity={3.1} color="#FFF3E2" />
      <directionalLight position={[7, -2, 3]} intensity={0.35} color="#83B7FF" />
      <CameraRig pointer={pointer} reducedMotion={reducedMotion} />
      <MilkyWay pointer={pointer} reducedMotion={reducedMotion} />
      <Nebulae reducedMotion={reducedMotion} />
      <BigOrbits upp={upp} width={size.width} reducedMotion={reducedMotion} />
      <Planet
        id="moon"
        slot={layout.moon}
        textures={moonTex}
        hovered={hovered === 'moon'}
        focus={focusFor('moon')}
        shared={shared}
        pointer={pointer}
        reducedMotion={reducedMotion}
        config={MOON_CONFIG}
      />
      <Planet
        id="mars"
        slot={layout.mars}
        textures={marsTex}
        hovered={hovered === 'mars'}
        focus={focusFor('mars')}
        shared={shared}
        pointer={pointer}
        reducedMotion={reducedMotion}
        config={MARS_CONFIG}
      />
    </>
  )
}

export default function SpaceScene(props: SceneProps & { active: boolean }) {
  const { active, ...sceneProps } = props
  return (
    <Canvas
      className="!absolute inset-0"
      camera={{ position: [0, 0, CAMERA_Z], fov: FOV, near: 0.1, far: 80 }}
      dpr={[1, 1.75]}
      flat
      frameloop={active ? 'always' : 'never'}
      gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
      aria-hidden
    >
      <Scene {...sceneProps} />
    </Canvas>
  )
}
