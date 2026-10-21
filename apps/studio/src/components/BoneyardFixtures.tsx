import { Skeleton } from 'boneyard-js/react'

const snapshotConfig = {
  excludeTags: ['svg', 'canvas'],
  excludeSelectors: ['[data-boneyard-decorative]'],
}

function VoiceRowSkeleton({ selected = false }: { selected?: boolean }) {
  return (
    <div className={`voice-menu-pick -mx-2 flex min-h-9 items-center gap-1 border-b border-hairline px-2 last:border-b-0 ${selected ? 'voice-menu-pick-selected' : ''}`}>
      <span className="flex min-w-0 flex-1 items-center gap-2">
        <span className="size-3 shrink-0 rounded-sm bg-surface-raised" />
        <span className="h-3 w-[62%] rounded-full bg-surface-raised" />
      </span>
      <span className="ml-auto flex flex-none items-center gap-1">
        <span className="size-7 rounded-full bg-surface-raised" />
        <span className="size-7 rounded-full bg-surface-raised" />
        <span className="size-7 rounded-full bg-surface-raised" />
      </span>
    </div>
  )
}

function ClonedVoicesSkeleton() {
  return (
    <section className="cloned-voices-section results flex w-full flex-none flex-col wide:min-h-0 wide:flex-1" aria-hidden="true">
      <div className="voiceovers-card-header voiceover-history-header shrink-0">
        <div className="mt-1 flex gap-2">
          <div className="h-9 w-full rounded-sm border border-control bg-surface-raised" />
        </div>
      </div>
      <div className="history-context-toolbar cloned-voices-toolbar flex shrink-0 items-center gap-2 text-[11px]">
        <div className="h-2.5 w-24 rounded-full bg-surface-raised" />
        <div className="ml-auto h-2.5 w-16 rounded-full bg-surface-raised" />
      </div>
      <div className="result-list cloned-voices-list">
        <VoiceRowSkeleton selected />
        <VoiceRowSkeleton />
        <VoiceRowSkeleton />
        <VoiceRowSkeleton />
        <VoiceRowSkeleton />
      </div>
    </section>
  )
}

function VoiceoverRowSkeleton() {
  return (
    <li className="group/row -mx-2 flex cursor-default flex-col gap-0.5 overflow-hidden border-b border-hairline px-2 py-[7px] last:border-b-0" aria-hidden="true">
      <div className="flex min-h-[26px] min-w-0 items-center justify-between gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          <span className="size-3 shrink-0 rounded-sm bg-surface-raised" />
          <span className="h-3 w-24 max-w-[50%] rounded-full bg-surface-raised" />
        </div>
        <span className="ml-auto h-2.5 w-24 max-w-[34%] rounded-full bg-surface-raised" />
      </div>
      <div className="flex min-w-0 items-center gap-2.5">
        <span className="size-7 shrink-0 rounded-full bg-surface-raised" />
        <span className="flex h-7 min-w-0 flex-1 items-center gap-[2px] overflow-hidden">
          {Array.from({ length: 46 }, (_, index) => (
            <span
              key={index}
              className="w-[3px] shrink-0 rounded-full bg-audio-soft"
              style={{ height: `${6 + ((index * 17 + 11) % 16)}px` }}
            />
          ))}
        </span>
        <span className="h-2 w-10 shrink-0 rounded-full bg-surface-raised" />
        <span className="size-7 shrink-0 rounded-full bg-surface-raised" />
        <span className="size-7 shrink-0 rounded-full bg-surface-raised" />
      </div>
      <div className="flex min-h-7 min-w-0 items-center gap-3">
        <span className="h-2.5 min-w-0 flex-1 rounded-full bg-surface-raised" />
        <span className="h-2 w-12 shrink-0 rounded-full bg-surface-raised" />
      </div>
    </li>
  )
}

function VoiceoverRows() {
  return (
    <ul className="result-list" aria-hidden="true">
      <VoiceoverRowSkeleton />
      <VoiceoverRowSkeleton />
      <VoiceoverRowSkeleton />
    </ul>
  )
}

