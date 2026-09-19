import { AlertIcon } from './Icons'

/** The persistent "something is wrong" marker, in the manner of the Next.js dev
 * overlay indicator: a small fixed badge in the corner that never goes away
 * while the condition holds, and reopens the full explanation when clicked.
 *
 * It exists because the backend-unreachable dialog is dismissible. Dismissing
 * used to be the end of it, which left anyone who closed the dialog -- or
 * anyone else at the same machine afterwards -- looking at an app whose buttons
 * do nothing, with no way back to the reason.
 *
 * `fixed`, and that is a requirement rather than a convenience. The thing this
 * replaces was an in-flow banner above the script box, so it appeared and
 * disappeared by pushing the whole composer down. Nothing here participates in
 * layout, so the page does not move when the backend drops or comes back.
 *
 * z-150 puts it above the page and the bulk bar (100) but below the modal it
 * opens (200), so it never paints over its own dialog. */
export default function OfflineBadge({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="fixed right-4 bottom-4 z-150 flex items-center gap-2 rounded-full border border-danger bg-surface-card py-2 pr-3.5 pl-3 text-[12px] font-medium text-danger-text shadow-(--shadow-menu)"
      // The visible text is "Offline"; the accessible name says what the badge
      // is FOR, since a screen-reader user arriving at it out of context gets
      // no help from one word.
      aria-label="Homegrown cannot reach its backend. Open the details."
      title="Homegrown cannot reach its backend"
    >
      <span className="flex size-4 flex-none items-center justify-center text-danger">
        <AlertIcon size={15} />
      </span>
      Offline
    </button>
  )
}
