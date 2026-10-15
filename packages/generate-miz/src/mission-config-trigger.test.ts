import * as luaTable from '@dcc/lua-table'
import { describe, expect, test } from 'vitest'

import {
  createDoScriptAction,
  createDoScriptFileAction,
  createLoggedStartupAction,
  createStartupLogAction,
  createTriggerFunction,
  createTriggerFunctionMap,
  createTriggerOnceAction,
  fillTriggerGaps,
  toLuaLongStringLiteral
} from './mission-config-trigger'

describe('mission config trigger action', () => {
  test('serializes as valid mission Lua after the trigger action is stringified', () => {
    const configScript =
      'config = {["missionId"]="abc",["flightGroups"]={[1]={["name"]="Enfield-9",["task"]="CAS"}},["welcomeMessage"]={["text"]="DCC mission ready.\\nF10 menu features enabled."}}'
    const action = createDoScriptAction(configScript)

    expect(action).toBe(`a_do_script([[${configScript}]])`)

    const missionLuaResult = luaTable.stringify(
      { trig: { actions: { 1: action } } },
      { mixedKeyTypes: true }
    )

    expect(missionLuaResult.isOk()).toBe(true)
    if (missionLuaResult.isErr()) {
      throw missionLuaResult.error
    }

    expect(missionLuaResult.value).toContain('a_do_script([[config = {[\\"missionId\\"]')
    expect(missionLuaResult.value).toContain('DCC mission ready.\\\\nF10 menu features enabled.')
    expect(missionLuaResult.value).not.toContain('a_do_script(\\"config =')
    expect(missionLuaResult.value).not.toContain('[\\\\"missionId\\\\"]')
  })

  test('uses a longer Lua long-string delimiter when needed', () => {
    expect(toLuaLongStringLiteral('x]]y')).toBe('[=[x]]y]=]')
    expect(toLuaLongStringLiteral('x]]y]=]z')).toBe('[==[x]]y]=]z]==]')
  })

  test('creates old-style script file actions with startup logging', () => {
    const fileAction = createDoScriptFileAction('ResKey_Action_8')

    expect(fileAction).toBe('a_do_script_file(getValueResourceByKey("ResKey_Action_8"))')
    expect(createStartupLogAction('Loading "state"')).toBe(
      'if log and log.write then log.write("DCC.STARTUP", log.INFO or 3, "Loading \\"state\\"") end'
    )
    expect(createLoggedStartupAction('Loading state', fileAction)).toBe(
      'if log and log.write then log.write("DCC.STARTUP", log.INFO or 3, "Loading state") end; a_do_script_file(getValueResourceByKey("ResKey_Action_8"));'
    )
  })

  test('creates the runtime function that DCS needs to execute the trigger', () => {
    expect(createTriggerFunction(3)).toBe(
      'if mission.trig.conditions[3]() then mission.trig.actions[3]() end'
    )
  })

  test('creates the startup function table used by triggerStart script loaders', () => {
    expect(createTriggerFunctionMap([1, 3])).toEqual({
      1: 'if mission.trig.conditions[1]() then mission.trig.actions[1]() end',
      3: 'if mission.trig.conditions[3]() then mission.trig.actions[3]() end'
    })
  })

  test('creates a trigger-once action that disables itself after execution', () => {
    expect(createTriggerOnceAction('a_do_script_file(getValueResourceByKey("state"))', 3)).toBe(
      'a_do_script_file(getValueResourceByKey("state")); mission.trig.func[3]=nil;'
    )
  })
})

describe('trigger gaps', () => {
  test('optional triggers left out do not cut the Mission Editor off the later ones', () => {
    const rule = (comment: string) => ({
      rules: {},
      eventlist: '',
      predicate: 'triggerStart',
      comment,
      actions: {}
    })
    const trig = {
      actions: { 1: 'a', 7: 'b', 12: 'c' } as Record<number, string>,
      conditions: { 1: 'return(true)', 7: 'return(true)', 12: 'return(true)' } as Record<
        number,
        string
      >,
      flag: { 1: true, 7: true, 12: true } as Record<number, boolean>
    }
    const trigrules = { 1: rule('one'), 7: rule('seven'), 12: rule('immersion') } as Record<
      number,
      ReturnType<typeof rule>
    >

    fillTriggerGaps(trig, trigrules)

    expect(Object.keys(trigrules).map(Number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(trigrules[12]?.comment).toBe('immersion')
    expect(trig.actions[8]).toBe('')
    expect(trig.conditions[8]).toBe('return(false)')
    expect(trig.actions[12]).toBe('c')
  })
})
