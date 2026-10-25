/** Return optional setup guidance without preventing a no-model dev launch. */
export function modelPathWarning({ envExists, envText = '', processModelPath = '' }) {
  if (!envExists) return 'services/voice-api/.env is missing. Optional local settings and model-path overrides will use their defaults.'
  if (!/^MODEL_PATH=.+/m.test(envText) && !processModelPath) {
    return 'MODEL_PATH is not set. If no model is installed, Studio will offer first-run model onboarding.'
  }
  return null
}
