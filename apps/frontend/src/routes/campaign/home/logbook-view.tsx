import { useSelector } from '@xstate/store/react'

import { getAircraftDisplayName } from '@/lib/aircraft-display'
import { emptyLogbook, logbookSide, medalName, MEDALS, rankFor } from '@/logic/systems/logbook'
import { activeStore } from '@/stores/active'

const OUTCOME_LABELS = {
  returned: 'Returned',
  ejected: 'Ejected',
  killed: 'Killed in action',
  lost: 'Aircraft lost'
}

function formatDate(value: Date) {
  return new Date(value).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC'
  })
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="tactical-inset rounded-md px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-secondary">{label}</div>
      <div className="text-lg tabular-nums text-synthwave-light">{value}</div>
    </div>
  )
}

/** The player's Falcon-style logbook: rank, score, kills, medals and the sortie record. */
export function LogbookView() {
  const book = useSelector(activeStore, (state) => state.context.logbook) ?? emptyLogbook()
  const playerSide = useSelector(activeStore, (state) => state.context.playerSide)
  const side = logbookSide({ playerSide })
  const rank = rankFor(book.points, side)
  const progress = rank.next ? Math.min(100, (book.points / rank.next.points) * 100) : 100

  return (
    <div className="flex max-h-[70vh] flex-col gap-4 overflow-y-auto pr-1">
      <div className="tactical-inset rounded-md p-3">
        <div className="flex items-baseline justify-between">
          <span className="retro-font text-sm uppercase text-primary">{rank.name}</span>
          <span className="text-xs tabular-nums text-secondary">{book.points} points</span>
        </div>
        <div className="mt-2 h-1.5 overflow-hidden rounded bg-black/40">
          <div className="h-full bg-synthwave-cyan" style={{ width: `${progress}%` }} />
        </div>
        <div className="mt-1 text-[10px] uppercase tracking-wide text-secondary">
          {rank.next
            ? `${rank.next.points - book.points} to ${rank.next.name}`
            : 'Highest rank reached'}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        <Stat label="Sorties" value={book.missions} />
        <Stat label="Air kills" value={book.kills.air} />
        <Stat label="Ground kills" value={book.kills.ground} />
        <Stat label="Structures" value={book.kills.static} />
        <Stat label="Ships" value={book.kills.naval} />
        <Stat label="Ejections" value={book.ejections} />
      </div>
      {book.kills.friendly > 0 || book.deaths > 0 ? (
        <div className="text-xs text-signal-soft">
          {book.kills.friendly > 0 ? `${book.kills.friendly} friendly kills` : null}
          {book.kills.friendly > 0 && book.deaths > 0 ? ' · ' : null}
          {book.deaths > 0 ? `${book.deaths} times killed in action` : null}
        </div>
      ) : null}

      <section>
        <div className="mb-1.5 text-[10px] uppercase tracking-wide text-secondary/70">Medals</div>
        {book.medals.length === 0 ? (
          <div className="text-xs text-secondary">
            None yet. Awards:{' '}
            {Object.keys(MEDALS)
              .map((id) => `${medalName(id, side)} (${MEDALS[id]!.reason})`)
              .join(' · ')}
          </div>
        ) : (
          <ul className="space-y-1">
            {book.medals.map((medal, index) => (
              <li
                key={`${medal.id}-${index}`}
                className="flex justify-between gap-2 rounded border border-amber-300/20 bg-amber-300/5 px-2 py-1 text-xs"
              >
                <span className="text-amber-200">{medalName(medal.id, side)}</span>
                <span className="text-secondary">
                  {medal.reason} · {formatDate(medal.at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <div className="mb-1.5 text-[10px] uppercase tracking-wide text-secondary/70">
          Sortie record
        </div>
        {book.sorties.length === 0 ? (
          <div className="text-xs text-secondary">
            Fly a mission and submit its debrief to start the record.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-left text-[10px] uppercase tracking-wide text-secondary">
              <tr>
                <th className="py-1 font-normal">Date</th>
                <th className="font-normal">Flight</th>
                <th className="font-normal">Aircraft</th>
                <th className="font-normal">Rating</th>
                <th className="font-normal">Kills A/G/S/N</th>
                <th className="font-normal">Outcome</th>
                <th className="text-right font-normal">Pts</th>
              </tr>
            </thead>
            <tbody>
              {[...book.sorties].reverse().map((sortie, index) => (
                <tr key={index} className="border-t border-synthwave-pink/10 text-secondary/90">
                  <td className="py-1 tabular-nums">{formatDate(sortie.at)}</td>
                  <td>
                    {sortie.callsign} · {sortie.task}
                  </td>
                  <td>{getAircraftDisplayName(sortie.aircraft)}</td>
                  <td className="text-synthwave-cyan">{'★'.repeat(sortie.rating)}</td>
                  <td className="tabular-nums">
                    {sortie.kills.air}/{sortie.kills.ground}/{sortie.kills.static}/
                    {sortie.kills.naval}
                  </td>
                  <td className={sortie.outcome === 'returned' ? '' : 'text-signal-soft'}>
                    {OUTCOME_LABELS[sortie.outcome]}
                  </td>
                  <td className="text-right tabular-nums">
                    {sortie.points >= 0 ? '+' : ''}
                    {sortie.points}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  )
}
