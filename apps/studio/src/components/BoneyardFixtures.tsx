import { Skeleton } from 'boneyard-js/react'

const snapshotConfig = {
  excludeTags: ['svg', 'canvas'],
  excludeSelectors: ['[data-boneyard-decorative]'],
}

function RuleHeading({ children, trailing }: { children: string, trailing?: string }) {
  return <h2 className="section-rule"><span>{children}</span>{trailing && <span className="order-3 mono text-[11px] text-faint">{trailing}</span>}</h2>
}

function VoiceoverRows() {
  return (
    <div className="result-list flex min-h-0 flex-1 flex-col overflow-hidden rounded-sm border border-hairline bg-surface-card">
      {[0, 1, 2].map((row) => (
        <div key={row} className="border-b border-hairline px-3 py-3 last:border-b-0">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <div className="h-3 w-[58%] rounded-full bg-surface-raised" />
              <div className="h-2.5 w-[38%] rounded-full bg-surface-raised" />
            </div>
            <div className="size-7 shrink-0 rounded-full bg-surface-raised" />
          </div>
          <div className="mt-3 h-1.5 rounded-full bg-surface-raised" />
        </div>
      ))}
    </div>
  )
}

/** Stable shell geometry for Boneyard only; it is never mounted by Studio. */
export function StudioStartupFixture() {
  return (
    <div className="flex min-h-svh flex-col wide:h-svh wide:overflow-hidden">
      <header className="relative border-b border-hairline">
        <h1 className="px-(--gutter) py-[25px] text-center text-[clamp(1.7rem,5vw,2.2rem)] leading-none tracking-[0.18em] text-accent">HOMEGROWN</h1>
        <div className="absolute inset-y-0 right-(--gutter) flex items-center gap-1" data-boneyard-decorative>
          <span className="size-8 rounded-full" /><span className="size-8 rounded-full" />
        </div>
      </header>

      <main className="mx-auto grid w-full max-w-(--shell) grid-cols-[minmax(0,1fr)] items-start gap-[34px] px-(--gutter) pt-8 pb-[72px] wide:min-h-0 wide:flex-auto wide:grid-cols-[minmax(0,1.15fr)_minmax(0,var(--aside))] wide:gap-10 wide:pb-8">
        <section className="flex min-w-0 flex-col gap-[22px] wide:min-h-0">
          <RuleHeading trailing="/">Script</RuleHeading>
          <div className="script-editor grid h-[clamp(272px,36svh,372px)] min-h-[clamp(272px,36svh,372px)] grid-rows-[minmax(0,1fr)_auto] rounded-md border border-hairline bg-surface-card">
            <div className="p-[18px] space-y-3"><div className="h-3 w-[82%] rounded-full bg-surface-raised" /><div className="h-3 w-[64%] rounded-full bg-surface-raised" /></div>
            <div className="script-editor-footer">
              <div className="h-2.5 w-14 rounded-full bg-surface-raised" />
              <div className="script-voice-setting"><span className="h-2.5 w-9 rounded-full bg-surface-raised" /><span className="h-8 w-28 rounded-sm bg-surface-raised" /><span className="size-8 rounded-sm bg-surface-raised" /></div>
            </div>
          </div>
          <div className="generate-action-grid grid w-full grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start">
            <div /><div className="relative flex flex-col items-center"><div className="h-10 w-36 rounded-sm bg-invert-bg" /><div className="generate-action-auxiliary mt-1 h-4 w-24 wide:absolute wide:left-full wide:top-1/2 wide:mt-0 wide:ml-3 wide:-translate-y-1/2" /></div><div />
          </div>
        </section>

        <aside className="flex min-w-0 flex-col wide:h-full wide:min-h-0">
          <RuleHeading trailing="0">Voiceovers</RuleHeading>
          <section className="results flex min-h-0 flex-1 flex-col">
            <div className="voiceovers-card-header shrink-0"><div className="mt-2 flex gap-2"><div className="h-10 flex-1 rounded-sm border border-control bg-surface-raised" /><div className="h-10 w-10 rounded-sm border border-control bg-surface-raised" /></div></div>
            <div className="history-context-toolbar flex shrink-0 items-center"><div className="h-2.5 w-24 rounded-full bg-surface-raised" /></div>
            <VoiceoverRows />
          </section>
        </aside>
      </main>
    </div>
  )
}

export function VoiceoverHistoryFixture() {
  return <div className="flex min-h-[360px] flex-col"><VoiceoverRows /></div>
}

/** The CLI sets __BONEYARD_BUILD before the app mounts, so no studio hooks or API calls run. */
export function BoneyardCaptureFixtures() {
  return (
    <div>
      <Skeleton name="studio-startup" loading={false} fixture={<StudioStartupFixture />} select="viewport" snapshotConfig={snapshotConfig}><StudioStartupFixture /></Skeleton>
      <div className="mx-auto w-full max-w-(--shell) px-(--gutter) pb-8">
        <Skeleton name="voiceover-history" loading={false} fixture={<VoiceoverHistoryFixture />} select="viewport" snapshotConfig={snapshotConfig}><VoiceoverHistoryFixture /></Skeleton>
      </div>
    </div>
  )
}
