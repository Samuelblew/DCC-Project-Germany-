import { useState } from 'react'
import { useSelector } from '@xstate/store/react'
import {
  careerPilotHire,
  getCareerAircraft,
  scenarios,
  theatres,
  type CareerPilotSkill
} from '@dcc/data'
import {
  BadgeDollarSign,
  Coins,
  Package,
  Plane,
  ScrollText,
  ShieldAlert,
  ShoppingCart,
  TriangleAlert,
  Users,
  Wrench
} from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog'
import { AIRCRAFT_ROLE_LABELS } from '@/lib/aircraft-display'
import { cn } from '@/lib/utils'
import {
  getPurchasableAircraft,
  getRepairCost,
  getResaleValue,
  getStock,
  isFlownByEnemy,
  pickRearAirfield
} from '@/logic/career/career'
import { activeStore } from '@/stores/active'

type Tab = 'hangar' | 'buy' | 'pilots' | 'armory' | 'ledger'

const SKILLS: CareerPilotSkill[] = ['Average', 'Good', 'High', 'Excellent']

const RULE_HINTS = {
  fidelity: "Only your coalition's aircraft can be bought",
  arcade: 'Any aircraft can be bought, whatever its side'
}

function formatMoney(value: number) {
  return `${Math.round(value)} cr`
}

function TypeChips({
  types,
  selected,
  onSelect,
  allLabel
}: {
  types: string[]
  selected: string | null
  onSelect: (type: string | null) => void
  allLabel?: string
}) {
  const options: Array<string | null> = allLabel ? [null, ...types] : types
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((type) => (
        <button
          key={type ?? 'all'}
          type="button"
          onClick={() => onSelect(type)}
          className={cn(
            'rounded border px-2 py-0.5 text-xs transition-colors',
            selected === type
              ? 'border-synthwave-cyan/60 bg-synthwave-cyan/15 text-synthwave-cyan'
              : 'border-white/15 text-white/60 hover:bg-white/5 hover:text-white'
          )}
        >
          {type == null ? allLabel : (getCareerAircraft(type)?.shortName ?? type)}
        </button>
      ))}
    </div>
  )
}

