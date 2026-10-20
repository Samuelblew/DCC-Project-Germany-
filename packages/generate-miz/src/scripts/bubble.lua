-- Live bubble for campaign units the .miz left out.
-- DCC.bubble.releasing marks a Group.destroy() that is a release, not a kill,
-- so state.lua does not write those names into lostUnits.

DCC = DCC or {}
DCC.bubble = DCC.bubble or { releasing = {}, active = {}, spent = {} }
DCC.bubble.spent = DCC.bubble.spent or {}

local SPAWN_PER_PASS = 2
local PERIOD_SECONDS = 3

local function playerXZ()
    for _, side in ipairs({ coalition.side.BLUE, coalition.side.RED }) do
        local ok, players = pcall(coalition.getPlayers, side)
        if ok and type(players) == 'table' then
            for _, unit in pairs(players) do
                if unit and unit:isExist() then
                    local point = unit:getPoint()
                    if point then
                        return point.x, point.z
                    end
                end
            end
        end
    end
end

local function markReleasing(entry, releasing)
    DCC.bubble.releasing[entry.groupName] = releasing or nil
    if type(entry.units) ~= 'table' then
        return
    end
    for _, unit in ipairs(entry.units) do
        if unit.name then
            DCC.bubble.releasing[unit.name] = releasing or nil
        end
    end
end

local function groupAlive(name)
    local group = Group.getByName(name)
    return group ~= nil and group:isExist()
end

local function staticAlive(entry)
    if not StaticObject or not StaticObject.getByName then
        return false
    end
    for _, unit in ipairs(entry.units or {}) do
        local object = StaticObject.getByName(unit.name)
        if object and object:isExist() then
            return true
        end
    end
    return false
end

local function flightTasks(entry)
    local engage = entry.engage
    if type(engage) ~= 'table' or not engage.kind then
        return {}
    end
    if engage.kind == 'orbit' and engage.x2 and engage.y2 then
        return {
            {
                enabled = true,
                auto = false,
                id = 'Orbit',
                number = 1,
                params = {
                    pattern = 'Race-Track',
                    point = { x = engage.x, y = engage.y },
                    point2 = { x = engage.x2, y = engage.y2 },
                    speed = engage.speed or entry.speed or 200,
                    altitude = engage.alt or entry.altitude or 6000,
                    duration = engage.duration or 600
                }
            }
        }
    end
    if engage.kind == 'air' or engage.kind == 'ground' then
        local air = engage.kind == 'air'
        local tasks = {}
        if not air and engage.groupName and Group and Group.getByName then
            local target = Group.getByName(engage.groupName)
            if target and target:isExist() and target.getID then
                local groupId = target:getID()
                if groupId then
                    tasks[#tasks + 1] = {
                        enabled = true,
                        auto = false,
                        id = 'AttackGroup',
                        number = 1,
                        params = {
                            groupId = groupId,
                            attackQtyLimit = false,
                            expend = 'Auto',
                            groupAttack = entry.task == 'CAS',
                            weaponType = 0
                        }
                    }
                end
            end
        end
        tasks[#tasks + 1] = {
            enabled = true,
            auto = false,
            id = 'EngageTargetsInZone',
            number = #tasks + 1,
            params = {
                x = engage.x,
                y = engage.y,
                zoneRadius = engage.radius or 8000,
                targetTypes = { air and 'Air' or 'Ground Units' },
                value = air and 'Air;' or 'Ground Units;',
                noTargetTypes = {},
                priority = 0
            }
        }
        return tasks
    end
    return {}
end

