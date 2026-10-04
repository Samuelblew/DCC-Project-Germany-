local logName = 'DCC.GCI'

local function debugLog(message)
    env.info(logName .. ': ' .. tostring(message))
end

DCC_EWR = DCC_EWR or {}
DCC_EWR.groups = DCC_EWR.groups or {}

local bvrRangeMeters = 160000
local wvrRangeMeters = 10000
local bvrIntervalSeconds = 20
local wvrIntervalSeconds = 5
local maxPictureGroups = 4
local magneticVariationDegrees = (config and config.magneticVariationDegrees) or 0

local function sendMessageToUnits(text, unitNames, duration)
    if not text or text == "" then
        return
    end

    if mist and mist.message then
        mist.message.add({
            text = text,
            displayTime = duration or 5,
            msgFor = { units = unitNames }
        })
        return
    end

    trigger.action.outText(text, duration or 5)
end

local function getObjectName(object)
    if not object or not object.getName then
        return nil
    end

    local ok, name = pcall(function() return object:getName() end)
    if ok then
        return name
    end

    return nil
end

local function getLiveUnit(name)
    if not name then
        return nil
    end

    local unit = Unit.getByName(name)
    if unit and unit:isExist() and unit:getLife() >= 1 then
        return unit
    end

    return nil
end

local function getActiveClientUnit(groupConfig)
    if not groupConfig or not groupConfig.unitNames then
        return nil
    end

    for _, unitName in ipairs(groupConfig.unitNames) do
        local unit = getLiveUnit(unitName)
        if unit then
            return unit
        end
    end

    return nil
end