export function CareerDialog({
  open,
  onOpenChange
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const campaign = useSelector(activeStore, (state) => state.context)
  const career = campaign.career
  const campaignTime = campaign.time
  const [tab, setTab] = useState<Tab>('hangar')
  const [fleetType, setFleetType] = useState<string | null>(null)
  const [armoryType, setArmoryType] = useState<string | null>(null)
  const aircraft = career ? getCareerAircraft(career.preferredAircraft) : undefined

  if (!career || !aircraft) return null

  const theatre = theatres.find(
    (entry) => entry.name === scenarios.find((s) => s.id === campaign.scenarioId)?.theatreName
  )
  const rearAirfield = open && theatre ? pickRearAirfield(campaign, theatre) : undefined
  const purchasable = getPurchasableAircraft(campaign)
  const hoursUntil = (time: Date | undefined) =>
    time
      ? Math.max(
          0,
          (new Date(time).getTime() - new Date(campaignTime).getTime()) / 3_600_000
        ).toFixed(1)
      : '?'

  const activeAirframes = career.airframes.filter((airframe) => airframe.status !== 'destroyed')
  const ownedTypes = [
    ...new Set<string>([career.preferredAircraft, ...activeAirframes.map((a) => a.aircraftName)])
  ]
  const shownAirframes = activeAirframes.filter(
    (airframe) => fleetType == null || airframe.aircraftName === fleetType
  )
  const armoryAircraft =
    getCareerAircraft(
      armoryType && ownedTypes.includes(armoryType) ? armoryType : aircraft.aircraftName
    ) ?? aircraft
  const lostAirframes = career.airframes.filter((airframe) => airframe.status === 'destroyed')
  const livePilots = career.pilots.filter((pilot) => pilot.status !== 'dead')
  const hoursToReplacement = career.replacementAvailableAt
    ? Math.max(
        0,
        (new Date(career.replacementAvailableAt).getTime() - new Date(campaignTime).getTime()) /
          3_600_000
      )
    : undefined

  const tabs: Array<{ id: Tab; label: string; icon: typeof Plane }> = [
    { id: 'hangar', label: 'Hangar', icon: Plane },
    { id: 'buy', label: 'Buy', icon: ShoppingCart },
    { id: 'pilots', label: 'Wingmen', icon: Users },
    { id: 'armory', label: 'Armory', icon: Package },
    { id: 'ledger', label: 'Ledger', icon: ScrollText }
  ]

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[min(90vh,760px)] flex-col overflow-hidden overflow-y-hidden border-synthwave-pink/30 bg-synthwave-dark/95 text-synthwave-light backdrop-blur-xl sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle className="retro-font flex items-center gap-3 text-synthwave-cyan">
            Career
            <span
              className="rounded border border-synthwave-cyan/40 px-2 py-0.5 text-[0.65rem] uppercase tracking-wider"
              title={RULE_HINTS[career.acquisitionRule]}
            >
              {career.acquisitionRule}
            </span>
            <span className="ml-auto flex items-center gap-1.5 text-lg text-synthwave-cyan">
              <Coins className="h-4 w-4" />
              {formatMoney(career.money)}
            </span>
          </DialogTitle>
          <DialogDescription className="text-secondary/70">
            Money comes from kills, completed tasks and safe returns. Aircraft only change base when
            you land them somewhere else.
          </DialogDescription>
        </DialogHeader>

        {hoursToReplacement != null ? (
          <div className="flex items-center gap-2 rounded border border-synthwave-pink/40 bg-synthwave-pink/10 px-3 py-2 text-sm">
            <ShieldAlert className="h-4 w-4 text-synthwave-pink" />
            Grounded and out of money. Command assigns you a used aircraft in{' '}
            {hoursToReplacement.toFixed(1)} campaign hours.
          </div>
        ) : null}

        {career.sortie ? (
          <div className="flex items-center gap-3 rounded border border-synthwave-cyan/40 bg-synthwave-cyan/10 px-3 py-2 text-sm">
            Sortie {career.sortie.callsign} is crewed and armed at {career.sortie.homeBase}.
            <Button
              size="sm"
              variant="outline"
              className="ml-auto h-7"
              onClick={() => activeStore.send({ type: 'careerAbortSortie' })}
            >
              Stand down
            </Button>
          </div>
        ) : null}

        <div className="flex shrink-0 gap-1.5">
          {tabs.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={cn(
                'flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] transition-colors',
                tab === id
                  ? 'bg-synthwave-cyan/15 text-synthwave-cyan ring-1 ring-synthwave-cyan/35'
                  : 'text-white/50 hover:bg-white/5 hover:text-white/80'
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </button>
          ))}
        </div>

        <div className="synthwave-scrollbar min-h-0 max-h-none flex-1 overflow-y-auto pr-1">
          {tab === 'buy' ? (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs text-white/55">
                {RULE_HINTS[career.acquisitionRule]}.
                <span className="ml-auto">
                  Deliveries go to the rear airfield{rearAirfield ? `: ${rearAirfield}` : ''}
                </span>
              </div>
              {purchasable.map((entry) => (
                <div
                  key={entry.aircraftName}
                  className="flex flex-wrap items-center gap-2 rounded border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm"
                >
                  <span className="min-w-28 font-semibold">{entry.displayName}</span>
                  <span className="text-xs text-white/45">
                    {AIRCRAFT_ROLE_LABELS[entry.role]} · {entry.deliveryHours} h delivery
                  </span>
                  {isFlownByEnemy(campaign, entry) ? (
                    <span
                      className="flex items-center gap-1 text-xs text-synthwave-cyan/80"
                      title="The enemy flies this type too: telling friend from foe by eye gets harder"
                    >
                      <TriangleAlert className="h-3.5 w-3.5" />
                      Enemy type
                    </span>
                  ) : null}
                  <Button
                    size="sm"
                    variant="outline"
                    className="ml-auto h-7"
                    disabled={career.money < entry.prices.new}
                    onClick={() =>
                      activeStore.send({
                        type: 'careerBuyAirframe',
                        condition: 'new',
                        aircraftName: entry.aircraftName
                      })
                    }
                  >
                    Buy new · {formatMoney(entry.prices.new)}
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7"
                    disabled={career.money < entry.prices.usedRange[1]}
                    title="Cheaper, already worn, and may hide defects you only find in the air"
                    onClick={() =>
                      activeStore.send({
                        type: 'careerBuyAirframe',
                        condition: 'used',
                        aircraftName: entry.aircraftName
                      })
                    }
                  >
                    Buy used · up to {formatMoney(entry.prices.usedRange[1])}
                  </Button>
                </div>
              ))}
              <p className="text-xs text-white/45">
                A bought aircraft is paid at once and waits at the rear airfield until it is
                delivered. To use it from another base, fly it there.
              </p>
            </div>
          ) : null}

          {tab === 'hangar' ? (
            <div className="space-y-3">
              {ownedTypes.length > 1 ? (
                <TypeChips
                  types={ownedTypes}
                  selected={fleetType}
                  onSelect={setFleetType}
                  allLabel="All types"
                />
              ) : null}
              {shownAirframes.length === 0 ? (
                <div className="rounded border border-white/10 p-4 text-center text-sm text-white/40">
                  No aircraft. Buy one in the Buy tab.
                </div>
              ) : (
                shownAirframes.map((airframe) => {
                  const airframeAircraft = getCareerAircraft(airframe.aircraftName) ?? aircraft
                  const repairCost = getRepairCost(airframeAircraft, airframe)
                  const onGround = airframe.status === 'ready'
                  const resale = getResaleValue(airframeAircraft, airframe)
                  return (
                    <div
                      key={airframe.id}
                      className="flex flex-wrap items-center gap-3 rounded border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm"
                    >
                      <span className="retro-font text-base text-synthwave-cyan">
                        #{airframe.tailNumber}
                      </span>
                      <span className="text-xs text-white/55">{airframeAircraft.shortName}</span>
                      <span className="text-white/70">{airframe.location}</span>
                      <span
                        className={cn(
                          'tabular-nums',
                          airframe.integrity < 0.7 ? 'text-synthwave-pink' : 'text-white/80'
                        )}
                      >
                        {Math.round(airframe.integrity * 100)}%
                      </span>
                      <span className="text-xs uppercase text-white/45">
                        {airframe.status === 'flying'
                          ? 'on sortie'
                          : airframe.status === 'delivering'
                            ? `${airframe.condition} · in delivery, ${hoursUntil(airframe.arrivesAt)} h`
                            : airframe.condition}
                      </span>
                      <div className="ml-auto flex gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          disabled={!onGround || repairCost <= 0 || career.money < repairCost}
                          onClick={() =>
                            activeStore.send({ type: 'careerRepair', airframeId: airframe.id })
                          }
                        >
                          <Wrench className="mr-1 h-3.5 w-3.5" />
                          Repair{repairCost > 0 ? ` · ${formatMoney(repairCost)}` : ''}
                        </Button>
                        {airframe.condition === 'used' ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7"
                            title="Clears any defects the previous owner left"
                            disabled={!onGround || career.money < airframeAircraft.prices.overhaul}
                            onClick={() =>
                              activeStore.send({ type: 'careerOverhaul', airframeId: airframe.id })
                            }
                          >
                            Overhaul · {formatMoney(airframeAircraft.prices.overhaul)}
                          </Button>
                        ) : null}
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7"
                          title="Value depends on condition, integrity and the type's resale factor"
                          disabled={!onGround}
                          onClick={() =>
                            activeStore.send({
                              type: 'careerSellAirframe',
                              airframeId: airframe.id
                            })
                          }
                        >
                          <BadgeDollarSign className="mr-1 h-3.5 w-3.5" />
                          Sell · {formatMoney(resale)}
                        </Button>
                      </div>
                    </div>
                  )
                })
              )}
              {lostAirframes.length > 0 ? (
                <div className="text-xs text-white/35">
                  Lost: {lostAirframes.map((airframe) => `#${airframe.tailNumber}`).join(', ')}
                </div>
              ) : null}
            </div>
          ) : null}

          {tab === 'pilots' ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {SKILLS.map((skill) => (
                  <Button
                    key={skill}
                    size="sm"
                    variant="outline"
                    className="h-auto flex-col py-2"
                    disabled={career.money < careerPilotHire[skill]}
                    onClick={() => activeStore.send({ type: 'careerHirePilot', skill })}
                  >
                    <span>Hire {skill}</span>
                    <span className="text-xs text-white/50">
                      {formatMoney(careerPilotHire[skill])}
                    </span>
                  </Button>
                ))}
              </div>
              <p className="text-xs text-white/45">
                A wingman needs his own aircraft. If his aircraft goes down you lose it; a wingman
                who dies is gone. Skill is what you paid for and does not improve.
              </p>
              {livePilots.length === 0 ? (
                <div className="rounded border border-white/10 p-4 text-center text-sm text-white/40">
                  No wingmen hired.
                </div>
              ) : (
                livePilots.map((pilot) => (
                  <div
                    key={pilot.id}
                    className="flex items-center gap-3 rounded border border-white/10 bg-white/[0.04] px-3 py-2 text-sm"
                  >
                    <span className="font-semibold">{pilot.name}</span>
                    <span className="text-white/60">{pilot.skill}</span>
                    <span className="ml-auto text-xs uppercase text-white/45">
                      {pilot.status === 'flying' ? 'on sortie' : 'available'}
                    </span>
                  </div>
                ))
              )}
            </div>
          ) : null}

          {tab === 'armory' ? (
            <div className="space-y-2">
              {ownedTypes.length > 1 ? (
                <TypeChips
                  types={ownedTypes}
                  selected={armoryAircraft.aircraftName}
                  onSelect={setArmoryType}
                />
              ) : null}
              {armoryAircraft.weapons
                .filter((weapon) => !weapon.free)
                .map((weapon) => (
                  <div
                    key={weapon.id}
                    className="flex items-center gap-3 rounded border border-white/10 bg-white/[0.04] px-3 py-2 text-sm"
                  >
                    <span className="min-w-40 font-semibold">{weapon.name}</span>
                    <span className="tabular-nums text-white/70">
                      {getStock(career, armoryAircraft.aircraftName)[weapon.id] ?? 0} in stock
                    </span>
                    <span className="text-xs text-white/45">{formatMoney(weapon.price)} each</span>
                    <div className="ml-auto flex gap-2">
                      {[1, 4].map((count) => (
                        <Button
                          key={count}
                          size="sm"
                          variant="outline"
                          className="h-7"
                          disabled={career.money < weapon.price * count}
                          onClick={() =>
                            activeStore.send({
                              type: 'careerBuyWeapon',
                              weaponId: weapon.id,
                              count,
                              aircraftName: armoryAircraft.aircraftName
                            })
                          }
                        >
                          +{count}
                        </Button>
                      ))}
                    </div>
                  </div>
                ))}
              <p className="text-xs text-white/45">
                Drop tanks are free. Stores you bring back unfired return to stock.
              </p>
            </div>
          ) : null}

          {tab === 'ledger' ? (
            <div className="space-y-1">
              {[...career.ledger].reverse().map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-center gap-3 border-b border-white/5 px-1 py-1.5 text-sm"
                >
                  <span className="w-28 text-xs text-white/40">
                    {new Date(entry.time).toISOString().slice(5, 16).replace('T', ' ')}
                  </span>
                  <span className="flex-1 text-white/80">{entry.reason}</span>
                  <span
                    className={cn(
                      'tabular-nums',
                      entry.amount > 0
                        ? 'text-synthwave-cyan'
                        : entry.amount < 0
                          ? 'text-synthwave-pink'
                          : 'text-white/40'
                    )}
                  >
                    {entry.amount > 0 ? '+' : ''}
                    {entry.amount !== 0 ? formatMoney(entry.amount) : ''}
                  </span>
                </div>
              ))}
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}