local function setFlightRules(entry)
    if entry.kind ~= 'aircraft' or not AI or not AI.Option or not AI.Option.Air then
        return
    end
    local group = Group.getByName(entry.groupName)
    if not group or not group.getController then
        return
    end
    local controller = group:getController()
    if not controller or not controller.setOption then
        return
    end
    local hold = entry.task == 'Transport' or entry.task == 'Nothing'
    pcall(function()
        controller:setOption(
            AI.Option.Air.id.ROE,
            hold and AI.Option.Air.val.ROE.WEAPON_HOLD or AI.Option.Air.val.ROE.WEAPON_FREE
        )
        controller:setOption(
            AI.Option.Air.id.REACTION_ON_THREAT,
            AI.Option.Air.val.REACTION_ON_THREAT.EVADE_FIRE
        )
    end)
end

-- Airbase:getParking() spot types (Term_Type): 16 runway, 40 helicopter only, 68 hardened
-- shelter, 72 open airplane only, 100 small shelter, 104 open for both.
local PLANE_SPOTS = { [68] = true, [72] = true, [100] = true, [104] = true }
local HELICOPTER_SPOTS = { [40] = true, [104] = true }
local CLAIM_SECONDS = 180

DCC.bubble.claimedSpots = DCC.bubble.claimedSpots or {}

-- A spawn takes a moment to show up as occupied in getParking(true), so spots handed out are
-- remembered for a while; two flights at one base used to land on the same spot.
local function spotClaimed(baseName, termIndex)
    local claims = DCC.bubble.claimedSpots[baseName]
    local at = claims and claims[termIndex]
    return at ~= nil and timer.getTime() - at < CLAIM_SECONDS
end

local function claimSpot(baseName, termIndex)
    DCC.bubble.claimedSpots[baseName] = DCC.bubble.claimedSpots[baseName] or {}
    DCC.bubble.claimedSpots[baseName][termIndex] = timer.getTime()
end

