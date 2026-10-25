import assert from 'node:assert/strict'
import test from 'node:test'

import { modelPathWarning } from './model-path-preflight.mjs'

test('a missing local env file does not block first-run onboarding', () => {
  assert.match(modelPathWarning({ envExists: false }), /first-run model onboarding|defaults/)
})

test('an env file without MODEL_PATH gives onboarding guidance, not a startup error', () => {
  assert.match(modelPathWarning({ envExists: true, envText: 'HOMEGROWN_ADMIN_PASSWORD=secret' }), /onboarding/)
})

test('configured model paths need no onboarding warning', () => {
  assert.equal(modelPathWarning({ envExists: true, envText: 'MODEL_PATH=D:\\models' }), null)
  assert.equal(modelPathWarning({ envExists: true, processModelPath: 'D:\\models' }), null)
})
