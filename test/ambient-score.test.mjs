// Home background music: the contract a visitor experiences, checked against
// the shared constants and the component that implements them. Audibility
// itself needs a browser and ears (see scripts/browser-smoke.mjs).

import assert from 'node:assert/strict'
import fs from 'node:fs'
import test from 'node:test'
import {
  AUTOPLAY_FADE_SECONDS,
  DEFAULT_ENABLED,
  DEFAULT_VOLUME,
  MUTE_FADE_SECONDS,
  UNMUTE_FADE_SECONDS,
  clampVolume,
  isPlaybackRunning,
  isSilentVolume,
  targetGain,
} from '../lib/ambient-score-core.mjs'

const source = fs.readFileSync('components/space/ambient-score.tsx', 'utf8')

test('a fresh load is unmuted at 40%', () => {
  assert.equal(DEFAULT_ENABLED, true, 'the music defaults to unmuted')
  assert.equal(DEFAULT_VOLUME, 40)
  assert.equal(source.includes('useState(DEFAULT_VOLUME)'), true)
  assert.equal(source.includes('useRef(DEFAULT_VOLUME)'), true)
})

test('the mute fade sits inside the promised 700-1000 ms', () => {
  assert.ok(MUTE_FADE_SECONDS >= 0.7, 'at least 700 ms')
  assert.ok(MUTE_FADE_SECONDS <= 1, 'no longer than 1000 ms')
  assert.ok(UNMUTE_FADE_SECONDS > 0 && UNMUTE_FADE_SECONDS <= MUTE_FADE_SECONDS + 0.3)
  assert.ok(AUTOPLAY_FADE_SECONDS > 0.5, 'autoplay fades in rather than bursting')
})

test('gain is zero while muted and follows the slider while playing', () => {
  assert.equal(targetGain(100, false), 0)
  assert.equal(targetGain(40, false), 0)
  assert.equal(targetGain(40, true), 0.4)
  assert.equal(targetGain(100, true), 1)
})

test('a slider at zero is the muted state', () => {
  assert.equal(isSilentVolume(0), true)
  assert.equal(isSilentVolume(1), false)
  assert.equal(clampVolume(-10), 0)
  assert.equal(clampVolume(150), 100)
  assert.equal(clampVolume(Number.NaN), DEFAULT_VOLUME)
})

test('autoplay is judged by the context state, not by a resolved promise', () => {
  assert.equal(isPlaybackRunning('running'), true)
  assert.equal(isPlaybackRunning('suspended'), false)
  assert.equal(isPlaybackRunning(undefined), false)
})

test('the component attempts autoplay once on mount', () => {
  assert.ok(
    /useEffect\(\(\) => \{\s*mountedRef\.current = true\s*void begin\(AUTOPLAY_FADE_SECONDS\)/.test(source.replace(/\r\n/g, '\n')),
    'mount effect starts playback once',
  )
  assert.ok(!/setInterval\([^)]*begin/.test(source), 'no retry loop starts the music')
  assert.ok(!/setInterval\([^)]*resume/.test(source), 'no retry loop resumes the context')
})

test('a refused autoplay exposes one enabling control, not a fake playing state', () => {
  assert.ok(source.includes('Enable background music'), 'the control is announced to assistive tech')
  assert.ok(source.includes('Enable sound'), 'the control is visible')
  assert.ok(source.includes("phase('blocked')"), 'a refused resume is recorded as blocked')
})

test('mute fades before pausing and unmute starts from silence', () => {
  const normalised = source.replace(/\r\n/g, '\n')
  assert.ok(
    /fade\(0, MUTE_FADE_SECONDS\)[\s\S]{0,700}active\.state === 'running'[\s\S]{0,80}suspend\(\)/.test(normalised),
    'the context is suspended only after the mute fade',
  )
  assert.ok(
    /master\.gain\.setValueAtTime\(0, now\)[\s\S]{0,200}phase\('playing'\)/.test(normalised),
    'playback starts from zero gain',
  )
})

test('the player state is never persisted', () => {
  assert.ok(!source.includes('localStorage'), 'a previous mute cannot survive a reload')
  assert.ok(!source.includes('sessionStorage'))
  assert.ok(!source.includes('STORAGE_KEY'))
})

test('the slider is labelled, reaches 0-100 and is keyboard focusable', () => {
  assert.ok(source.includes('aria-label="Background music volume"'))
  assert.ok(source.includes('min={0}') && source.includes('max={100}'))
  assert.ok(source.includes('aria-valuetext={`${volume} percent`}'))
  assert.ok(source.includes('type="range"'))
  // The slider stays in the tab order even when the panel is visually closed.
  assert.ok(!/tabIndex=\{open \?/.test(source), 'the slider is not removed from the tab order')
})

test('the mute control reports its real state', () => {
  assert.ok(source.includes('aria-pressed={playing}'))
  assert.ok(source.includes(" 'Mute background music' : 'Unmute background music'"))
})

test('one AudioContext, built once, closed on unmount', () => {
  const creations = source.match(/new Ctor\(\)/g) ?? []
  assert.equal(creations.length, 1, 'a second AudioContext would double the score')
  assert.ok(
    /mountedRef\.current = false[\s\S]{0,40}teardown\(\)/.test(source.replace(/\r\n/g, '\n')),
    'unmount tears the graph down',
  )
  assert.ok(
    /const teardown = useCallback\(\(\) => \{[\s\S]{0,1400}ctx\.close\(\)/.test(source),
    'the context is closed, not just muted',
  )
})

test('hidden tabs do not keep playing, and never resume without prior intent', () => {
  const normalised = source.replace(/\r\n/g, '\n')
  assert.ok(normalised.includes("document.visibilityState === 'hidden'"))
  assert.ok(normalised.includes('resumeOnReturnRef.current = true'))
  assert.ok(
    /if \(!resumeOnReturnRef\.current\) return/.test(normalised),
    'the visibility handler cannot start music that was not playing',
  )
})

test('no passive pointer or scroll event can start the audio', () => {
  for (const event of ['pointermove', 'wheel', 'scroll', 'focus']) {
    assert.ok(
      !new RegExp(`addEventListener\\('${event}'`).test(source),
      `${event} must not be wired to the score`,
    )
  }
})
