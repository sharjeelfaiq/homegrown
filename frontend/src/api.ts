export interface HealthResponse {
  model_loaded: boolean
  sample_rate: number | null
}

export interface LanguagesResponse {
  languages: string[]
}

export interface Preset {
  id: string
  name: string
  language: string
  ref_text: string
  audio_path: string
  tag: string
  is_builtin: boolean
  preview_url: string
  created_at: number
}

export interface HistoryEntry {
  id: string
  preset_id: string
  preset_name: string
  text: string
  language: string
  style: string
  stability: string
  audio_url: string
  duration_s: number
  generation_s: number | null
  estimated_s: number | null
  created_at: number
}

export interface GenerateJobStart {
  job_id: string
  total_chunks: number
  estimated_s: number
  queue_position: number
}

export type JobStatusValue = 'queued' | 'running' | 'canceling' | 'done' | 'error' | 'canceled'

export interface JobStatus {
  status: JobStatusValue
  chunks_done: number
  total_chunks: number
  audio_url: string | null
  sample_rate: number | null
  error: string | null
  estimated_s: number | null
  elapsed_s: number | null
  eta_s: number | null
  queue_position: number | null
}

export interface QueueEntry {
  job_id: string
  preset_name: string
  text_preview: string
  status: JobStatusValue
  chunks_done: number
  total_chunks: number
  estimated_s: number | null
  elapsed_s: number | null
  eta_s: number | null
  queue_position: number | null
  submitted_at: number
  audio_url: string | null
  error: string | null
}

export interface ApiErrorBody {
  detail: string
}

export class ApiError extends Error {}

// Frontend and backend are separate origins now (Vercel + RunPod pod proxy
// domain) -- every call below goes through apiUrl()/mediaUrl() instead of a
// same-origin relative path. Empty string falls back to relative paths,
// which only works if you're proxying /api yourself (e.g. local dev without
// VITE_BACKEND_URL set, hitting a backend on the same host).
const BACKEND_URL = import.meta.env.VITE_BACKEND_URL ?? ''

function apiUrl(path: string): string {
  return `${BACKEND_URL}${path}`
}

/** Resolves a relative media path (audio_url, preview_url) returned by the
 * backend against BACKEND_URL, for use directly as an <audio>/<img> src. */
export function mediaUrl(path: string): string {
  return path.startsWith('http') ? path : `${BACKEND_URL}${path}`
}

async function parseOrThrow<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = (await res.json()) as ApiErrorBody
      if (body.detail) detail = body.detail
    } catch {
      // ignore -- fall back to statusText
    }
    throw new ApiError(detail)
  }
  return res.json() as Promise<T>
}

// No external auth service -- the backend treats every request as the same
// local user, so this is just a plain fetch kept as a named wrapper to avoid
// touching every call site below.
async function authFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  return fetch(url, opts)
}

export function getHealth(): Promise<HealthResponse> {
  return fetch(apiUrl('/api/health')).then(parseOrThrow<HealthResponse>)
}

export function getLanguages(): Promise<LanguagesResponse> {
  return fetch(apiUrl('/api/languages')).then(parseOrThrow<LanguagesResponse>)
}

export function listPresets(): Promise<{ presets: Preset[] }> {
  return authFetch(apiUrl('/api/presets')).then(parseOrThrow<{ presets: Preset[] }>)
}

export function createPreset(
  name: string,
  audio: File,
  refText: string,
  language: string,
  tag: string = '',
): Promise<Preset> {
  const form = new FormData()
  form.append('audio', audio)
  form.append('name', name)
  form.append('ref_text', refText)
  form.append('language', language)
  form.append('tag', tag)
  return authFetch(apiUrl('/api/presets'), { method: 'POST', body: form }).then(parseOrThrow<Preset>)
}

export function deletePreset(presetId: string): Promise<{ ok: boolean }> {
  return authFetch(apiUrl(`/api/presets/${presetId}`), { method: 'DELETE' }).then(
    parseOrThrow<{ ok: boolean }>,
  )
}

export function listHistory(): Promise<{ history: HistoryEntry[] }> {
  return authFetch(apiUrl('/api/history')).then(parseOrThrow<{ history: HistoryEntry[] }>)
}

export function deleteHistoryEntry(entryId: string): Promise<{ ok: boolean }> {
  return authFetch(apiUrl(`/api/history/${entryId}`), { method: 'DELETE' }).then(
    parseOrThrow<{ ok: boolean }>,
  )
}

export interface GenerateParams {
  presetId: string
  text: string
  language: string
}

export function startGenerate(params: GenerateParams): Promise<GenerateJobStart> {
  return authFetch(apiUrl('/api/generate'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      preset_id: params.presetId,
      text: params.text,
      language: params.language,
    }),
  }).then(parseOrThrow<GenerateJobStart>)
}

export function getJobStatus(jobId: string): Promise<JobStatus> {
  return authFetch(apiUrl(`/api/jobs/${jobId}`)).then(parseOrThrow<JobStatus>)
}

export function getEstimate(chars: number): Promise<{ estimated_s: number }> {
  return fetch(apiUrl(`/api/estimate?chars=${chars}`)).then(parseOrThrow<{ estimated_s: number }>)
}

/** Downloads always come back as a renamed .mp3 (converted server-side from
 * the stored .wav, or served as-is if already .mp3) -- playback elsewhere in
 * the app still uses the raw audio_url directly (via mediaUrl()). */
export function downloadUrl(audioUrl: string, name: string): string {
  const filename = audioUrl.split('/').pop() ?? ''
  return apiUrl(`/api/download/${filename}?name=${encodeURIComponent(name)}`)
}

export function listQueue(): Promise<{ queue: QueueEntry[] }> {
  return authFetch(apiUrl('/api/queue')).then(parseOrThrow<{ queue: QueueEntry[] }>)
}

export function cancelQueuedJob(jobId: string): Promise<{ ok: boolean }> {
  return authFetch(apiUrl(`/api/queue/${jobId}/cancel`), { method: 'POST' }).then(
    parseOrThrow<{ ok: boolean }>,
  )
}

export function deleteQueueJob(jobId: string): Promise<{ ok: boolean }> {
  return authFetch(apiUrl(`/api/queue/${jobId}`), { method: 'DELETE' }).then(
    parseOrThrow<{ ok: boolean }>,
  )
}

export function reorderQueue(jobIds: string[]): Promise<{ ok: boolean }> {
  return authFetch(apiUrl('/api/queue/reorder'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_ids: jobIds }),
  }).then(parseOrThrow<{ ok: boolean }>)
}
