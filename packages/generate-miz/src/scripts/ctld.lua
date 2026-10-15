ctld = ctld or {}

local logName = "DCC.CTLD"

local function debugLog(message)
    log.write(logName, log.INFO, tostring(message))
end

local function messageGroup(group, text, seconds)
    local duration = seconds or 10
    local sentViaMist = false

    if mist and mist.message and mist.message.add and group and group:isExist() then
        local units = group:getUnits()
        local unitNames = {}

        if units then
            for _, unit in pairs(units) do
                if unit and unit:isExist() and unit.getName then
                    unitNames[#unitNames + 1] = unit:getName()
                end
            end
        end

        if #unitNames > 0 then
            local ok = pcall(mist.message.add, {
                text = text,
                displayTime = duration,
                msgFor = {
                    units = unitNames
                }
            })
            sentViaMist = ok
            if not ok then
                debugLog("mist.message.add failed for group message")
            end
        end
    end

    if not sentViaMist and trigger and trigger.action and trigger.action.outText then
        -- Fallback so players still see feedback even if MIST group message fails.
        pcall(trigger.action.outText, text, duration, false)
    end

    if not sentViaMist then
        debugLog("message fallback used: " .. tostring(text))
    end
end

local function get2dDistance(a, b)
    local dx = a.x - b.x
    local dz = a.z - b.z
    return math.sqrt(dx * dx + dz * dz)
end

local function isNearGround(unit)
    local point = unit:getPoint()
    local groundHeight = land.getHeight({ x = point.x, y = point.z })
    return (point.y - groundHeight) <= 8
end

local function findNearestCargoStatic(group, radius)
    local side = group:getCoalition()
    local statics = coalition.getStaticObjects(side)
    if not statics then
        return nil
    end

    local lead = group:getUnit(1)
    if not lead or not lead:isExist() then
        return nil
    end

    local leadPoint = lead:getPoint()
    local nearest = nil
    local nearestDistance = radius

    for _, staticObj in pairs(statics) do
        if staticObj and staticObj:isExist() then
            local typeName = staticObj:getTypeName()
            local canUseAsCargo = typeName == "cds_barrels"
            if canUseAsCargo then
                local point = staticObj:getPoint()
                local distance = get2dDistance(leadPoint, point)
                if distance <= nearestDistance then
                    nearest = staticObj
                    nearestDistance = distance
                end
            end
        end
    end

    return nearest
end

local function spawnCargoAtUnit(unit, coalitionSide)
    local point = unit:getPoint()
    local position = unit:getPosition()
    local staticName = string.format("CTLD Cargo %d", math.floor(timer.getAbsTime() * 10))
    local offsetBehindMeters = 22
    local cargoX = point.x
    local cargoY = point.z

    if position and position.x then
        -- In DCS, position.x is the unit forward vector. Subtract it to place cargo behind.
        cargoX = point.x - (position.x.x * offsetBehindMeters)
        cargoY = point.z - (position.x.z * offsetBehindMeters)
    end

    coalition.addStaticObject(coalitionSide, {
        name = staticName,
        type = "cds_barrels",
        shape_name = "cds_barrels",
        category = "Cargos",
        x = cargoX,
        y = cargoY,
        heading = 0,
        canCargo = true,
        mass = 400,
        rate = 1200
    })
end

ctld.transportGroups = ctld.transportGroups or {}
ctld.loadedCargoByGroup = ctld.loadedCargoByGroup or {}
ctld.groupMenus = ctld.groupMenus or {}

function ctld.loadNearestCargo(groupName)
    local group = Group.getByName(groupName)
    if not group or not group:isExist() then
        return
    end

    local lead = group:getUnit(1)
    if not lead or not lead:isExist() then
        messageGroup(group, "CTLD: No valid transport unit found.")
        return
    end

    if lead:inAir() or not isNearGround(lead) then
        messageGroup(group, "CTLD: Land before loading cargo.")
        return
    end

    if (ctld.loadedCargoByGroup[groupName] or 0) > 0 then
        messageGroup(group, "CTLD: Cargo already loaded.")
        return
    end

    local cargo = findNearestCargoStatic(group, 120)
    if not cargo then
        messageGroup(group, "CTLD: No cargo within 120m.")
        return
    end

    cargo:destroy()
    ctld.loadedCargoByGroup[groupName] = 1
    messageGroup(group, "CTLD: Cargo loaded.")
end

function ctld.unloadCargo(groupName)
    local group = Group.getByName(groupName)
    if not group or not group:isExist() then
        return
    end

    local lead = group:getUnit(1)
    if not lead or not lead:isExist() then
        messageGroup(group, "CTLD: No valid transport unit found.")
        return
    end

    local loaded = ctld.loadedCargoByGroup[groupName] or 0
    if loaded <= 0 then
        messageGroup(group, "CTLD: No cargo loaded.")
        return
    end

    if lead:inAir() or not isNearGround(lead) then
        messageGroup(group, "CTLD: Land before unloading cargo.")
        return
    end

    spawnCargoAtUnit(lead, group:getCoalition())
    if DCC and DCC.recordCargoDelivery then
        local point = lead:getPoint()
        DCC.recordCargoDelivery(groupName, point, "unload")
    end
    ctld.loadedCargoByGroup[groupName] = 0
    messageGroup(group, "CTLD: Cargo unloaded.")
end

local function registerGroupMenu(groupName)
    if ctld.groupMenus[groupName] then
        return
    end

    local group = Group.getByName(groupName)
    if not group or not group:isExist() then
        return
    end

    local groupId = group:getID()
    local root = missionCommands.addSubMenuForGroup(groupId, "CTLD Cargo")
    missionCommands.addCommandForGroup(groupId, "Load Nearest Cargo", root, ctld.loadNearestCargo, groupName)
    missionCommands.addCommandForGroup(groupId, "Unload Cargo", root, ctld.unloadCargo, groupName)

    ctld.groupMenus[groupName] = root
    debugLog("Registered CTLD menu for transport group: " .. groupName)
end

local function tryRegisterTransportGroup(groupName)
    if not groupName then
        return
    end

    ctld.transportGroups[groupName] = true
    registerGroupMenu(groupName)
end

function ctld.scanExistingTransportGroups()
    local coalitionSides = { coalition.side.BLUE, coalition.side.RED }

    for _, side in pairs(coalitionSides) do
        local helicopterGroups = coalition.getGroups(side, Group.Category.HELICOPTER)
        if helicopterGroups then
            for _, group in pairs(helicopterGroups) do
                if group and group:isExist() then
                    local groupName = group:getName()
                    if groupName then
                        ctld.transportGroups[groupName] = true
                        registerGroupMenu(groupName)
                    end
                end
            end
        end
    end
end

local eventHandler = {}
function eventHandler:onEvent(event)
    if not event or event.id ~= world.event.S_EVENT_BIRTH then
        return
    end

    local initiator = event.initiator
    if not initiator or not initiator:isExist() then
        return
    end

    local unitCategory = initiator:getDesc() and initiator:getDesc().category
    if unitCategory ~= Unit.Category.HELICOPTER then
        return
    end

    -- Parked helicopters spawned as statics have no group. Calling getGroup on them
    -- raises a mission-script error on every birth.
    if type(initiator.getGroup) ~= 'function' then
        return
    end

    local group = initiator:getGroup()
    if not group then
        return
    end

    tryRegisterTransportGroup(group:getName())
end

world.addEventHandler(eventHandler)

timer.scheduleFunction(function()
    ctld.scanExistingTransportGroups()
    return timer.getTime() + 10
end, {}, timer.getTime() + 5)

debugLog("CTLD transport menu initialized")
