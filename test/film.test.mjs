// Mission film: frame-loop scheduling, pause/resume, cleanup and the narration
// hold. These run the same helpers the component uses, with fake frames instead
// of a browser, so the one-frame-stall regression cannot come back.

import assert from 'node:assert/strict'
import test from 'node:test'
import { clampSeek, createFrameLoop, holdForNarration, speechWatchdogMs } from '../lib/film-core.mjs'

function fakeFrames() {
  const queue = new Map()
  let next = 1
  return {
    requestFrame(callback) {
      const id = next
      next += 1
      queue.set(id, callback)
      return id
    },
    cancelFrame(id) {
      queue.delete(id)
    },
    /** Run every queued frame once, like one display refresh. */
    fire() {
      const pending = [...queue.values()]
      queue.clear()
      for (const callback of pending) callback(performance.now())
    },
    get pending() {
      return queue.size
    },
  }
}

function buildLoop(frames, onFrame) {
  return createFrameLoop({
    requestFrame: (callback) => frames.requestFrame(callback),
    cancelFrame: (id) => frames.cancelFrame(id),
    onFrame,
  })
}

test('a pending frame is never queued twice under repeated play calls', () => {
  const frames = fakeFrames()
  const loop = buildLoop(frames, () => undefined)

  assert.equal(loop.schedule(), true)
  assert.equal(loop.schedule(), false)
  assert.equal(loop.schedule(), false)
  assert.equal(frames.pending, 1)
})

test('the loop keeps running across many frames (no one-frame stall)', () => {
  const frames = fakeFrames()
  let rendered = 0
  const loop = buildLoop(frames, () => {
    rendered += 1
    loop.schedule()
  })

  loop.schedule()
  for (let i = 0; i < 5; i += 1) frames.fire()

  assert.equal(rendered, 5)
  assert.equal(frames.pending, 1, 'exactly one frame stays queued')
})

test('pausing stops scheduling new frames', () => {
  const frames = fakeFrames()
  let rendered = 0
  let playing = true
  const loop = buildLoop(frames, () => {
    rendered += 1
    if (playing) loop.schedule()
  })

  loop.schedule()
  frames.fire()
  assert.equal(rendered, 1)

  playing = false
  frames.fire()
  assert.equal(rendered, 2)
  assert.equal(frames.pending, 0, 'a paused film leaves no frame queued')
})

test('resuming restarts the loop from a paused film', () => {
  const frames = fakeFrames()
  let playing = false
  const loop = buildLoop(frames, () => {
    if (playing) loop.schedule()
  })

  assert.equal(frames.pending, 0)
  playing = true
  loop.schedule()
  frames.fire()
  assert.equal(frames.pending, 1)
})

test('seeking schedules a redraw without starting a second loop', () => {
  const frames = fakeFrames()
  const loop = buildLoop(frames, () => undefined)

  loop.schedule()
  loop.schedule() // a seek redraw while a frame is already pending
  loop.schedule()

  assert.equal(frames.pending, 1)
})

test('cleaning up cancels the queued frame', () => {
  const frames = fakeFrames()
  const loop = buildLoop(frames, () => undefined)

  loop.schedule()
  loop.cancel()

  assert.equal(frames.pending, 0)
  assert.equal(loop.scheduled, false)

  frames.fire()
  assert.equal(frames.pending, 0)
})

test('narration holds the shot only while it is still speaking', () => {
  const base = { speechBusy: true, voiceOn: true, isLast: false, msSinceSpeechStart: 2000, beatSeconds: 8 }

  assert.equal(holdForNarration(base), true)
  assert.equal(holdForNarration({ ...base, speechBusy: false }), false)
  assert.equal(holdForNarration({ ...base, voiceOn: false }), false)
  assert.equal(holdForNarration({ ...base, isLast: true }), false)
  assert.equal(holdForNarration({ ...base, msSinceSpeechStart: 60_000 }), false, 'the hold is bounded')
})

test('the narration watchdog is bounded and scales with the line', () => {
  const short = speechWatchdogMs('Contact.', 0.92)
  const long = speechWatchdogMs('word '.repeat(120), 0.92)

  assert.ok(short >= 6000, 'never so short that a normal line is cut off')
  assert.ok(long <= 30000, 'never so long that the film stalls')
  assert.ok(long > short)
})

test('seeking stays inside the film', () => {
  assert.equal(clampSeek(-5, 87), 0)
  assert.equal(clampSeek(1000, 87), 86.999)
  assert.equal(clampSeek(Number.NaN, 87), 0)
  assert.equal(clampSeek(30, 87), 30)
})