local function getGroupUnitNames(groupName)
    local unitNames = {}
    local group = Group.getByName(groupName)

    if not group then
        return unitNames
    end

    for _, unit in ipairs(group:getUnits()) do
        if unit and unit:isExist() then
            unitNames[#unitNames + 1] = unit:getName()
        end
    end

    return unitNames
end

local function getEnemyCoalitionName(clientUnit)
    local coalitionId = clientUnit:getCoalition()
    if coalitionId == coalition.side.RED then
        return "blue"
    end

    return "red"
end

local function getAspect(targetHeading, targetVec, clientVec)
    local bearingFromTarget = mist.utils.round(
        mist.utils.toDegree(mist.utils.getDir(mist.vec.sub(clientVec, targetVec), targetVec)),
        0
    )
    local aspect = math.abs(targetHeading - bearingFromTarget)
    if aspect > 180 then
        aspect = 360 - aspect
    end

    if aspect < 45 then
        return "Hot"
    elseif aspect > 135 then
        return "Cold"
    end

    return "Flank"
end

local function sortNearest(a, b)
    return a.distance < b.distance
end

local function degreesToClockPosition(degrees)
    local positions = {
        "12 o'clock", "1 o'clock", "2 o'clock", "3 o'clock",
        "4 o'clock", "5 o'clock", "6 o'clock", "7 o'clock",
        "8 o'clock", "9 o'clock", "10 o'clock", "11 o'clock"
    }
    local index = math.floor((degrees % 360) / 30) + 1
    return positions[index]
end

local function degreesToMagneticDegrees(degrees)
    local magneticDegrees = degrees - magneticVariationDegrees
    if magneticDegrees < 0 then
        magneticDegrees = magneticDegrees + 360
    end

    return magneticDegrees
end

local function usesMetric(groupConfig)
    return groupConfig and groupConfig.units == "metric"
end

local function formatAltitude(feet, metric)
    if metric then
        local meters = math.max(0, math.floor((feet * 0.3048) / 100 + 0.5) * 100)
        if meters < 300 then
            return "low"
        end
        return tostring(meters) .. " m"
    end

    local angels = math.max(0, math.floor((feet / 1000) + 0.5))
    if angels == 0 then
        return "low"
    end

    return "angels " .. tostring(angels)
end

local function formatRange(nauticalMiles, metric)
    if metric then
        return tostring(math.max(0, math.floor(nauticalMiles * 1.852 + 0.5))) .. " km"
    end
    return tostring(nauticalMiles) .. "nm"
end

local function visualCallout(plane, clientHeading, clientAlt, metric)
    local altText = ""

    if plane.altitude > clientAlt + 1000 then
        altText = " high " .. formatAltitude(plane.altitude, metric)
    elseif plane.altitude < clientAlt - 1000 then
        altText = " low " .. formatAltitude(plane.altitude, metric)
    end

    local delta = plane.direction - clientHeading
    if delta < 0 then
        delta = delta + 360
    end

    return degreesToClockPosition(delta) .. altText .. " " .. plane.unitType
end

local function getHostileAircraft(clientUnit, range, includeHelicopters)
    if not mist or not mist.makeUnitTable or not mist.getUnitsInMovingZones then
        debugLog("MIST is not ready")
        return {}
    end

    local clientName = clientUnit:getName()
    local enemyCoalition = getEnemyCoalitionName(clientUnit)
    local filters = { "[" .. enemyCoalition .. "][plane]" }
    if includeHelicopters then
        filters[#filters + 1] = "[" .. enemyCoalition .. "][helicopter]"
    end
    local hostileUnits = mist.makeUnitTable(filters)
    local inRange = mist.getUnitsInMovingZones(hostileUnits, { clientName }, range, "cylinder")
    local clientPoint = clientUnit:getPosition().p
    local clientVec = mist.utils.makeVec3(clientPoint)
    local planes = {}

    for _, unit in pairs(inRange) do
        if unit and unit:isExist() and unit:getLife() >= 1 then
            local group = unit:getGroup()
            if group then
                local unitType = unit:getTypeName()
                local unitHeading = mist.utils.round(mist.utils.toDegree(mist.getHeading(unit)))
                local unitVec = mist.utils.makeVec3(unit:getPosition().p)
                local direction = mist.utils.round(
                    mist.utils.toDegree(mist.utils.getDir(mist.vec.sub(unitVec, clientVec), clientPoint)),
                    0
                )
                local distance = mist.utils.round(mist.utils.metersToNM(mist.utils.get2DDist(unitVec, clientVec)), 0)
                local altitude = mist.utils.round(mist.utils.metersToFeet(unitVec.y) / 1000) * 1000

                planes[#planes + 1] = {
                    unitType = unitType,
                    groupName = group:getName(),
                    distance = distance,
                    direction = direction,
                    altitude = altitude,
                    aspect = getAspect(unitHeading, unitVec, clientVec)
                }
            end
        end
    end

    table.sort(planes, sortNearest)
    return planes
end

local function getGroupedAircraft(clientUnit, range)
    local planes = getHostileAircraft(clientUnit, range, false)
    local groups = {}
    local orderedNames = {}

    for _, plane in ipairs(planes) do
        if not groups[plane.groupName] then
            groups[plane.groupName] = {}
            orderedNames[#orderedNames + 1] = plane.groupName
        end

        groups[plane.groupName][#groups[plane.groupName] + 1] = plane
    end

    return groups, orderedNames
end

function DCC_EWR.Register(groupId, groupName, unitNames, options)
    if not groupId or not groupName then
        debugLog("Skipping incomplete GCI config")
        return
    end

    options = options or {}
    DCC_EWR.groups[groupName] = {
        groupId = groupId,
        groupName = groupName,
        unitNames = unitNames or {},
        units = options.units,
        gci = options.gci == true
    }
end

local function sendPicture(groupConfig, text, duration)
    if text == groupConfig.lastPicture then
        return
    end
    groupConfig.lastPicture = text
    sendMessageToUnits(text, groupConfig.unitNames, duration)
end

function DCC_EWR.Tick(groupName)
    local groupConfig = DCC_EWR.groups[groupName]
    local clientUnit = getActiveClientUnit(groupConfig)

    if not groupConfig or not clientUnit then
        return
    end

    if groupConfig.inWvr then
        return
    end

    local groups, orderedNames = getGroupedAircraft(clientUnit, bvrRangeMeters)
    local metric = usesMetric(groupConfig)
    local lines = {}

    for index, hostileGroupName in ipairs(orderedNames) do
        if index > maxPictureGroups then
            break
        end
        local group = groups[hostileGroupName]
        local plane = group and group[1]
        if plane then
            lines[#lines + 1] = string.format(
                "%03d for %s, %s, %s, %sx %s",
                degreesToMagneticDegrees(plane.direction),
                formatRange(plane.distance, metric),
                formatAltitude(plane.altitude, metric),
                plane.aspect,
                tostring(#group),
                plane.unitType
            )
        end
    end

    if #lines == 0 then
        sendPicture(groupConfig, "GCI: picture clean.", 5)
        return
    end

    sendPicture(groupConfig, table.concat(lines, "\n"), 10)
end

function DCC_EWR.TickVisual(groupName)
    local groupConfig = DCC_EWR.groups[groupName]
    local clientUnit = getActiveClientUnit(groupConfig)

    if not groupConfig or not clientUnit then
        return
    end

    local clientPoint = clientUnit:getPosition().p
    local clientVec = mist.utils.makeVec3(clientPoint)
    local clientAlt = mist.utils.round(mist.utils.metersToFeet(clientVec.y) / 1000) * 1000
    local clientHeading = mist.utils.round(mist.utils.toDegree(mist.getHeading(clientUnit)))
    local planes = getHostileAircraft(clientUnit, wvrRangeMeters, true)
    local text = ""
    local metric = usesMetric(groupConfig)

    if #planes > 0 then
        for _, plane in ipairs(planes) do
            text = text .. visualCallout(plane, clientHeading, clientAlt, metric) .. "\n"
        end
        groupConfig.inWvr = true
        sendMessageToUnits(string.sub(text, 1, -2), groupConfig.unitNames, 3)
    else
        groupConfig.inWvr = false
    end
end

function DCC_EWR.Stop(groupName, silent)
    local groupConfig = DCC_EWR.groups[groupName]
    if not groupConfig then
        return
    end

    if groupConfig.wvrSchedule then
        mist.removeFunction(groupConfig.wvrSchedule)
        groupConfig.wvrSchedule = nil
    end

    if groupConfig.bvrSchedule then
        mist.removeFunction(groupConfig.bvrSchedule)
        groupConfig.bvrSchedule = nil
    end

    groupConfig.lastPicture = nil

    if silent ~= true then
        sendMessageToUnits("GCI picture stopped.", groupConfig.unitNames, 5)
        DCC_EWR.CreateMenu(groupName)
    end
end

function DCC_EWR.StartInterval(groupName, silent)
    local groupConfig = DCC_EWR.groups[groupName]
    if not groupConfig then
        return
    end

    DCC_EWR.Stop(groupName, true)
    groupConfig.wvrSchedule = mist.scheduleFunction(DCC_EWR.TickVisual, { groupName }, timer.getTime() + 1, wvrIntervalSeconds)
    groupConfig.bvrSchedule = mist.scheduleFunction(DCC_EWR.Tick, { groupName }, timer.getTime() + 2, bvrIntervalSeconds)
    if silent ~= true then
        sendMessageToUnits("GCI picture started.", groupConfig.unitNames, 5)
    end
    DCC_EWR.CreateMenu(groupName)
end

function DCC_EWR.CreateMenu(groupName)
    local groupConfig = DCC_EWR.groups[groupName]
    if not groupConfig then
        return
    end

    local flightGroup = Group.getByName(groupConfig.groupName)
    if flightGroup and flightGroup.getID then
        groupConfig.groupId = flightGroup:getID()
    end

    if #groupConfig.unitNames == 0 then
        groupConfig.unitNames = getGroupUnitNames(groupName)
    end

    if groupConfig.menuPath then
        missionCommands.removeItemForGroup(groupConfig.groupId, groupConfig.menuPath)
        groupConfig.menuPath = nil
    end

    groupConfig.menuPath = missionCommands.addSubMenuForGroup(groupConfig.groupId, "GCI")

    if groupConfig.bvrSchedule or groupConfig.wvrSchedule then
        missionCommands.addCommandForGroup(groupConfig.groupId, "Stop Picture", groupConfig.menuPath, DCC_EWR.Stop, groupName)
    else
        missionCommands.addCommandForGroup(groupConfig.groupId, "Start Picture", groupConfig.menuPath, DCC_EWR.StartInterval, groupName)
    end
end

function DCC_EWR:onEvent(event)
    if not event or not event.initiator then
        return
    end

    if event.id == world.event.S_EVENT_BIRTH then
        local unit = event.initiator
        if not unit.getGroup then return end

        local group = unit:getGroup()
        local groupName = getObjectName(group)
        local groupConfig = groupName and DCC_EWR.groups[groupName]
        if groupConfig then
            groupConfig.groupId = group:getID()
            DCC_EWR.CreateMenu(groupName)
            if groupConfig.gci and not groupConfig.bvrSchedule then
                DCC_EWR.StartInterval(groupName, true)
            end
        end
    end
end

function DCC_EWR.Start()
    world.addEventHandler(DCC_EWR)

    for groupName, groupConfig in pairs(DCC_EWR.groups) do
        DCC_EWR.CreateMenu(groupName)
        if groupConfig.gci then
            DCC_EWR.StartInterval(groupName, true)
        end
    end
end

if config and config.flightGroups then
    for _, flightGroup in ipairs(config.flightGroups) do
        if flightGroup.client and not flightGroup.nativeGci then
            DCC_EWR.Register(
                flightGroup.groupId,
                flightGroup.name,
                flightGroup.unitNames,
                { units = flightGroup.units, gci = flightGroup.gci }
            )
        end
    end

    DCC_EWR.Start()
else
    debugLog("No config.flightGroups found for GCI setup")
end
