// Mission Film narration lifecycle.
//
// Runs the controller the player uses (lib/narration.mjs) against a fake speech
// engine and a manual clock, so the Edge-only failure modes are covered here:
// a line that is cancelled right after it was queued, a line the engine claims
// to be speaking but never starts, and duplicate narration from re-renders.

import assert from 'node:assert/strict'
import test from 'node:test'
import { createNarration, pickNarrationVoice } from '../lib/narration.mjs'

function clock() {
  let now = 0
  let nextId = 1
  const jobs = new Map()
  return {
    now: () => now,
    schedule(fn, ms) {
      const id = nextId
      nextId += 1
      jobs.set(id, { at: now + (ms ?? 0), fn })
      return id
    },
    cancel(id) {
      jobs.delete(id)
    },
    advance(ms) {
      const target = now + ms
      for (;;) {
        const due = [...jobs.entries()].filter(([, job]) => job.at <= target).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        jobs.delete(due[0])
        now = Math.max(now, due[1].at)
        due[1].fn()
      }
      now = target
    },
    get pending() {
      return jobs.size
    },
  }
}

function fakeEngine({ speaking = false } = {}) {
  const log = []
  const engine = {
    speaking,
    pending: false,
    cancels: 0,
    log,
    last: null,
    speak(utterance) {
      log.push('speak')
      engine.last = utterance
      engine.speaking = true
      engine.pending = false
    },
    cancel() {
      log.push('cancel')
      engine.cancels += 1
      engine.speaking = false
      engine.pending = false
    },
    getVoices() {
      return engine.voices ?? []
    },
    voices: [],
  }
  return engine
}

function utteranceFor(text) {
  return {
    text,
    voice: null,
    lang: '',
    rate: 0,
    pitch: 0,
    volume: 0,
    onstart: null,
    onend: null,
    onerror: null,
  }
}

function build(options = {}) {
  const timer = clock()
  const engine = fakeEngine(options)
  const statuses = []
  const controller = createNarration({
    synth: engine,
    makeUtterance: utteranceFor,
    schedule: (fn, ms) => timer.schedule(fn, ms),
    cancelTimer: (id) => timer.cancel(id),
    getVoices: () => engine.getVoices(),
    onStatus: (status) => statuses.push(status),
  })
  return { timer, engine, controller, statuses }
}

test('one line is queued once and never cancelled after it is spoken', () => {
  const { timer, engine, controller } = build()
  controller.speak('Meet Surveyor 1.')

  assert.equal(engine.log.length, 0, 'nothing is spoken before the start delay')
  timer.advance(120)

  assert.deepEqual(engine.log, ['speak'], 'an idle engine is never cancelled first')
  assert.equal(engine.cancels, 0)
  assert.equal(engine.last.volume, 1, 'narration is never muted')
  assert.equal(engine.last.text, 'Meet Surveyor 1.')
})

test('a re-render cannot duplicate or restart the current line', () => {
  const { timer, engine, controller } = build()
  controller.speak('Chapter one.')
  timer.advance(120)
  const first = engine.last

  controller.speak('Chapter one.')
  controller.speak('Chapter one.')
  timer.advance(200)

  assert.equal(engine.log.filter((entry) => entry === 'speak').length, 1, 'one utterance only')
  assert.equal(engine.last, first, 'the same utterance object is still the one playing')
  assert.equal(engine.cancels, 0)
})

test('a new chapter cancels the old line before queueing the new one', () => {
  const { timer, engine, controller } = build()
  controller.speak('Chapter one.')
  timer.advance(120)
  engine.last.onstart?.()

  controller.speak('Chapter two.')
  timer.advance(120)

  assert.deepEqual(engine.log, ['speak', 'cancel', 'speak'], 'cancel comes before the new speak')
  assert.equal(engine.last.text, 'Chapter two.')
})

