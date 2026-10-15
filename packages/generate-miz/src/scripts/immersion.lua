-- DCC immersion: the ramp scene around the player's parked aircraft (ground power, crew, a work
-- area, a guard post) and the release of ambient (late-activated) air traffic.
--
-- Everything spawned here is named DCC-AMB-*, so state sync ignores it and a future runtime bubble
-- can manage it. Placement is done at runtime because only the live unit knows how its parking spot
-- is oriented and how big it is; every object checks its spot first and is skipped if it is taken.
-- The scene itself (types per side and period, offsets) comes from the generator: config.immersion.ramp.

local cfg = (config and config.immersion) or {}
local PREFIX = 'DCC-AMB-'
local dressed = {}
local atan2 = math.atan2 or math.atan
local serial = 0

local function log(message)
    env.info('DCC.IMMERSION: ' .. message)
end

local function nextName(kind)
    serial = serial + 1
    return PREFIX .. kind .. '-' .. serial
end

local function isFree(point, radius, ignore)
    local found = false
    local volume = { id = world.VolumeType.SPHERE, params = { point = point, radius = radius } }
    local categories = { Object.Category.UNIT, Object.Category.STATIC, Object.Category.SCENERY }
    world.searchObjects(categories, volume, function(object)
        if object == ignore then return true end
        -- The scene's own objects are spaced by design; only foreign objects block a spot.
        local ok, objectName = pcall(function() return object:getName() end)
        if ok and type(objectName) == 'string' and objectName:sub(1, #PREFIX) == PREFIX then
            return true
        end
        found = true
        return false
    end)
    if found then return false end
    local surface = land.getSurfaceType({ x = point.x, y = point.z })
    -- Aprons count as runway surface in DCS; water never.
    return surface == land.SurfaceType.LAND or surface == land.SurfaceType.ROAD
        or surface == land.SurfaceType.RUNWAY
end

-- Aircraft frame: forward along the nose, right across the starboard wing (metres).
local function toWorld(origin, forward, fwd, right)
    local px = origin.x + forward.x * fwd - forward.z * right
    local pz = origin.z + forward.z * fwd + forward.x * right
    return { x = px, y = land.getHeight({ x = px, y = pz }), z = pz }
end

-- Nose, tail and wingtip distances from the aircraft's origin, from its bounding box.
local function dimensions(unit)
    local desc = unit:getDesc()
    local box = desc and desc.box
    if box and box.min and box.max then
        return {
            nose = box.max.x,
            tail = box.min.x,
            wing = math.max(math.abs(box.min.z), math.abs(box.max.z)),
        }
    end
    return { nose = 9, tail = -9, wing = 7 }
end

local function propPoint(prop, size, origin, forward)
    local base = (prop.at == 'tail' and size.tail) or (prop.at == 'nose' and size.nose) or 0
    local right = prop.out
    if prop.side == 'right' then right = size.wing + prop.out end
    if prop.side == 'left' then right = -(size.wing + prop.out) end
    return toWorld(origin, forward, base + prop.fwd, right)
end

local function placeStatic(countryId, prop, point, heading)
    local data = {
        type = prop.type,
        category = prop.category,
        shape_name = prop.shape,
        name = nextName('ramp'),
        x = point.x,
        y = point.z,
        heading = heading,
        dead = false,
    }
    local ok, err = pcall(coalition.addStaticObject, countryId, data)
    if not ok then log('static ' .. prop.type .. ' failed: ' .. tostring(err)) end
end

-- Soldiers are live ground units on a single waypoint: they idle in place instead of walking.
local function placeSoldiers(countryId, soldiers)
    if #soldiers == 0 then return end
    local name = nextName('guard')
    local units = {}
    for index, soldier in ipairs(soldiers) do
        units[index] = {
            name = name .. '-' .. index, type = soldier.type, skill = 'Average',
            x = soldier.point.x, y = soldier.point.z, heading = soldier.heading,
        }
    end
    local first = units[1]
    local ok, err = pcall(coalition.addGroup, countryId, Group.Category.GROUND, {
        name = name, task = 'Ground Nothing', units = units,
        route = { points = { {
            x = first.x, y = first.y, type = 'Turning Point', action = 'Off Road', speed = 0,
            ETA = 0, ETA_locked = true, speed_locked = true, formation_template = '',
        } } },
    })
    if not ok then log('guards failed: ' .. tostring(err)) end
end

local function dress(unit)
    if not unit or not unit:isExist() then return end
    local name = unit:getName()
    if dressed[name] or unit:inAir() then return end
    dressed[name] = true

    local position = unit:getPosition()
    local origin, forward = position.p, position.x
    local heading = atan2(forward.z, forward.x)
    local countryId = unit:getCountry()
    local size = dimensions(unit)
    local placed, skipped = 0, 0
    local soldiers = {}

    for _, prop in ipairs(cfg.ramp or {}) do
        local wanted = (prop.layer == 'crew' and cfg.groundCrew) or (prop.layer == 'base' and cfg.baseLife)
        if wanted and not (prop.coldStartOnly and cfg.hotStart) then
            local point = propPoint(prop, size, origin, forward)
            local propHeading = heading + math.rad(prop.rel or 0)
            if isFree(point, prop.radius or 2, unit) then
                if prop.soldier then
                    soldiers[#soldiers + 1] = { type = prop.type, point = point, heading = propHeading }
                else
                    placeStatic(countryId, prop, point, propHeading)
                end
                placed = placed + 1
            else
                skipped = skipped + 1
            end
        end
    end
    placeSoldiers(countryId, soldiers)
    log('ramp scene for ' .. name .. ': ' .. placed .. ' placed, ' .. skipped .. ' skipped (spot taken)')
end

local function tryDress(unitName)
    local unit = Unit.getByName(unitName)
    if unit then dress(unit) end
end

local handler = {}
function handler:onEvent(event)
    if (event.id == world.event.S_EVENT_BIRTH or event.id == world.event.S_EVENT_PLAYER_ENTER_UNIT)
        and event.initiator and event.initiator.getPlayerName and event.initiator:getPlayerName() then
        local unit = event.initiator
        -- Let the aircraft settle on its spot before reading its orientation.
        timer.scheduleFunction(function() dress(unit) end, nil, timer.getTime() + 2)
    end
end

if cfg.groundCrew or cfg.baseLife then
    world.addEventHandler(handler)
    for _, unitName in ipairs(cfg.clientUnits or {}) do
        timer.scheduleFunction(function() tryDress(unitName) end, nil, timer.getTime() + 3)
    end
end

-- Ambient traffic: release each late-activated group at its time; airliners leave after their route.
for _, entry in ipairs(cfg.ambient or {}) do
    timer.scheduleFunction(function()
        local group = Group.getByName(entry.group)
        if group then
            pcall(function() group:activate() end)
            if entry.lifetime then
                timer.scheduleFunction(function()
                    local current = Group.getByName(entry.group)
                    if current and current:isExist() then current:destroy() end
                end, nil, timer.getTime() + entry.lifetime)
            end
        end
    end, nil, timer.getTime() + (entry.delay or 60))
end

log('loaded: crew=' .. tostring(cfg.groundCrew) .. ' life=' .. tostring(cfg.baseLife)
    .. ' ambient=' .. tostring(#(cfg.ambient or {})))
