/** Shared Web Audio plumbing for the whole studio.
 *
 * One AudioContext, one AnalyserNode. Every media element is wired
 * source -> analyser -> destination permanently at creation:
 * createMediaElementSource can only be called once per element (WeakMap
 * cache), and once an element is routed through the graph it goes silent
 * unless the chain stays connected to the destination — connecting
 * everything once and never disconnecting makes that invariant
 * unbreakable. AudioActivityContext guarantees only one element plays at
 * a time, so the analyser always reflects what is audible.
 */
class AudioEngine {
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private sources = new WeakMap<HTMLAudioElement, MediaElementAudioSourceNode>()
  private freqData: Uint8Array<ArrayBuffer> | null = null
  private lastFreqReadAt = -1
  private level = 0

  private ensureContext(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext()
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 128
      this.analyser.smoothingTimeConstant = 0.75
      this.analyser.connect(this.ctx.destination)
      this.freqData = new Uint8Array(this.analyser.frequencyBinCount)
    }
    return this.ctx
  }

  /** Route an element through the analyser. Safe to call repeatedly. */
  attach(el: HTMLAudioElement): void {
    const ctx = this.ensureContext()
    if (ctx.state === 'suspended') {
      ctx.resume().catch(() => {})
    }
    if (!this.sources.has(el)) {
      const source = ctx.createMediaElementSource(el)
      source.connect(this.analyser!)
      this.sources.set(el, source)
    }
  }

  /** Current frequency bins, memoized so multiple consumers in the same
   * frame share one analyser read. Null until the first attach. */
  getFrequencyData(): Uint8Array<ArrayBuffer> | null {
    if (!this.analyser || !this.freqData) return null
    const now = performance.now()
    if (now - this.lastFreqReadAt > 8) {
      this.analyser.getByteFrequencyData(this.freqData)
      this.lastFreqReadAt = now
    }
    return this.freqData
  }

  /** Overall 0..1 loudness with fast attack / slow decay smoothing. */
  getLevel(): number {
    const data = this.getFrequencyData()
    if (!data) return 0
    let sum = 0
    for (let i = 0; i < data.length; i++) sum += data[i]
    const raw = sum / (data.length * 255)
    const rate = raw > this.level ? 0.5 : 0.06
    this.level += (raw - this.level) * rate
    return this.level
  }

  /** Decode on the shared context (works while suspended). */
  decode(buf: ArrayBuffer): Promise<AudioBuffer> {
    return this.ensureContext().decodeAudioData(buf)
  }
}

export const audioEngine = new AudioEngine()
