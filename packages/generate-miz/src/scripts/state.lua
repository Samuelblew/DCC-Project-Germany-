local logName = 'DCC.STATE'
local function debugLog(message) log.write(logName, log.INFO, tostring(message)) end
local autosaveIntervalSeconds = 30
local eventSaveDelaySeconds = 5
local maxPendingSaveReasonsLogged = 5

local function debugError(context, error)
    debugLog(tostring(context)..": "..tostring(error))
end

local function isArray(value)
    if type(value) ~= 'table' then
        return false
    end

    local maxIndex = 0
    for key, _ in pairs(value) do
        if type(key) ~= 'number' or key < 1 or key % 1 ~= 0 then
            return false
        end
        if key > maxIndex then
            maxIndex = key
        end
    end

    for index = 1, maxIndex do
        if value[index] == nil then
            return false
        end
    end

    return true
end

local function encodeJsonString(value)
    return '"' .. value
        :gsub('\\', '\\\\')
        :gsub('"', '\\"')
        :gsub('\b', '\\b')
        :gsub('\f', '\\f')
        :gsub('\n', '\\n')
        :gsub('\r', '\\r')
        :gsub('\t', '\\t')
        .. '"'
end

local function encodeJsonValue(value)
    local valueType = type(value)

    if valueType == 'nil' then
        return 'null'
    end

    if valueType == 'boolean' or valueType == 'number' then
        return tostring(value)
    end

    if valueType == 'string' then
        return encodeJsonString(value)
    end

    if valueType == 'table' then
        local parts = {}

        if isArray(value) then
            for index = 1, #value do
                parts[#parts + 1] = encodeJsonValue(value[index])
            end
            return '[' .. table.concat(parts, ',') .. ']'
        end

        for key, nestedValue in pairs(value) do
            parts[#parts + 1] = encodeJsonString(tostring(key)) .. ':' .. encodeJsonValue(nestedValue)
        end
        return '{' .. table.concat(parts, ',') .. '}'
    end

    return 'null'
end

local function encodeMissionState(value)
    if json and json.encode then
        local ok, encoded = pcall(function() return json:encode(value) end)
        if ok and encoded then
            return encoded
        end
        debugError('json.encode failed, using fallback encoder', encoded)
    end

    return encodeJsonValue(value)
end

local missionState = {
    missionId = config.missionId,
    cullingManifest = config.cullingManifest,
    missionEnded = false,
    ejectedPilots = {},
    rescuedPilots = {},
    troopExtractions = {},
    casevacPickups = {},
    lostUnits = {},
    landedUnits = {},
    cargoDeliveries = {},
    groupPositions = {
        blue = {
            aircraft = {},
            ground = {},
            ships = {}
        },
        red = {
            aircraft = {},
            ground = {},
            ships = {}
        }
    },
}

local transportGroups = {}
local unitCache = {}
local lostUnitIndexesByName = {}
local landedUnitIndexesByName = {}
local getInitiatorGroup
local handleCsarLanding
local handleRecoveryLanding
local pendingSaveReasons = {}
local saveScheduled = false
local pendingSaveReasonCount = 0

local function safeCall(callback, fallback)
    local ok, result = pcall(callback)
    if ok then
        return result
    end
    return fallback
end

local function stringifyName(name)
    if name == nil then
        return nil
    end

    return tostring(name)
end

local function cacheUnitData(unitData, groupData, categoryName, coalitionName)
    if not unitData or not unitData.name then
        return
    end

    local name = stringifyName(unitData.name)
    local groupName = stringifyName(groupData and groupData.name or nil)
    local cachedUnit = {
        name = name,
        groupName = groupName,
        type = unitData.type or "unknown",
        categoryName = categoryName,
        coalition = coalitionName,
        x = unitData.x or 0,
        y = unitData.y or 0
    }
    unitCache[name] = cachedUnit

    local unitId = stringifyName(unitData.unitId or unitData.unit_id or nil)
    if unitId then
        unitCache[unitId] = cachedUnit
    end
end

local function loadMissionUnitCache()
    if not env or not env.mission or not env.mission.coalition then
        return
    end

    for coalitionName, coalitionData in pairs(env.mission.coalition) do
        if coalitionData and coalitionData.country then
            for _, countryData in pairs(coalitionData.country) do
                for _, categoryName in pairs({'plane', 'helicopter', 'vehicle', 'ship', 'static'}) do
                    local groups = countryData and countryData[categoryName] and countryData[categoryName].group
                    if groups then
                        for _, groupData in pairs(groups) do
                            if groupData and groupData.units then
                                for _, unitData in pairs(groupData.units) do
                                    cacheUnitData(unitData, groupData, categoryName, coalitionName)
                                end
                            end
                        end
                    end
                end
            end
        end
    end
end

local function cacheLiveUnit(unit, group, category)
    if not unit or not unit.getName then
        return
    end

    local name = stringifyName(safeCall(function() return unit:getName() end, nil))
    if not name then
        return
    end

    local point = safeCall(function() return unit:getPoint() end, nil)
    local groupName = stringifyName(group and safeCall(function() return group:getName() end, nil) or nil)
    local coalitionId = group and safeCall(function() return group:getCoalition() end, nil) or nil
    local coalitionName = coalitionId == coalition.side.BLUE and "blue" or coalitionId == coalition.side.RED and "red" or nil
    local cached = unitCache[name] or {}

    unitCache[name] = {
        name = name,
        groupName = groupName,
        type = safeCall(function() return unit:getTypeName() end, "unknown"),
        category = category,
        coalition = coalitionName or cached.coalition,
        x = point and point.x or cached.x or 0,
        y = point and point.z or cached.y or 0
    }
end

local function mergeLostUnitAttribution(lostUnit, attribution)
    if not lostUnit or not attribution then
        return
    end

    lostUnit.lossType = attribution.lossType or lostUnit.lossType
    lostUnit.killerPlayerName = attribution.killerPlayerName or lostUnit.killerPlayerName
    lostUnit.killerUnitName = attribution.killerUnitName or lostUnit.killerUnitName
    lostUnit.killerGroupName = attribution.killerGroupName or lostUnit.killerGroupName
    lostUnit.weaponName = attribution.weaponName or lostUnit.weaponName
    lostUnit.killCause = attribution.killCause or lostUnit.killCause
end

local function mergeLostUnitEventData(existingLostUnit, newLostUnit)
    if not existingLostUnit or not newLostUnit then
        return
    end

    existingLostUnit.groupName = existingLostUnit.groupName or newLostUnit.groupName
    existingLostUnit.type = existingLostUnit.type or newLostUnit.type
    existingLostUnit.category = existingLostUnit.category or newLostUnit.category
    existingLostUnit.categoryName = existingLostUnit.categoryName or newLostUnit.categoryName
    existingLostUnit.coalition = existingLostUnit.coalition or newLostUnit.coalition
    existingLostUnit.event = existingLostUnit.event or newLostUnit.event
    existingLostUnit.crashed = existingLostUnit.crashed or newLostUnit.crashed
    existingLostUnit.pilotEjected = existingLostUnit.pilotEjected or newLostUnit.pilotEjected
    if existingLostUnit.pilotSurvivedCrash == nil then
        existingLostUnit.pilotSurvivedCrash = newLostUnit.pilotSurvivedCrash
    end
    if newLostUnit.crashed then
        -- A prior UNIT_LOST event may only have a stale cached position. The CRASH event is
        -- authoritative for deciding whether the pilot is within CSAR range.
        existingLostUnit.time = newLostUnit.time or existingLostUnit.time
        existingLostUnit.x = newLostUnit.x or existingLostUnit.x
        existingLostUnit.y = newLostUnit.y or existingLostUnit.y
    else
        existingLostUnit.time = existingLostUnit.time or newLostUnit.time
        existingLostUnit.x = existingLostUnit.x or newLostUnit.x
        existingLostUnit.y = existingLostUnit.y or newLostUnit.y
    end
end

local function addOrUpdateLostUnit(lostUnit, attribution)
    if not lostUnit or not lostUnit.name then
        return
    end

    local existingIndex = lostUnitIndexesByName[lostUnit.name]
    if existingIndex then
        local existingLostUnit = missionState.lostUnits[existingIndex]
        mergeLostUnitEventData(existingLostUnit, lostUnit)
        mergeLostUnitAttribution(existingLostUnit, attribution)
        return
    end

    mergeLostUnitAttribution(lostUnit, attribution)
    missionState.lostUnits[#missionState.lostUnits + 1] = lostUnit
    lostUnitIndexesByName[lostUnit.name] = #missionState.lostUnits
end

local function recordLostUnit(unit, eventName, attribution)
    if not unit or not unit.getName then
        return
    end

    local name = stringifyName(safeCall(function() return unit:getName() end, nil))
    if not name then
        return
    end

    local cached = unitCache[name] or {}
    name = cached.name or name
    -- A bubble release calls Group.destroy(). That is not a kill.
    if DCC and DCC.bubble and DCC.bubble.releasing and DCC.bubble.releasing[name] then
        return
    end
    local position = safeCall(function() return unit:getPosition().p end, nil)
    if not position then
        local point = safeCall(function() return unit:getPoint() end, nil)
        if point then
            position = { x = point.x, z = point.z }
        end
    end

    local group = getInitiatorGroup(unit)
    local groupName = stringifyName(group and safeCall(function() return group:getName() end, nil) or cached.groupName)
    if groupName and DCC and DCC.bubble and DCC.bubble.releasing and DCC.bubble.releasing[groupName] then
        return
    end
    local category = group and safeCall(function() return group:getCategory() end, nil) or cached.category
    local categoryName = cached.categoryName
    local isAircraft = categoryName == 'plane' or categoryName == 'helicopter' or category == 0 or category == 1
    local crashed = eventName == 'crash'
    local pilotSurvivedCrash = nil
    if crashed and isAircraft then
        pilotSurvivedCrash = math.random() < (config.crashPilotSurvivalChance or 0.25)
    end

    addOrUpdateLostUnit({
        name = name,
        groupName = groupName,
        type = safeCall(function() return unit:getTypeName() end, cached.type or "unknown"),
        category = category,
        categoryName = categoryName,
        coalition = cached.coalition,
        event = eventName,
        crashed = crashed,
        pilotEjected = eventName == 'ejection',
        pilotSurvivedCrash = pilotSurvivedCrash,
        time = timer.getAbsTime(),
        x = position and position.x or cached.x or 0,
        y = position and position.z or cached.y or 0
    }, attribution)
    debugLog("Lost unit recorded: "..name.." ("..(eventName or "unknown")..")")
end

local function rebuildLandedUnitIndexes()
    landedUnitIndexesByName = {}

    for index, landedUnit in ipairs(missionState.landedUnits) do
        if landedUnit and landedUnit.name then
            landedUnitIndexesByName[landedUnit.name] = index
        end
    end
end

local function removeLandedUnit(unit)
    if not unit or not unit.getName then
        return false
    end

    local name = stringifyName(safeCall(function() return unit:getName() end, nil))
    if not name then
        return false
    end

    local cached = unitCache[name] or {}
    name = cached.name or name
    local existingIndex = landedUnitIndexesByName[name]
    if not existingIndex then
        return false
    end

    table.remove(missionState.landedUnits, existingIndex)
    rebuildLandedUnitIndexes()
    debugLog("Landed unit cleared after takeoff: "..name)
    return true
end

local function addOrUpdateLandedUnit(landedUnit)
    if not landedUnit or not landedUnit.name then
        return
    end

    local existingIndex = landedUnitIndexesByName[landedUnit.name]
    if existingIndex then
        missionState.landedUnits[existingIndex] = landedUnit
        return
    end

    missionState.landedUnits[#missionState.landedUnits + 1] = landedUnit
    landedUnitIndexesByName[landedUnit.name] = #missionState.landedUnits
end

-- Stores still carried by a unit, for returning unused weapons to a career inventory.
local function getUnitAmmo(unit)
    local ammo = safeCall(function() return unit:getAmmo() end, nil)
    local result = {}
    if ammo then
        for _, entry in ipairs(ammo) do
            local desc = entry.desc or {}
            result[#result + 1] = {
                typeName = desc.typeName,
                displayName = desc.displayName,
                count = entry.count or 0
            }
        end
    end
    return result
end

local function recordLandedUnit(unit, eventName)
    if not unit or not unit.getName then
        return false
    end

    local group = getInitiatorGroup(unit)
    local category = group and safeCall(function() return group:getCategory() end, nil) or nil

    if category ~= Group.Category.AIRPLANE and category ~= Group.Category.HELICOPTER then
        return false
    end

    local name = stringifyName(safeCall(function() return unit:getName() end, nil))
    if not name then
        return false
    end

    local cached = unitCache[name] or {}
    name = cached.name or name
    local position = safeCall(function() return unit:getPosition().p end, nil)
    if not position then
        local point = safeCall(function() return unit:getPoint() end, nil)
        if point then
            position = { x = point.x, z = point.z }
        end
    end

    local groupName = stringifyName(group and safeCall(function() return group:getName() end, nil) or cached.groupName)
    local coalitionId = group and safeCall(function() return group:getCoalition() end, nil) or nil
    local coalitionName = coalitionId == coalition.side.BLUE and "blue" or coalitionId == coalition.side.RED and "red" or cached.coalition

    addOrUpdateLandedUnit({
        name = name,
        groupName = groupName,
        type = safeCall(function() return unit:getTypeName() end, cached.type or "unknown"),
        category = category,
        categoryName = cached.categoryName,
        coalition = coalitionName,
        event = eventName,
        time = timer.getAbsTime(),
        life = safeCall(function() return unit:getLife() end, nil),
        life0 = safeCall(function() return unit:getLife0() end, nil),
        ammo = getUnitAmmo(unit),
        x = position and position.x or cached.x or 0,
        y = position and position.z or cached.y or 0
    })
    debugLog("Landed unit recorded: "..name.." ("..(eventName or "unknown")..")")
    return true
end

local function recordUnitKill(data)
    if not data or not data.targetName then
        return
    end

    local targetName = stringifyName(data.targetName)
    local cached = unitCache[targetName] or {}
    addOrUpdateLostUnit({
        name = targetName,
        groupName = stringifyName(data.targetGroupName or cached.groupName),
        type = data.targetType or cached.type or "unknown",
        category = data.targetCategory or cached.category,
        categoryName = cached.categoryName,
        coalition = data.targetCoalition or cached.coalition,
        event = data.event or "external_kill",
        time = data.time or timer.getAbsTime(),
        x = data.x or cached.x or 0,
        y = data.y or cached.y or 0
    }, {
        killerPlayerName = data.killerPlayerName,
        killerUnitName = data.killerUnitName,
        killerGroupName = data.killerGroupName,
        weaponName = data.weaponName,
        killCause = data.killCause,
        lossType = data.lossType
    })
    debugLog("Attributed unit kill recorded: "..data.targetName.." ("..(data.killCause or "unknown")..")")
end

local function loadTransportGroups()
    if not env or not env.mission or not env.mission.coalition then
        return
    end

    for _, coalitionData in pairs(env.mission.coalition) do
        if coalitionData and coalitionData.country then
            for _, countryData in pairs(coalitionData.country) do
                local planes = countryData and countryData.plane and countryData.plane.group
                local helicopters = countryData and countryData.helicopter and countryData.helicopter.group

                if planes then
                    for _, groupData in pairs(planes) do
                        if groupData and groupData.name and groupData.task == 'Transport' then
                            transportGroups[groupData.name] = true
                        end
                    end
                end

                if helicopters then
                    for _, groupData in pairs(helicopters) do
                        if groupData and groupData.name and groupData.task == 'Transport' then
                            transportGroups[groupData.name] = true
                        end
                    end
                end
            end
        end
    end
end

local function recordCargoDelivery(groupName, position, deliveryType)
    if not groupName or not position then
        return
    end

    groupName = stringifyName(groupName)
    missionState.cargoDeliveries[groupName] = {
        time = timer.getAbsTime(),
        x = position.x,
        y = position.z,
        deliveryType = deliveryType or 'unknown'
    }
    debugLog('Cargo delivery recorded: '..groupName..' ('..(deliveryType or 'unknown')..')')
end

DCC = DCC or {}
DCC.recordCargoDelivery = recordCargoDelivery
DCC.recordUnitKill = recordUnitKill

local function messageAll(message, displayTime)
    local msg = {}
    msg.text = message
    if displayTime then
        msg.displayTime = displayTime
    else
        msg.displayTime = 25
    end
    msg.msgFor = {coa = {'all'}}
    mist.message.add(msg)
end

local function canWrite(name)
    if type(io) ~= 'table' or type(io.open) ~= 'function' then
        return false, 'io.open is unavailable'
    end

    local f, error = io.open(name, "a")
    if f then
        f:close()
        return true, nil
    end
    return false, error or 'unknown write error'
end

local function findFilePath()
    if type(lfs) ~= 'table' or type(lfs.writedir) ~= 'function' then
        return nil, 'lfs.writedir is unavailable'
    end

    local path = lfs.writedir().."Missions\\"
    local filePath = string.format("%sdcc_state.json", path)

    local isOk, error = canWrite(filePath)
    if isOk then 
        debugLog(string.format("The dcc_state.json file will be created in %s : (%s)", path, filePath))
        return filePath, nil
    end

    return nil, string.format("Could not write %s: %s", filePath, tostring(error))
end

local filePath, filePathError = findFilePath()
loadMissionUnitCache()
loadTransportGroups()

if filePath then
    debugLog(string.format("State File Location: %s", filePath))
else
    debugLog('State persistence unavailable: '..tostring(filePathError or 'unknown error'))
    messageAll('No Permission to save the Mission State! Mission Progress will not be saved! Please visit our github or discord to fix the Problem. Details: '..tostring(filePathError or 'unknown error'), 600)
end

-- Get positions and unit info for aircraft groups (AIRPLANE and HELICOPTER)
local function getAircraftGroupPositions(coalition)
    local list = mist.getGroupsByAttribute({coalition = coalition}, 0)
    local groups = {}

    for i in pairs(list) do
        local groupName = stringifyName(list[i])
        if groupName ~= nil then
            local group = Group.getByName(groupName)
            
            if group and group.getCategory then
                local category = group:getCategory()

                if category == Group.Category.AIRPLANE or category == Group.Category.HELICOPTER then
                    local units = group:getUnits()
                    local unitData = {}
                    local hasAliveUnits = false

                    for _, unit in pairs(units) do
                        if unit and unit:isExist() and unit:getLife() > 0 then
                            cacheLiveUnit(unit, group, category)
                            hasAliveUnits = true
                            local position = unit:getPoint()
                            local unitInfo = {
                                name = stringifyName(unit:getName()),
                                type = unit:getTypeName(),
                                x = position.x,
                                y = position.z,
                                altitude = position.y,
                                life = unit:getLife(),
                                life0 = safeCall(function() return unit:getLife0() end, nil),
                                inAir = unit:inAir(),
                                ammo = getUnitAmmo(unit)
                            }
                            unitData[#unitData + 1] = unitInfo
                        end
                    end

                    if hasAliveUnits then
                        local position = mist.getLeadPos(groupName)
                        local groupOut = {
                            name = stringifyName(groupName),
                            x = position and position.x or 0,
                            y = position and position.z or 0,
                            units = unitData
                        }
                        groups[#groups + 1] = groupOut
                    end
                end
            end
        end
    end

    return groups
end

-- Get positions and unit info for one persistent group category.
local function getPersistentGroupPositions(coalition, wantedCategory)
    local list = mist.getGroupsByAttribute({coalition = coalition}, 0)
    local groups = {}

    for i in pairs(list) do
        local groupName = stringifyName(list[i])
        if groupName ~= nil then
            local group = Group.getByName(groupName)
            
            if group and group.getCategory then
                local category = group:getCategory()

                if category == wantedCategory then
                    local units = group:getUnits()
                    local unitData = {}
                    local hasAliveUnits = false

                    for _, unit in pairs(units) do
                        if unit and unit:isExist() and unit:getLife() > 0 then
                            cacheLiveUnit(unit, group, category)
                            hasAliveUnits = true
                            local position = unit:getPoint()
                            local unitInfo = {
                                name = stringifyName(unit:getName()),
                                type = unit:getTypeName(),
                                x = position.x,
                                y = position.z,
                                heading = mist.getHeading(unit, true),
                                life = unit:getLife()
                            }
                            unitData[#unitData + 1] = unitInfo
                        end
                    end

                    if hasAliveUnits then
                        local position = mist.getLeadPos(groupName)
                        local groupOut = {
                            name = stringifyName(groupName),
                            x = position and position.x or 0,
                            y = position and position.z or 0,
                            units = unitData
                        }
                        groups[#groups + 1] = groupOut
                    end
                end
            end
        end
    end

    return groups
end

local function export()
    if io and filePath then
        local ok, error = pcall(function()
            local encodedState = encodeMissionState(missionState)
            local fp = io.open(filePath, 'w')
            if fp then
                fp:write(encodedState)
                fp:close()
                debugLog('State exported successfully')
            else
                debugLog('State export failed: could not open file for writing')
            end
        end)

        if not ok then
            debugError('State export failed', error)
        end
    end
end

local function collectPositions(label, callback, fallback)
    local ok, result = pcall(callback)
    if ok then
        return result
    end

    debugError('Failed to collect '..label, result)
    return fallback or {}
end

local function writeState()
    missionState.groupPositions.blue.aircraft = collectPositions(
        'blue aircraft positions',
        function() return getAircraftGroupPositions("blue") end,
        missionState.groupPositions.blue.aircraft
    )
    missionState.groupPositions.red.aircraft = collectPositions(
        'red aircraft positions',
        function() return getAircraftGroupPositions("red") end,
        missionState.groupPositions.red.aircraft
    )
    missionState.groupPositions.blue.ground = collectPositions(
        'blue ground positions',
        function() return getPersistentGroupPositions("blue", Group.Category.GROUND) end,
        missionState.groupPositions.blue.ground
    )
    missionState.groupPositions.red.ground = collectPositions(
        'red ground positions',
        function() return getPersistentGroupPositions("red", Group.Category.GROUND) end,
        missionState.groupPositions.red.ground
    )
    missionState.groupPositions.blue.ships = collectPositions(
        'blue ship positions',
        function() return getPersistentGroupPositions("blue", Group.Category.SHIP) end,
        missionState.groupPositions.blue.ships
    )
    missionState.groupPositions.red.ships = collectPositions(
        'red ship positions',
        function() return getPersistentGroupPositions("red", Group.Category.SHIP) end,
        missionState.groupPositions.red.ships
    )
    
    missionState.time = timer.getAbsTime()
    export()
end

local function saveState(reason)
    debugLog('Saving state: '..tostring(reason or 'unspecified'))
    local ok, error = pcall(writeState)
    if not ok then
        debugError('Save state failed', error)
    end
end

local function joinPendingSaveReasons()
    if pendingSaveReasonCount == 0 then
        return 'scheduled'
    end

    local reason = table.concat(pendingSaveReasons, ', ')
    if pendingSaveReasonCount > #pendingSaveReasons then
        reason = reason..' +'..tostring(pendingSaveReasonCount - #pendingSaveReasons)..' more'
    end

    pendingSaveReasons = {}
    pendingSaveReasonCount = 0
    return reason
end

local function requestSave(reason)
    pendingSaveReasonCount = pendingSaveReasonCount + 1
    if #pendingSaveReasons < maxPendingSaveReasonsLogged then
        pendingSaveReasons[#pendingSaveReasons + 1] = tostring(reason or 'event')
    end

    if saveScheduled then
        return
    end

    if not timer or not timer.scheduleFunction then
        saveState(joinPendingSaveReasons())
        return
    end

    saveScheduled = true
    timer.scheduleFunction(function()
        saveScheduled = false
        if pendingSaveReasonCount > 0 then
            saveState(joinPendingSaveReasons())
        end
        return nil
    end, {}, timer.getTime() + eventSaveDelaySeconds)
end

local function flushSave(reason)
    local pendingReason = joinPendingSaveReasons()
    saveScheduled = false

    if pendingReason == 'scheduled' then
        saveState(reason)
    else
        saveState(tostring(reason or 'flush')..' ('..pendingReason..')')
    end
end

local function scheduleAutosave()
    if not timer or not timer.scheduleFunction then
        return
    end

    timer.scheduleFunction(function()
        if missionState.missionEnded then
            return nil
        end

        debugLog('Autosaving state')
        saveState('autosave')
        return timer.getTime() + autosaveIntervalSeconds
    end, {}, timer.getTime() + 5)
end

getInitiatorGroup = function(initiator)
    if not initiator or not initiator.getGroup then return nil end
    return safeCall(function() return initiator:getGroup() end, nil)
end

local function handleEvent(event)
    -- UNIT DESTRUCTION
    if event.id == world.event.S_EVENT_UNIT_LOST then
        debugLog('S_EVENT_UNIT_LOST')
        recordLostUnit(event.initiator, 'unit_lost', {
            lossType = 'lost'
        })
        requestSave('unit lost')
    end

    if event.id == world.event.S_EVENT_DEAD then
        debugLog('S_EVENT_DEAD')
        recordLostUnit(event.initiator, 'dead', {
            lossType = 'destroyed'
        })
        requestSave('dead')
    end

    if event.id == world.event.S_EVENT_KILL then
        debugLog('S_EVENT_KILL')
        local killer = event.initiator
        local killerGroup = getInitiatorGroup(killer)
        recordLostUnit(event.target, 'kill', {
            killerPlayerName = killer and killer.getPlayerName and safeCall(function() return killer:getPlayerName() end, nil) or nil,
            killerUnitName = killer and killer.getName and safeCall(function() return killer:getName() end, nil) or nil,
            killerGroupName = killerGroup and safeCall(function() return killerGroup:getName() end, nil) or nil,
            weaponName = event.weapon and event.weapon.getTypeName and safeCall(function() return event.weapon:getTypeName() end, nil) or nil,
            killCause = 'direct',
            lossType = 'killed'
        })
        requestSave('kill')
    end

    if event.id == world.event.S_EVENT_CRASH then
        debugLog('S_EVENT_CRASH')
        recordLostUnit(event.initiator, 'crash', {
            lossType = 'crashed'
        })
        requestSave('crash')
    end

    if event.id == world.event.S_EVENT_EJECTION then
        debugLog('S_EVENT_EJECTION')
        recordLostUnit(event.initiator, 'ejection', {
            lossType = 'ejected'
        })
        requestSave('ejection')
    end

    if event.id == world.event.S_EVENT_PILOT_DEAD then
        debugLog('S_EVENT_PILOT_DEAD')
        recordLostUnit(event.initiator, 'pilot_dead', {
            lossType = 'pilot_dead'
        })
        requestSave('pilot dead')
    end

    if event.id == world.event.S_EVENT_TAKEOFF then
        debugLog('S_EVENT_TAKEOFF')
        if removeLandedUnit(event.initiator) then
            requestSave('takeoff')
        end
    end

    -- LANDING
    if event.id == world.event.S_EVENT_LAND then
        debugLog('S_EVENT_LAND')
        local initiator = event.initiator

        if not initiator then return end
        if not initiator:isExist() then return end

        local recordedLanding = recordLandedUnit(initiator, 'land')
        local group = getInitiatorGroup(initiator)
        if not group then return end

        local groupName = stringifyName(group:getName())
        local recordedCargoDelivery = false
        local position = initiator:getPosition().p

        if groupName and transportGroups[groupName] then
            recordCargoDelivery(groupName, position, 'landing')
            recordedCargoDelivery = true
        end

        if handleCsarLanding then
            handleCsarLanding(groupName, position)
        end
        if handleRecoveryLanding then
            handleRecoveryLanding(groupName, position)
        end

        if recordedLanding or recordedCargoDelivery then
            requestSave('land')
        end
    end

    -- EJECTION
    if event.id == world.event.S_EVENT_LANDING_AFTER_EJECTION then
        debugLog('S_EVENT_LANDING_AFTER_EJECTION')
        local initiator = event.initiator
        
        if not initiator then return end
        if not initiator:isExist() then return end
        if not initiator.getName then return end
        if not initiator.getPosition then return end

        local name = stringifyName(initiator:getName())
        local position = initiator:getPosition().p    
        
        if position.x ~= 0 and position.y ~= 0 then
            local srfType = land.getSurfaceType(position)
            if srfType ~= land.SurfaceType.WATER and srfType ~= land.SurfaceType.SHALLOW_WATER then
                missionState.ejectedPilots[#missionState.ejectedPilots + 1] = {
                    name = name,
                    coalition = safeCall(function()
                        local coalitionId = initiator:getCoalition()
                        if coalitionId == coalition.side.BLUE then return 'blue' end
                        if coalitionId == coalition.side.RED then return 'red' end
                        return nil
                    end, nil),
                    time = timer.getAbsTime(),
                    x = position.x,
                    y = position.z
                }
                requestSave('pilot landed after ejection')
            end
        end
    end

    if world.event.S_EVENT_PLAYER_LEAVE_UNIT and event.id == world.event.S_EVENT_PLAYER_LEAVE_UNIT then
        debugLog('S_EVENT_PLAYER_LEAVE_UNIT - Saving state')
        requestSave('player leave unit')
    end

    if world.event.S_EVENT_DISCONNECT and event.id == world.event.S_EVENT_DISCONNECT then
        debugLog('S_EVENT_DISCONNECT - Saving state')
        requestSave('disconnect')
    end

    -- PLAYER BIRTH (for logging)
    if event.id == world.event.S_EVENT_BIRTH and event.initiator then
        local group = getInitiatorGroup(event.initiator)
        local category = group and safeCall(function() return group:getCategory() end, nil) or nil
        cacheLiveUnit(event.initiator, group, category)

        local player = event.initiator.getPlayerName and event.initiator:getPlayerName() or nil
        if player then
            debugLog('Player birth: '..player)
        end
    end

    -- MISSION END - Write final state
    if event.id == world.event.S_EVENT_MISSION_END then
        debugLog('S_EVENT_MISSION_END - Saving final state')
        missionState.missionEnded = true
        flushSave('mission end')
    end
end

local rescuedPilotIds = {}
local pickedUpPilotIds = {}
local csarGroups = {}

local function recordCsarRescue(groupConfig, position)
    local csar = groupConfig and groupConfig.csar
    if not csar or not csar.pilotId or rescuedPilotIds[csar.pilotId] then
        return false
    end

    rescuedPilotIds[csar.pilotId] = true
    missionState.rescuedPilots[#missionState.rescuedPilots + 1] = {
        pilotId = tostring(csar.pilotId),
        pilotName = csar.pilotName,
        groupName = groupConfig.name,
        time = timer.getAbsTime(),
        x = position and position.x or nil,
        y = position and position.z or nil
    }
    requestSave('CSAR pickup')
    debugLog('CSAR pilot rescued: '..tostring(csar.pilotId)..' by '..tostring(groupConfig.name))
    return true
end

DCC.recordCsarRescue = recordCsarRescue

local function csarGroupUnit(groupConfig)
    local group = groupConfig and groupConfig.name and Group.getByName(groupConfig.name) or nil
    if not group or not group:isExist() then return nil end
    local units = group:getUnits()
    return units and units[1] or nil
end

local function csarMessage(groupConfig, message, duration)
    trigger.action.outTextForGroup(groupConfig.groupId, message, duration or 15, false)
end

local function csarStatus(groupConfig)
    local unit = csarGroupUnit(groupConfig)
    local csar = groupConfig.csar
    if not unit or not csar then
        csarMessage(groupConfig, 'CSAR pilot location unavailable.')
        return
    end
    if rescuedPilotIds[csar.pilotId] then
        csarMessage(groupConfig, tostring(csar.pilotName)..' has been delivered.')
        return
    end
    if pickedUpPilotIds[csar.pilotId] then
        csarMessage(groupConfig, tostring(csar.pilotName)..' is aboard. Return to the drop-off point.')
        return
    end

    local point = unit:getPoint()
    local dx = csar.position.x - point.x
    local dz = csar.position.y - point.z
    local distance = math.sqrt(dx * dx + dz * dz)
    local bearing = math.deg(math.atan2(dx, dz))
    if bearing < 0 then bearing = bearing + 360 end
    csarMessage(
        groupConfig,
        string.format('%s: bearing %03d, %.1f km.', tostring(csar.pilotName), math.floor(bearing + 0.5), distance / 1000)
    )
end

local function csarSmoke(groupConfig)
    local csar = groupConfig.csar
    if not csar or rescuedPilotIds[csar.pilotId] or pickedUpPilotIds[csar.pilotId] then
        csarMessage(groupConfig, 'No pilot awaiting pickup.')
        return
    end
    local point = {
        x = csar.position.x,
        y = land.getHeight({ x = csar.position.x, y = csar.position.y }),
        z = csar.position.y
    }
    trigger.action.smoke(point, trigger.smokeColor.Orange)
    csarMessage(groupConfig, tostring(csar.pilotName)..' deployed orange smoke.')
end

local function csarPickup(groupConfig)
    local unit = csarGroupUnit(groupConfig)
    local csar = groupConfig.csar
    if not unit or not csar then
        csarMessage(groupConfig, 'CSAR pickup unavailable.')
        return
    end
    if rescuedPilotIds[csar.pilotId] then
        csarMessage(groupConfig, tostring(csar.pilotName)..' has already been delivered.')
        return
    end
    if pickedUpPilotIds[csar.pilotId] then
        csarMessage(groupConfig, tostring(csar.pilotName)..' is already aboard.')
        return
    end

    local point = unit:getPoint()
    local dx = csar.position.x - point.x
    local dz = csar.position.y - point.z
    local distance = math.sqrt(dx * dx + dz * dz)
    if distance > (csar.pickupRadius or 150) then
        csarMessage(groupConfig, string.format('Move closer to the pilot (%.0f m).', distance))
        return
    end
    if unit:inAir() then
        csarMessage(groupConfig, 'Land before picking up the pilot.')
        return
    end

    pickedUpPilotIds[csar.pilotId] = true
    local pilotObject = csar.pilotObjectName and StaticObject.getByName(csar.pilotObjectName) or nil
    if pilotObject and pilotObject:isExist() then
        pilotObject:destroy()
    end
    csarMessage(groupConfig, tostring(csar.pilotName)..' is aboard. Return to the drop-off point.', 25)
end

handleCsarLanding = function(groupName, position)
    local groupConfig = groupName and csarGroups[groupName] or nil
    local csar = groupConfig and groupConfig.csar or nil
    if not csar or not pickedUpPilotIds[csar.pilotId] or rescuedPilotIds[csar.pilotId] then
        return false
    end

    local dropOff = csar.dropOffPosition
    if not dropOff or not position then
        return false
    end

    local dx = dropOff.x - position.x
    local dz = dropOff.y - position.z
    local distance = math.sqrt(dx * dx + dz * dz)
    if distance > (csar.pickupRadius or 150) then
        csarMessage(groupConfig, tostring(csar.pilotName)..' remains aboard. Land at the designated drop-off point.')
        return false
    end

    if recordCsarRescue(groupConfig, position) then
        pickedUpPilotIds[csar.pilotId] = nil
        csarMessage(groupConfig, tostring(csar.pilotName)..' unloaded safely.', 25)
        return true
    end
    return false
end

local function setupCsarMenus()
    if not config or not config.flightGroups then return end
    for _, groupConfig in ipairs(config.flightGroups) do
        if groupConfig.csar and groupConfig.groupId then
            csarGroups[groupConfig.name] = groupConfig
            local menu = missionCommands.addSubMenuForGroup(groupConfig.groupId, 'CSAR')
            missionCommands.addCommandForGroup(groupConfig.groupId, 'Pilot Status', menu, csarStatus, groupConfig)
            missionCommands.addCommandForGroup(groupConfig.groupId, 'Request Orange Smoke', menu, csarSmoke, groupConfig)
            missionCommands.addCommandForGroup(groupConfig.groupId, 'Pick Up Pilot', menu, csarPickup, groupConfig)
        end
    end
end

local recoveryGroups = {}
local pickedUpRecoveryIds = {}
local deliveredRecoveryIds = {}

local function recoveryMessage(groupConfig, message, duration)
    trigger.action.outTextForGroup(groupConfig.groupId, message, duration or 15, false)
end

local function recoveryLabel(recovery)
    if recovery.kind == 'casevac' then
        return tostring(recovery.woundedCount or 0)..' wounded personnel'
    end
    return 'withdrawing troops'
end

local function recoveryStatus(groupConfig)
    local unit = csarGroupUnit(groupConfig)
    local recovery = groupConfig.recovery
    if not unit or not recovery then
        recoveryMessage(groupConfig, 'Recovery location unavailable.')
        return
    end
    if deliveredRecoveryIds[recovery.targetId] then
        recoveryMessage(groupConfig, recoveryLabel(recovery)..' delivered.')
        return
    end
    if pickedUpRecoveryIds[recovery.targetId] then
        recoveryMessage(groupConfig, recoveryLabel(recovery)..' aboard. Return to the drop-off point.')
        return
    end
    local point = unit:getPoint()
    local dx = recovery.position.x - point.x
    local dz = recovery.position.y - point.z
    local distance = math.sqrt(dx * dx + dz * dz)
    local bearing = math.deg(math.atan2(dx, dz))
    if bearing < 0 then bearing = bearing + 360 end
    recoveryMessage(
        groupConfig,
        string.format('%s: bearing %03d, %.1f km.', recoveryLabel(recovery), math.floor(bearing + 0.5), distance / 1000)
    )
end

local function recoverySmoke(groupConfig)
    local recovery = groupConfig.recovery
    if not recovery or pickedUpRecoveryIds[recovery.targetId] or deliveredRecoveryIds[recovery.targetId] then
        recoveryMessage(groupConfig, 'No recovery target awaiting pickup.')
        return
    end
    local point = {
        x = recovery.position.x,
        y = land.getHeight({ x = recovery.position.x, y = recovery.position.y }),
        z = recovery.position.y
    }
    trigger.action.smoke(point, trigger.smokeColor.Orange)
    recoveryMessage(groupConfig, 'Orange smoke deployed at the pickup zone.')
end

local function recoveryPickup(groupConfig)
    local unit = csarGroupUnit(groupConfig)
    local recovery = groupConfig.recovery
    if not unit or not recovery then
        recoveryMessage(groupConfig, 'Recovery pickup unavailable.')
        return
    end
    if deliveredRecoveryIds[recovery.targetId] or pickedUpRecoveryIds[recovery.targetId] then
        recoveryMessage(groupConfig, recoveryLabel(recovery)..' already recovered.')
        return
    end
    local point = unit:getPoint()
    local dx = recovery.position.x - point.x
    local dz = recovery.position.y - point.z
    local distance = math.sqrt(dx * dx + dz * dz)
    if distance > (recovery.pickupRadius or 150) then
        recoveryMessage(groupConfig, string.format('Move closer to the pickup zone (%.0f m).', distance))
        return
    end
    if unit:inAir() then
        recoveryMessage(groupConfig, 'Land before loading personnel.')
        return
    end

    pickedUpRecoveryIds[recovery.targetId] = true
    if recovery.kind == 'troop-extraction' then
        missionState.troopExtractions[#missionState.troopExtractions + 1] = {
            requestId = tostring(recovery.targetId),
            groupId = tostring(recovery.groundGroupId),
            flightGroupName = groupConfig.name,
            status = 'embarked',
            time = timer.getAbsTime()
        }
        local groundGroup = recovery.targetGroupName and Group.getByName(recovery.targetGroupName) or nil
        if groundGroup and groundGroup:isExist() then
            groundGroup:destroy()
        end
    end
    requestSave('recovery pickup')
    recoveryMessage(groupConfig, recoveryLabel(recovery)..' aboard. Return to the drop-off point.', 25)
end

handleRecoveryLanding = function(groupName, position)
    local groupConfig = groupName and recoveryGroups[groupName] or nil
    local recovery = groupConfig and groupConfig.recovery or nil
    if not recovery or not pickedUpRecoveryIds[recovery.targetId] or deliveredRecoveryIds[recovery.targetId] then
        return false
    end
    local dropOff = recovery.dropOffPosition
    if not dropOff or not position then return false end
    local dx = dropOff.x - position.x
    local dz = dropOff.y - position.z
    local distance = math.sqrt(dx * dx + dz * dz)
    if distance > (recovery.pickupRadius or 150) then
        recoveryMessage(groupConfig, recoveryLabel(recovery)..' remain aboard. Land at the designated drop-off point.')
        return false
    end

    deliveredRecoveryIds[recovery.targetId] = true
    pickedUpRecoveryIds[recovery.targetId] = nil
    if recovery.kind == 'casevac' then
        missionState.casevacPickups[#missionState.casevacPickups + 1] = {
            casualtyPointId = tostring(recovery.targetId),
            flightGroupName = groupConfig.name,
            woundedCount = recovery.woundedCount or 1,
            delivered = true,
            time = timer.getAbsTime()
        }
    else
        missionState.troopExtractions[#missionState.troopExtractions + 1] = {
            requestId = tostring(recovery.targetId),
            groupId = tostring(recovery.groundGroupId),
            flightGroupName = groupConfig.name,
            status = 'delivered',
            time = timer.getAbsTime()
        }
    end
    requestSave('recovery delivery')
    recoveryMessage(groupConfig, recoveryLabel(recovery)..' unloaded safely.', 25)
    return true
end

local function setupRecoveryMenus()
    if not config or not config.flightGroups then return end
    for _, groupConfig in ipairs(config.flightGroups) do
        if groupConfig.recovery and groupConfig.groupId then
            recoveryGroups[groupConfig.name] = groupConfig
            local menu = missionCommands.addSubMenuForGroup(groupConfig.groupId, 'Recovery')
            missionCommands.addCommandForGroup(groupConfig.groupId, 'Recovery Status', menu, recoveryStatus, groupConfig)
            missionCommands.addCommandForGroup(groupConfig.groupId, 'Request Orange Smoke', menu, recoverySmoke, groupConfig)
            missionCommands.addCommandForGroup(groupConfig.groupId, 'Load Personnel', menu, recoveryPickup, groupConfig)
        end
    end
end

local carrierOpsState = {}

local function carrierEmptyTask()
    return {
        id = 'ComboTask',
        params = { tasks = {} }
    }
end

local function carrierImmortalTask()
    return {
        id = 'ComboTask',
        params = {
            tasks = {
                [1] = {
                    enabled = true,
                    auto = false,
                    id = 'WrappedAction',
                    number = 1,
                    params = {
                        action = {
                            id = 'SetImmortal',
                            params = { value = true }
                        }
                    }
                }
            }
        }
    }
end

local function carrierSwitchWaypointTask(fromIndex, toIndex)
    return {
        id = 'ComboTask',
        params = {
            tasks = {
                [1] = {
                    enabled = true,
                    auto = false,
                    id = 'WrappedAction',
                    number = 1,
                    params = {
                        action = {
                            id = 'SwitchWaypoint',
                            params = {
                                fromWaypointIndex = fromIndex,
                                goToWaypointIndex = toIndex
                            }
                        }
                    }
                }
            }
        }
    }
end

local function carrierWaypoint(x, y, speed, task)
    return {
        alt = 0,
        alt_type = 'BARO',
        action = 'Turning Point',
        type = 'Turning Point',
        x = x,
        y = y,
        speed = speed,
        speed_locked = true,
        ETA = 0,
        ETA_locked = false,
        formation_template = '',
        task = task or carrierEmptyTask()
    }
end

local function applyCarrierRoute(group, points)
    if mist and mist.goRoute then
        return mist.goRoute(group, points)
    end
    local controller = group and group:getController() or nil
    if not controller then return false end
    controller:setTask({
        id = 'Mission',
        params = { route = { points = points } }
    })
    return true
end

local function carrierLead(groupName)
    local group = Group.getByName(groupName)
    if not group or not group:isExist() then return nil, nil end
    local units = group:getUnits()
    local unit = units and units[1] or nil
    if not unit or not unit:isExist() then return nil, nil end
    return group, unit
end

local function carrierDirection(unit)
    local orientation = unit:getPosition()
    local forward = orientation and orientation.x or nil
    local fx = forward and forward.x or 1
    local fz = forward and forward.z or 0
    local length = math.sqrt(fx * fx + fz * fz)
    if length < 0.001 then return 1, 0 end
    return fx / length, fz / length
end

local function carrierIntoWindDirection(unit, point)
    if atmosphere and atmosphere.getWind then
        local ok, wind = pcall(atmosphere.getWind, {
            x = point.x,
            y = (point.y or 0) + 20,
            z = point.z
        })
        if ok and wind then
            local windSpeed = math.sqrt((wind.x or 0) * (wind.x or 0) + (wind.z or 0) * (wind.z or 0))
            if windSpeed >= 0.5 then
                return -(wind.x or 0) / windSpeed, -(wind.z or 0) / windSpeed, windSpeed
            end
        end
    end
    local fx, fz = carrierDirection(unit)
    return fx, fz, 0
end

local function carrierHeadingDegrees(x, z)
    local heading
    if math.atan2 then
        heading = math.atan2(z, x)
    elseif x > 0 then
        heading = math.atan(z / x)
    elseif x < 0 and z >= 0 then
        heading = math.atan(z / x) + math.pi
    elseif x < 0 then
        heading = math.atan(z / x) - math.pi
    elseif z > 0 then
        heading = math.pi / 2
    else
        heading = -math.pi / 2
    end
    return math.floor(((heading * 180 / math.pi) + 360) % 360 + 0.5)
end

local function carrierMessage(ops, message, duration)
    if not trigger or not trigger.action then return end
    local side = ops.coalition == 'red' and coalition.side.RED or coalition.side.BLUE
    trigger.action.outTextForCoalition(side, message, duration or 20, false)
end

local function startCarrierHoldingPattern(ops, generation)
    local state = carrierOpsState[ops.groupName]
    if not state or state.generation ~= generation then return nil end
    local group, unit = carrierLead(ops.groupName)
    if not group or not unit then return nil end

    local point = unit:getPoint()
    local fx, fz = carrierDirection(unit)
    local rightX, rightZ = fz, -fx
    local radius = ops.holdingRadius or 6000
    local centerX = point.x + rightX * radius
    local centerZ = point.z + rightZ * radius
    local radialX, radialZ = -rightX, -rightZ
    local points = {}
    local segments = 8
    for index = 0, segments do
        local angle = index * 2 * math.pi / segments
        local x = centerX + radialX * radius * math.cos(angle) + fx * radius * math.sin(angle)
        local z = centerZ + radialZ * radius * math.cos(angle) + fz * radius * math.sin(angle)
        points[#points + 1] = carrierWaypoint(x, z, ops.speed or 12)
    end
    points[1].task = carrierImmortalTask()
    points[#points].task = carrierSwitchWaypointTask(#points, 2)
    applyCarrierRoute(group, points)
    state.mode = 'holding'
    carrierMessage(ops, string.format('%s recovery window complete; entering holding circle.', ops.displayName))
    return nil
end

local function startCarrierRecoveryWindow(ops, announce)
    local group, unit = carrierLead(ops.groupName)
    if not group or not unit then
        if announce then carrierMessage(ops, string.format('%s is unavailable.', ops.displayName)) end
        return false
    end

    local state = carrierOpsState[ops.groupName] or { generation = 0 }
    state.generation = state.generation + 1
    state.mode = 'recovery'
    carrierOpsState[ops.groupName] = state

    local point = unit:getPoint()
    local dx, dz, windSpeed = carrierIntoWindDirection(unit, point)
    local duration = ops.recoveryDuration or 1200
    local speed = ops.speed or 12
    local distance = speed * duration
    local points = {
        carrierWaypoint(point.x, point.z, speed, carrierImmortalTask()),
        carrierWaypoint(point.x + dx * distance, point.z + dz * distance, speed)
    }
    applyCarrierRoute(group, points)

    local heading = carrierHeadingDegrees(dx, dz)
    local windText = windSpeed >= 0.5 and string.format(' into %.1f m/s wind', windSpeed) or ''
    carrierMessage(
        ops,
        string.format('%s turning to course %03d%s for a 20-minute recovery window.', ops.displayName, heading, windText),
        25
    )

    timer.scheduleFunction(function(args)
        return startCarrierHoldingPattern(args.ops, args.generation)
    end, { ops = ops, generation = state.generation }, timer.getTime() + duration)
    return true
end

local function carrierRecoveryCommand(args)
    startCarrierRecoveryWindow(args.ops, true)
end

local function setupCarrierOps()
    if not config or not config.carrierOps or not missionCommands then return end
    local coalitionMenus = {}
    for _, ops in ipairs(config.carrierOps) do
        local side = ops.coalition == 'red' and coalition.side.RED or coalition.side.BLUE
        if not coalitionMenus[side] then
            coalitionMenus[side] = missionCommands.addSubMenuForCoalition(side, 'Carrier Operations')
        end
        missionCommands.addCommandForCoalition(
            side,
            string.format('Turn %s into wind (20 min)', ops.displayName),
            coalitionMenus[side],
            carrierRecoveryCommand,
            { ops = ops }
        )
        timer.scheduleFunction(function(carrierOps)
            startCarrierRecoveryWindow(carrierOps, false)
            return nil
        end, ops, timer.getTime() + 3)
    end
end

local ev = {}
function ev:onEvent(event)
    local ok, error = pcall(handleEvent, event)
    if not ok then
        debugError('Event handler failed', error)
    end
end

world.addEventHandler(ev)
setupCsarMenus()
setupRecoveryMenus()
setupCarrierOps()
saveState('startup')
scheduleAutosave()

debugLog('DCC State tracking initialized')
