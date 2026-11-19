import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SESSION_COOKIE,
  readCookieValue,
  safeDecodeCookieValue,
  isValidSessionId,
  sessionFromCookieHeader,
} from '../lib/cookies.mjs'

const VALID = 'abcdef12-3456-4789-abcd-ef1234567890'

test('readCookieValue returns a present, decodable value', () => {
  assert.equal(readCookieValue('sr_sid=abc123; other=x', 'sr_sid'), 'abc123')
})

test('readCookieValue returns null for a missing cookie', () => {
  assert.equal(readCookieValue('other=x; foo=bar', 'sr_sid'), null)
  assert.equal(readCookieValue(null, 'sr_sid'), null)
  assert.equal(readCookieValue('', 'sr_sid'), null)
})

test('readCookieValue does not throw on malformed percent encoding', () => {
  assert.doesNotThrow(() => readCookieValue('sr_sid=%ZZ%ZZ', 'sr_sid'))
  assert.equal(readCookieValue('sr_sid=%ZZ%ZZ', 'sr_sid'), null)
  assert.equal(readCookieValue('sr_sid=%', 'sr_sid'), null)
})

test('readCookieValue handles a value containing an equals sign', () => {
  assert.equal(readCookieValue('sr_sid=a=b', 'sr_sid'), 'a=b')
})

test('readCookieValue decodes a percent-encoded value', () => {
  assert.equal(readCookieValue('sr_sid=hello%20world', 'sr_sid'), 'hello world')
})

test('readCookieValue ignores an oversized header', () => {
  const huge = 'sr_sid=x; ' + 'a='.padEnd(9000, 'b')
  assert.equal(readCookieValue(huge, 'sr_sid'), null)
})

test('safeDecodeCookieValue never throws', () => {
  assert.equal(safeDecodeCookieValue('%'), null)
  assert.equal(safeDecodeCookieValue('plain'), 'plain')
})

test('isValidSessionId accepts a canonical lowercase UUID', () => {
  assert.equal(isValidSessionId(VALID), true)
})

test('isValidSessionId rejects bad shapes', () => {
  assert.equal(isValidSessionId(''), false)
  assert.equal(isValidSessionId('not-a-uuid'), false)
  assert.equal(isValidSessionId(VALID.toUpperCase()), false)
  assert.equal(isValidSessionId(VALID + 'x'), false)
  assert.equal(isValidSessionId(123), false)
  assert.equal(isValidSessionId(null), false)
})

test('sessionFromCookieHeader returns the id for a valid cookie', () => {
  assert.equal(sessionFromCookieHeader(`${SESSION_COOKIE}=${VALID}`), VALID)
})

test('sessionFromCookieHeader returns null when the cookie is missing', () => {
  assert.equal(sessionFromCookieHeader('other=x'), null)
})

test('sessionFromCookieHeader returns null for an empty cookie value', () => {
  assert.equal(sessionFromCookieHeader(`${SESSION_COOKIE}=`), null)
})

test('sessionFromCookieHeader returns null for malformed percent encoding', () => {
  assert.equal(sessionFromCookieHeader(`${SESSION_COOKIE}=%ZZ`), null)
})

test('sessionFromCookieHeader returns null for an invalid UUID', () => {
  assert.equal(sessionFromCookieHeader(`${SESSION_COOKIE}=not-a-uuid`), null)
})

test('sessionFromCookieHeader returns null for an oversized cookie value', () => {
  const big = 'a'.repeat(200)
  assert.equal(sessionFromCookieHeader(`${SESSION_COOKIE}=${big}`), null)
})

test('sessionFromCookieHeader picks the session cookie among several', () => {
  assert.equal(sessionFromCookieHeader(`foo=bar; ${SESSION_COOKIE}=${VALID}; baz=qux`), VALID)
})

test('sessionFromCookieHeader rejects unexpected characters', () => {
  assert.equal(sessionFromCookieHeader(`${SESSION_COOKIE}=abc<script>`), null)
})
