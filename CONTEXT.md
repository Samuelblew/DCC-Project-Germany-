# DCC Domain Context

## Mission Generator

- **Mission Plan intake**: The module that turns mission chat into a validated mission plan. It owns AI object generation, text repair, fallback mission plan creation, and explicit user intent enforcement before a campaign is built.
- **GCI**: Native MiG-29A KRU intercept link. Mission generation tiles `GCI_station_MiG29` vans on each coalition's airfields (WAVE 1–10 friendly, 11–20 enemy), runs Activate GCI, and links compatible IADS search radars inside 250 km. Playing red puts NATO GCI on the opponent; playing blue puts Warsaw Pact GCI on the opponent. Culling keeps only stations on the SAM corridor in the .miz; the campaign map still shows both networks. Other aircraft keep optional F10 BRAA picture calls.

## Campaign Simulation

- **Campaign Tick**: The module that advances an active campaign by applying fast and logic phases in the correct order for both coalitions.
- **Ground Deployment**: The Module that exclusively assigns campaign formations to curated tactical sites and exact unit slots. Objective ownership remains the land-campaign authority; this Module owns legal placement, reservations, stable unit continuity, withdrawal routing, and local recovery transfer.
- **Combat Viability**: The shared Interface that projects formation count, combat power, CAS eligibility, retreat thresholds, and reformation eligibility. ATO planning, manual mission intake, active package validation, and the ground campaign must use this Interface instead of local survivor-count rules.
- **Troop Extraction**: A helicopter operation for exact surviving members of an isolated withdrawing infantry formation. Pickup removes those stable assets from the battlefield; delivery dissolves them into the destination's local Replacement Pool.
- **CASEVAC**: A theatre-independent helicopter operation for wounded personnel collected at a casualty point. It is separate from CSAR and Troop Extraction and never recovers destroyed equipment.
- **Replacement Pool**: Personnel and equipment stored at one recovery node. Pools are local to the owned supply graph so reconstitution cannot teleport assets between disconnected objectives.
- **Naval Campaign**: The Module that owns persistent surface-group position, exact ship continuity, damage, fuel, ammunition, cargo, operating state, and Falklands landing prerequisites.
- **IADS Network**: The Module that owns persistent early-warning radar identity, position, and destroyed state. Mission generation consumes this state and must never recreate destroyed radar sites.
- **Escalation**: The Module that owns the campaign's technical generation (Korea → Vietnam → Late CW → Modern) on German soil, how long each generation lasts in campaign days, the USAFE/GSFG aircraft lists, and which IADS equipment those Sentry positions field. The player picks it from the era menu; faction pick is skipped because the ladder already locks USAFE/GSFG presets. The scenario calendar date does not jump years. The last generation stays until the scenario ends.
- **South Atlantic Mission Adapter**: The Adapter that emits and imports South Atlantic countries, persistent ships, carrier bases, exact ground slots, withdrawals, extraction zones, and CASEVAC results without folding naval state into generic ground state.