test('status follows the real engine events', () => {
  const { timer, engine, controller, statuses } = build()
  controller.speak('Contact.')
  timer.advance(120)
  assert.equal(controller.status, 'queued')

  engine.last.onstart?.()
  assert.equal(controller.status, 'speaking')
  assert.equal(controller.isBusy(), true)

  engine.last.onend?.()
  assert.equal(controller.status, 'idle')
  assert.equal(controller.isBusy(), false)
  assert.deepEqual(statuses, ['queued', 'speaking', 'idle'])
})

test('a line the engine never starts is reported instead of faking playback', () => {
  const { timer, engine, controller, statuses } = build()
  controller.speak('This line never becomes audible.')
  timer.advance(120)

  // Edge keeps `speaking === true` for a wedged utterance; onstart never fires.
  assert.equal(engine.speaking, true)
  timer.advance(1800)

  assert.equal(controller.status, 'failed')
  assert.equal(statuses.includes('failed'), true)
  assert.equal(engine.cancels, 1, 'the wedged line is cleared once')
  assert.equal(controller.isBusy(), false)
})

test('an interrupted line is not treated as a failure', () => {
  const { timer, engine, controller } = build()
  controller.speak('Chapter one.')
  timer.advance(120)
  engine.last.onerror?.({ error: 'interrupted' })
  assert.equal(controller.status, 'queued', 'our own cancel is not an error')
})

test('stop() cancels at most once and only while something is in flight', () => {
  const idle = build()
  idle.controller.stop()
  assert.equal(idle.engine.cancels, 0, 'an idle engine is left alone')

  const busy = build()
  busy.controller.speak('Chapter one.')
  busy.timer.advance(120)
  busy.engine.last.onstart?.()
  busy.controller.stop()
  busy.controller.stop()
  assert.equal(busy.engine.cancels, 1, 'repeated stop() does not cancel twice')
  assert.equal(busy.controller.status, 'idle')
})

test('voices that arrive late are used without re-speaking the line', () => {
  const { timer, engine, controller } = build()
  controller.speak('Meet Luna 9.')

  // Chromium and Edge fill their list asynchronously: it is empty here.
  engine.voices = [
    { name: 'Microsoft Ryan Online (Natural) - English (United Kingdom)', lang: 'en-GB', localService: false },
    { name: 'Microsoft David - English (United States)', lang: 'en-US', localService: true },
  ]
  timer.advance(120)

  assert.equal(engine.last.voice?.name, 'Microsoft David - English (United States)')
  assert.equal(engine.last.lang, 'en-US', 'the utterance follows the voice that exists')
  assert.equal(engine.log.filter((entry) => entry === 'speak').length, 1)
})

test('retry re-speaks the last line after a failure', () => {
  const { timer, engine, controller } = build()
  controller.speak('Contact.')
  timer.advance(120)
  timer.advance(1800)
  assert.equal(controller.status, 'failed')

  controller.retry()
  timer.advance(120)

  assert.equal(controller.status, 'queued')
  assert.equal(engine.log.filter((entry) => entry === 'speak').length, 2)
  assert.equal(engine.last.text, 'Contact.')
})

test('dispose stops the engine and refuses further narration', () => {
  const { timer, engine, controller } = build()
  controller.speak('Chapter one.')
  timer.advance(120)
  controller.dispose()
  assert.equal(engine.cancels, 1)

  controller.speak('Chapter two.')
  timer.advance(200)
  assert.equal(engine.log.filter((entry) => entry === 'speak').length, 1)
})

test('a local British voice wins over a remote one', () => {
  const voice = pickNarrationVoice([
    { name: 'Microsoft Sonia Online (Natural) - English (United Kingdom)', lang: 'en-GB', localService: false },
    { name: 'Microsoft Hazel Desktop - English (United Kingdom)', lang: 'en-GB', localService: true },
    { name: 'Microsoft David - English (United States)', lang: 'en-US', localService: true },
  ])
  assert.equal(voice?.name, 'Microsoft Hazel Desktop - English (United Kingdom)')

  assert.equal(pickNarrationVoice([]), null)
})