-- Returns false when the field has no free spot that fits: the flight then waits for a later
-- pass instead of being dropped on the airfield reference point, which sits on the runway.
local function assignRamp(entry, units, points)
    local base = Airbase and Airbase.getByName and entry.airdrome and Airbase.getByName(entry.airdrome)
    if not base or not base.getParking then
        return false
    end
    local ok, spots = pcall(function()
        return base:getParking(true)
    end)
    if not ok or type(spots) ~= 'table' then
        return false
    end
    local fits = entry.category == 'helicopter' and HELICOPTER_SPOTS or PLANE_SPOTS
    local free = {}
    for _, spot in pairs(spots) do
        if type(spot) == 'table' and spot.vTerminalPos and spot.Term_Index
            and fits[spot.Term_Type] and not spotClaimed(entry.airdrome, spot.Term_Index) then
            free[#free + 1] = spot
        end
    end
    if #free < #units then
        return false
    end
    for index, unit in ipairs(units) do
        local spot = free[index]
        unit.x = spot.vTerminalPos.x
        unit.y = spot.vTerminalPos.z
        unit.parking = spot.Term_Index
        unit.alt = 0
        unit.speed = 0
        claimSpot(entry.airdrome, spot.Term_Index)
    end
    if points[1] and points[1].type == 'TakeOffParkingHot' then
        local idOk, id = pcall(function()
            return base:getID()
        end)
        if idOk then
            points[1].airdromeId = id
        end
        points[1].x = units[1].x
        points[1].y = units[1].y
    end
    return true
end

local function spawnStatic(entry)
    if staticAlive(entry) then
        DCC.bubble.active[entry.groupName] = true
        return true
    end
    markReleasing(entry, false)
    local spawned = 0
    for _, unit in ipairs(entry.units or {}) do
        local ok = pcall(coalition.addStaticObject, entry.countryId, {
            name = unit.name,
            type = unit.type,
            category = unit.category or 'Fortifications',
            shape_name = unit.shape,
            x = unit.x,
            y = unit.y,
            heading = unit.heading or 0,
            dead = false
        })
        if ok then
            spawned = spawned + 1
        end
    end
    if spawned > 0 then
        DCC.bubble.active[entry.groupName] = true
        return true
    end
    return false
end

local function spawn(entry)
    if entry.kind == 'static' then
        return spawnStatic(entry)
    end
    if groupAlive(entry.groupName) then
        DCC.bubble.active[entry.groupName] = true
        return true
    end
    local units = {}
    for _, unit in ipairs(entry.units or {}) do
        local spawned = {
            name = unit.name,
            type = unit.type,
            skill = 'Average',
            x = unit.x,
            y = unit.y,
            heading = unit.heading or 0
        }
        if entry.kind == 'ground' or entry.kind == 'sam' then
            spawned.playerCanDrive = false
        end
        if entry.kind == 'aircraft' then
            spawned.payload = type(unit.payload) == 'table' and unit.payload or {
                pylons = {},
                fuel = 1000,
                flare = 0,
                chaff = 0,
                gun = 100
            }
            if type(unit.radio) == 'table' then
                spawned.Radio = unit.radio
            end
        end
        units[#units + 1] = spawned
    end
    if #units == 0 or not entry.countryId then
        return false
    end
    markReleasing(entry, false)
    local category = Group.Category.GROUND
    local task = 'Ground Nothing'
    local action = 'Off Road'
    local speed = 0
    local point = {
        type = 'Turning Point',
        action = action,
        x = entry.x,
        y = entry.y,
        speed = speed
    }
    local points = { point }
    if entry.kind == 'aircraft' then
        category = entry.category == 'helicopter' and Group.Category.HELICOPTER or Group.Category.AIRPLANE
        task = entry.task or 'CAP'
        action = 'Turning Point'
        local ramp = entry.ramp == true
        local cruiseAlt = entry.altitude or 4000
        local cruiseSpeed = entry.speed or 200
        local altitude = ramp and 0 or cruiseAlt
        speed = ramp and 0 or cruiseSpeed
        point.action = action
        point.speed = speed
        point.alt = altitude
        point.alt_type = 'BARO'
        for _, unit in ipairs(units) do
            unit.alt = altitude
            unit.speed = speed
            unit.skill = 'High'
        end
        if type(entry.route) == 'table' and #entry.route > 0 then
            points = {}
            for _, routePoint in ipairs(entry.route) do
                local pointAction = routePoint.action or 'Turning Point'
                if pointAction == 'TakeOffParkingHot' then
                    points[#points + 1] = {
                        type = 'TakeOffParkingHot',
                        action = 'From Parking Area Hot',
                        x = routePoint.x,
                        y = routePoint.y,
                        alt = 0,
                        alt_type = 'BARO',
                        speed = 0
                    }
                else
                    points[#points + 1] = {
                        type = pointAction == 'Landing' and 'Land' or 'Turning Point',
                        action = pointAction,
                        x = routePoint.x,
                        y = routePoint.y,
                        alt = routePoint.alt or cruiseAlt,
                        alt_type = 'BARO',
                        speed = routePoint.speed or speed
                    }
                end
            end
        end
        if ramp and not assignRamp(entry, units, points) then
            return false
        end
        local tasks = flightTasks(entry)
        local taskPoint = points[1]
        for _, candidate in ipairs(points) do
            if candidate.type ~= 'TakeOffParkingHot' and candidate.type ~= 'TakeOffGroundHot' then
                taskPoint = candidate
                break
            end
        end
        if #tasks > 0 and taskPoint then
            taskPoint.task = { id = 'ComboTask', params = { tasks = tasks } }
        end
    elseif entry.kind == 'ship' then
        category = Group.Category.SHIP
        task = 'Nothing'
        action = 'Turning Point'
        speed = entry.speed or 0
        point.action = action
        point.speed = speed
        for _, unit in ipairs(units) do
            unit.skill = 'Excellent'
        end
    elseif entry.kind == 'ground' and type(entry.route) == 'table' and #entry.route > 0 then
        speed = entry.speed or 0
        points = {}
        for _, routePoint in ipairs(entry.route) do
            points[#points + 1] = {
                type = 'Turning Point',
                action = routePoint.action or 'On Road',
                x = routePoint.x,
                y = routePoint.y,
                speed = routePoint.speed or speed
            }
        end
    end
    local groupData = {
        name = entry.groupName,
        task = task,
        visible = true,
        hidden = false,
        units = units,
        route = { points = points }
    }
    if entry.kind == 'aircraft' and entry.frequency then
        groupData.communication = true
        groupData.frequency = entry.frequency
        groupData.modulation = 0
    end
    local ok = pcall(coalition.addGroup, entry.countryId, category, groupData)
    if ok then
        DCC.bubble.active[entry.groupName] = true
        if entry.kind == 'aircraft' then
            setFlightRules(entry)
        end
    end
    return ok
end

-- A flight is busy when it holds an enemy aircraft on its sensors within this range.
local ENGAGED_METERS = 60000

local function engaged(group)
    if not group or not group.getUnits then
        return false
    end
    local units = group:getUnits()
    if type(units) ~= 'table' then
        return false
    end
    for _, unit in pairs(units) do
        if unit and unit.isExist and unit:isExist() and unit.getController then
            local ok, targets = pcall(function()
                return unit:getController():getDetectedTargets()
            end)
            local own = unit:getPoint()
            local side = unit:getCoalition()
            if ok and type(targets) == 'table' and own then
                for _, target in pairs(targets) do
                    local object = target and target.object
                    local hostile = object and object.isExist and object:isExist()
                        and object.getCoalition and object:getCoalition() ~= side
                        and object.inAir and object:inAir()
                    if hostile then
                        local point = object:getPoint()
                        if point and math.sqrt((point.x - own.x) ^ 2 + (point.z - own.z) ^ 2) <= ENGAGED_METERS then
                            return true
                        end
                    end
                end
            end
        end
    end
    return false
end

local function release(entry)
    if entry.kind == 'static' then
        markReleasing(entry, true)
        for _, unit in ipairs(entry.units or {}) do
            if StaticObject and StaticObject.getByName then
                local object = StaticObject.getByName(unit.name)
                if object and object:isExist() then
                    pcall(function()
                        object:destroy()
                    end)
                end
            end
        end
        DCC.bubble.active[entry.groupName] = nil
        return
    end
    local group = Group.getByName(entry.groupName)
    if not group or not group:isExist() then
        DCC.bubble.active[entry.groupName] = nil
        markReleasing(entry, false)
        return
    end
    markReleasing(entry, true)
    pcall(function()
        group:destroy()
    end)
    DCC.bubble.active[entry.groupName] = nil
end

local cachedCatalogue = nil

local function readLiveCatalogue()
    if type(config) ~= 'table' or type(config.bubble) ~= 'table' then
        return nil
    end
    if type(lfs) ~= 'table' or type(lfs.writedir) ~= 'function' or type(io) ~= 'table' or type(io.open) ~= 'function' then
        return nil
    end
    if type(loadstring) ~= 'function' then
        return nil
    end

    local file = io.open(lfs.writedir() .. 'Missions\\dcc_bubble.lua', 'r')
    if not file then
        return nil
    end
    local text = file:read('*a')
    file:close()
    if type(text) ~= 'string' or text == '' then
        return nil
    end

    local chunk = loadstring(text)
    if not chunk then
        return nil
    end
    local ok, data = pcall(chunk)
    if not ok or type(data) ~= 'table' or type(data.entries) ~= 'table' then
        return nil
    end
    if data.missionId ~= config.missionId then
        return nil
    end
    return data.entries
end

local function currentCatalogue()
    -- A half-written file fails loadstring; keep the last good table.
    local live = readLiveCatalogue()
    if live then
        cachedCatalogue = live
    end
    return cachedCatalogue or config.bubble
end

local GCI_TYPE = 'GCI_station_MiG29'

local function sideName(side)
    if coalition and coalition.side and side == coalition.side.BLUE then
        return 'blue'
    end
    if coalition and coalition.side and side == coalition.side.RED then
        return 'red'
    end
end

local function gciWatchers()
    local watchers = {}
    if not coalition or not coalition.getGroups or not Group or not Group.Category then
        return watchers
    end
    for _, side in ipairs({ coalition.side.BLUE, coalition.side.RED }) do
        local ok, groups = pcall(coalition.getGroups, side, Group.Category.GROUND)
        if ok and type(groups) == 'table' then
            for _, group in pairs(groups) do
                if group and group.isExist and group:isExist() and group.getUnits then
                    local unitsOk, units = pcall(function()
                        return group:getUnits()
                    end)
                    if unitsOk and type(units) == 'table' then
                        for _, unit in pairs(units) do
                            if unit and unit.isExist and unit:isExist() and unit.getTypeName and unit.getPoint then
                                local typeOk, typeName = pcall(function()
                                    return unit:getTypeName()
                                end)
                                if typeOk and typeName == GCI_TYPE then
                                    local pointOk, point = pcall(function()
                                        return unit:getPoint()
                                    end)
                                    local name = sideName(side)
                                    if pointOk and point and name then
                                        watchers[#watchers + 1] = { x = point.x, z = point.z, side = name }
                                    end
                                end
                            end
                        end
                    end
                end
            end
        end
    end
    return watchers
end

-- The player pulls every catalogue entry. A GCI van pulls aircraft of the other side,
-- at that entry's own enter and leave radii.
local function bubbleDistance(entry, px, pz, ex, ey, watchers)
    local dx = ex - px
    local dy = ey - pz
    local best = math.sqrt(dx * dx + dy * dy)
    if entry.kind ~= 'aircraft' or (entry.side ~= 'blue' and entry.side ~= 'red') then
        return best
    end
    for _, watcher in ipairs(watchers) do
        if watcher.side and watcher.side ~= entry.side then
            local wx = ex - watcher.x
            local wy = ey - watcher.z
            local distance = math.sqrt(wx * wx + wy * wy)
            if distance < best then
                best = distance
            end
        end
    end
    return best
end

local function pass()
    local entries = currentCatalogue()
    if type(entries) ~= 'table' then
        return
    end
    local px, pz = playerXZ()
    if not px then
        return
    end
    local watchers = gciWatchers()

    local spawned = 0
    for _, entry in ipairs(entries) do
        if entry.groupName and entry.x and entry.y and entry.enter and entry.leave then
            local alive = entry.kind == 'static' and staticAlive(entry) or groupAlive(entry.groupName)
            local ex, ey = entry.x, entry.y
            if alive and entry.kind ~= 'static' then
                local group = Group.getByName(entry.groupName)
                local units = group and group.getUnits and group:getUnits()
                local unit = units and units[1]
                if unit and unit.getPoint then
                    local ok, point = pcall(function()
                        return unit:getPoint()
                    end)
                    if ok and point then
                        ex, ey = point.x, point.z
                    end
                end
            end
            local distance = bubbleDistance(entry, px, pz, ex, ey, watchers)
            if alive and distance > entry.leave then
                local group = Group.getByName(entry.groupName)
                -- A flight in a fight stays, but not forever: past twice the leave radius it goes.
                if entry.kind ~= 'aircraft' or distance > entry.leave * 2 or not engaged(group) then
                    release(entry)
                end
            elseif not alive and distance <= entry.enter then
                -- Spawned, then gone, without release(): the sim destroyed it.
                -- Putting the same group back on the ramp repeats the crash.
                if DCC.bubble.active[entry.groupName] then
                    DCC.bubble.spent[entry.groupName] = true
                    DCC.bubble.active[entry.groupName] = nil
                elseif not DCC.bubble.spent[entry.groupName] and spawned < SPAWN_PER_PASS then
                    if spawn(entry) then
                        spawned = spawned + 1
                    end
                end
            end
        end
    end
end

timer.scheduleFunction(function()
    pcall(pass)
    return timer.getTime() + PERIOD_SECONDS
end, nil, timer.getTime() + 2)
