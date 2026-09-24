import { Skeleton } from 'boneyard-js/react'

const snapshotConfig = {
  excludeTags: ['svg', 'canvas'],
  excludeSelectors: ['[data-boneyard-decorative]'],
}

function RuleHeading({ children }: { children: string }) {
  return <h2 className="section-rule"><span>{children}</span></h2>
}

function HistoryRows() {
  return (
    <ul className="result-list rounded-sm border border-hairline bg-surface-card">
      {['Morning briefing', 'Product update', 'Welcome message'].map((name, index) => (
        <li key={name} className="border-b border-hairline px-3 py-3 last:border-b-0">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="m-0 truncate text-[13px] text-ink">{name}</p>
              <p className="m-0 mt-1 text-[11px] text-muted">Narrator · {index + 1}:2{index}</p>
            </div>
            <button className="icon-btn" type="button" aria-label={`Play ${name}`} data-boneyard-decorative>▶</button>
          </div>
          <div className="mt-3 h-1.5 rounded-full bg-surface-raised" />
        </li>
      ))}
    </ul>
  )
}

/** Static content for the CLI only. It is never mounted by the application. */
export function StudioStartupFixture() {
  return (
    <div className="flex min-h-svh flex-col wide:h-svh wide:overflow-hidden">
      <div className="relative border-b border-hairline">
        <h1 className="px-(--gutter) py-[25px] text-center text-[28px] leading-none tracking-[0.18em] text-accent">HOMEGROWN</h1>
        <div className="absolute inset-y-0 right-(--gutter) flex items-center gap-2" data-boneyard-decorative>
          <button className="icon-btn" type="button">◐</button><button className="icon-btn" type="button">?</button>
        </div>
      </div>
      <main className="mx-auto grid w-full max-w-(--shell) grid-cols-[minmax(0,1fr)] items-start gap-[34px] px-(--gutter) pt-8 pb-[72px] wide:min-h-0 wide:flex-auto wide:grid-cols-[minmax(0,1.15fr)_minmax(0,var(--aside))] wide:gap-10 wide:pb-8">
        <section className="flex min-w-0 flex-col gap-[22px]">
          <RuleHeading>Script</RuleHeading>
          <div className="flex justify-end gap-2"><button className="h-8 rounded-sm border border-control bg-control-fill px-3 text-[12px] text-muted" type="button">Narrator</button><button className="icon-btn size-8 border border-control" type="button" data-boneyard-decorative>+</button></div>
          <div className="min-h-[230px] rounded-sm border border-hairline bg-surface-card p-4"><p className="m-0 text-[14px] leading-7 text-muted">Welcome to Homegrown. This is a short script prepared for a clear, natural voiceover.</p><p className="m-0 mt-4 text-[14px] leading-7 text-muted">The composer stays ready while the voice model warms up.</p></div>
          <div className="flex items-center gap-2"><button className="rounded-sm bg-invert-bg px-4 py-2.5 text-[13px] text-invert-fg" type="button">Generate voiceover</button></div>
        </section>
        <aside className="min-w-0"><RuleHeading>Voiceovers</RuleHeading><div className="mt-3 flex gap-2"><div className="h-10 flex-1 rounded-sm border border-control bg-surface-raised" /><div className="h-10 w-10 rounded-sm border border-control bg-surface-raised" data-boneyard-decorative /></div><div className="history-context-toolbar mt-1">All voiceovers · 3</div><HistoryRows /></aside>
      </main>
    </div>
  )
}

export function VoiceoverHistoryFixture() { return <HistoryRows /> }

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