/** Stable shell geometry for Boneyard only; it is never mounted by Studio. */
export function StudioStartupFixture() {
  return (
    <div className="flex min-h-svh flex-col wide:h-svh wide:overflow-hidden">
      <header className="relative border-b border-hairline">
        <h1 className="px-(--gutter) py-[25px] text-center text-[clamp(1.7rem,5vw,2.2rem)] leading-none tracking-[0.18em] text-accent">HOMEGROWN</h1>
        <div className="absolute inset-y-0 right-(--gutter) z-150 flex items-center gap-1" data-boneyard-decorative>
          <span className="size-8 rounded-full bg-surface-raised" />
          <span className="size-8 rounded-full bg-surface-raised" />
        </div>
      </header>

      <main className="studio-workspace mx-auto grid w-full max-w-(--shell) grid-cols-[minmax(0,1fr)] items-start gap-[34px] px-(--gutter) pt-8 pb-[72px] wide:min-h-0 wide:flex-auto wide:gap-10 wide:pb-8">
        <div className="composer flex w-full min-w-0 flex-col gap-[22px] wide:h-full wide:min-h-0">
          <ClonedVoicesSkeleton />
        </div>

        <aside className="relative flex w-full min-w-0 flex-col gap-[22px] wide:h-full wide:min-h-0">
          <div className="script-editor grid h-[clamp(300px,39svh,400px)] min-h-[clamp(300px,39svh,400px)] max-h-[clamp(300px,39svh,400px)] grid-rows-[minmax(0,1fr)_auto] overflow-hidden rounded-md border border-hairline bg-surface-card" aria-hidden="true">
            <div className="script-editor-input relative p-[18px]">
              <div className="mt-1 h-3 w-[44%] rounded-full bg-surface-raised" />
              <span className="absolute right-[18px] bottom-3 h-2.5 w-12 rounded-full bg-surface-raised" />
            </div>
            <div className="script-editor-footer">
              <div className="h-8 w-[190px] max-w-[48%] rounded-sm border border-control bg-surface-raised" />
              <div className="script-editor-generate flex items-center gap-2">
                <div className="h-2.5 w-20 rounded-full bg-surface-raised" />
                <div className="h-8 w-[92px] rounded-sm bg-surface-raised" />
              </div>
            </div>
            <span className="script-editor-frame" aria-hidden="true" />
          </div>

          <section className="results flex w-full min-h-0 flex-1 flex-col" aria-hidden="true">
            <div className="voiceovers-card-header voiceover-history-header shrink-0">
              <div className="mt-1 flex gap-2">
                <div className="h-9 min-w-0 flex-1 rounded-sm border border-control bg-surface-raised" />
                <div className="size-9 shrink-0 rounded-sm border border-control bg-surface-raised" />
              </div>
            </div>
            <VoiceoverRows />
            <div className="voiceover-pager" data-boneyard-decorative>
              <div className="h-7 w-20 rounded-sm bg-surface-raised" />
              <div className="h-7 w-[220px] max-w-full rounded-sm bg-surface-raised" />
              <div className="h-2.5 w-16 justify-self-end rounded-full bg-surface-raised" />
            </div>
          </section>
        </aside>
      </main>
    </div>
  )
}

/** The history loader replaces only the row list; its live header remains visible. */
export function VoiceoverHistoryFixture() {
  return <VoiceoverRows />
}

/** The CLI sets __BONEYARD_BUILD before the app mounts, so no studio hooks or API calls run. */
export function BoneyardCaptureFixtures() {
  return (
    <div>
      <Skeleton name="studio-startup" loading={false} fixture={<StudioStartupFixture />} select="viewport" snapshotConfig={snapshotConfig}><StudioStartupFixture /></Skeleton>
      <div className="mx-auto w-full max-w-(--shell) px-(--gutter) pb-8">
        <Skeleton name="voiceover-history" loading={false} fixture={<VoiceoverHistoryFixture />} select="viewport" snapshotConfig={snapshotConfig}>
          <VoiceoverHistoryFixture />
        </Skeleton>
      </div>
    </div>
  )
}
