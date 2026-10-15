# DCS bubble (deferred)

Samuel's later culling idea. **Do not implement unless he asks.** Current `.miz` culling stays.

## Intent

DCC already owns the whole theatre (Campaign Tick + map). DCS only ever sees a corridor. The idea is not “render the whole map in DCS”. It is:

- **DCC** = campaign authority (who exists, last known position, hop, composition).
- **DCS** = 3D authority inside a moving bubble around the player.
- Spawn when an entity enters the bubble; despawn when it leaves. Positions stream back so the DCC map matches 3D.

Same DCS theatre x/z as campaign JSON — no projection.

## What already exists

| Piece | Where | Notes |
|---|---|---|
| Static culling at `.miz` gen | `packages/generate-miz/src/mission-culling.ts` | Corridor around **planned player route**, not live player. Ground ~10 km, aircraft/SAM ~150 km. |
| Manifest omit ≠ death | `apps/frontend/src/routes/campaign/mission/mission-state-update.ts` | If a group was not in the `.miz`, import must not wipe it. |
| Stable IDs | `packages/generate-miz/src/add-ground-groups.ts` | `Ground-{id}-…`, `GroundUnit-{id}-{unitId}` |
| Position export | `packages/generate-miz/src/scripts/state.lua` | Writes `dcc_state.json` every 30s + events. `unit:getPoint()`. |
| Persistence patch | `apps/core/src/main/dcs-persistence.ts` | Unsanitizes `io` and `lfs` in `MissionScripting.lua`. **`socket` still sanitized.** |
| Dynamic spawn API | `mist.dynAdd` already in the `.miz` | `coalition.addGroup` works. Late-activation of a full-map `.miz` is **not** a bubble. |

## Agreed loop (if built)

1. Outside bubble: entity lives only in campaign JSON (tick position / hop).
2. Entered: Lua spawns at that x/z with the same IDs. DCS owns movement and combat.
3. Inside: stream positions back (today 30s is too slow for a 10 km jet bubble; membership must be ~1s in the mission script).
4. Left: last DCS point written to JSON, `Group.destroy()` **without** counting as kill, tick resumes.

Bubble membership is computed **in Lua from the player unit**, not from the generate-miz route. DCC supplies a **catalogue** (id, type, last position, remaining route). Lua only tests distance.

## Viable vs not

**Viable (what Samuel wants):** SP bubble, ground + SAM first. DCC campaign / DCS 3D. Real-time placement from the catalogue + player position.

**Not this work:** Fulda war running at 1× in DCS, live Skynet registration of new SAMs, mid-package airborne spawn, dual compressed clocks, multiplayer host/client, CampLib.

## Hard rules if implemented later

- Despawn ≠ `S_EVENT_DEAD` / `lostUnits`. Extend the culling manifest live.
- Inside bubble: DCS is authority. Outside: Campaign Tick is authority. Crossing the edge freezes tick combat for that group.
- Do not put the whole theatre in the `.miz` as late-activation groups.
- File poll is the existing seam (DCC writes commands, script reads). A `Scripts/Hooks` TCP adapter is optional later; unsanitizing `socket` is a new persistence patch.
- IADS/Skynet/GCI are baked at generate-miz. Dynamic SAM spawn does not auto-join Skynet.
- AWACS stays in the `.miz`. The GCI van and the search radar that feeds it stay together for the whole sortie: the KRU only links compatible radars inside 250 km, and if the bubble removed them the generator plants three FPS-117 or 55G6 dishes beside the van. Picture calls for aggregated flights come from the campaign. Full note in `documentação/bolha-estilo-bms.md`.

## Phases (do not skip)

0. DCC reads `dcc_state.json` **during** the sortie and updates the map. No spawn. Proves the loop. **Started:** `applyLiveSortie` advances culled-out entities at 1× from DCS time and overlays in-mission positions. Losses still wait for the debrief.
1. Mission script spawn/despawn for ground and SAM. **In progress:** the gear sets `worldMode`. `bubble` omits ground and SAM from the `.miz` (a flight's direct target stays). During the sortie DCC writes `dcc_bubble.lua` beside `dcc_state.json` from the live campaign positions; `bubble.lua` prefers that file and falls back to `config.bubble`. `Group.destroy()` past 120% does not count as a kill. AI flights are in that catalogue once they are airborne, with a radius by task (fighters 80 km, support 120 km, strike 40 km, the rest 25 km). The catalogue route starts at the live position and keeps the waypoints still ahead. A CAP racetrack becomes an orbit; a sweep or intercept gets an air zone; a strike gets a ground zone on the target, and an attack on that group when the group is already alive in the mission. Weapon-free is set on spawn, except transports. A flight that has a shot at something is not released. A flight whose takeoff is inside the next ten minutes is catalogued on the ramp at its home field, with a 12 km radius, and the script starts it from a hot parking spot. Farther from the start time it stays out. The player's own flight stays in the `.miz`. Ships join the catalogue at 40 km, transports at 25 km. A carrier a flight launches from, and a ship a client flight is tasked to attack, stay in the `.miz`. EWR stays in the `.miz` because Skynet and the GCI dishes are still baked at generation. Airfields are map scenery. A FARP a flight launches from stays in the `.miz`. Command centers, power plants and logistics hubs stay too, because Skynet is still baked at generation. Other structures join the catalogue at 12 km as statics. Supply convoys and ambient flights are omitted from the `.miz` and join the catalogue, convoys at 12 km on the road still ahead and ambient transports at 25 km. A moving group is released from where it actually is, not from the point it had when it spawned.
2. Hook GUI + `net.dostring_in('mission', …)` if file poll is too clumsy.
3. Dual-world clock / dynamic IADS — only after 1 works.

## Investigate next

- Mission menu lists targets the player can pick. Choosing one draws a circle around it and keeps that group in the bubble out to the circle, not the 12 km ground radius. A targeting pod can lock well past 12 km, and the group has to exist in 3D for the lock to mean anything.

## Decision (2026-10-05)

Samuel confirmed: DCC owns campaign, DCS owns 3D, doubt was **real-time entity placement for the player bubble**. That is the scoped design above. Static route culling remains until this ships.
