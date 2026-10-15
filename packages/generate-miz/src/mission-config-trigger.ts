export function toLuaLongStringLiteral(value: string) {
  let delimiter = ''
  while (value.includes(`]${delimiter}]`)) {
    delimiter += '='
  }
  return `[${delimiter}[${value}]${delimiter}]`
}

export function createDoScriptAction(script: string) {
  return `a_do_script(${toLuaLongStringLiteral(script)})`
}

export function createDoScriptFileAction(resourceKey: string) {
  return `a_do_script_file(getValueResourceByKey("${resourceKey}"))`
}

export function createStartupLogAction(message: string) {
  const escapedMessage = message.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  return `if log and log.write then log.write("DCC.STARTUP", log.INFO or 3, "${escapedMessage}") end`
}

export function createLoggedStartupAction(message: string, action: string) {
  return `${createStartupLogAction(message)}; ${action};`
}

export function createTriggerFunction(triggerIndex: number) {
  return `if mission.trig.conditions[${triggerIndex}]() then mission.trig.actions[${triggerIndex}]() end`
}

export function createTriggerFunctionMap(triggerIndexes: number[]) {
  const triggerFunctions: Record<number, string> = {}
  triggerIndexes.forEach((triggerIndex) => {
    triggerFunctions[triggerIndex] = createTriggerFunction(triggerIndex)
  })
  return triggerFunctions
}

export function createTriggerOnceAction(action: string, triggerIndex: number) {
  return `${action}; mission.trig.func[${triggerIndex}]=nil;`
}

type TriggerRuleTable = Record<
  number,
  {
    rules: Record<number, unknown>
    eventlist: string
    comment: string
    actions: Record<number, unknown>
    predicate: string
    colorItem?: string
  }
>

/**
 * The Mission Editor walks trigger rules 1, 2, 3, ... and stops at the first missing index, so a gap
 * (an optional trigger that was left out, such as IADS) silently drops every trigger after it when
 * the mission is opened or saved there. Fills each gap with an inert start trigger.
 */
export function fillTriggerGaps(
  trig: {
    actions: Record<number, string>
    conditions: Record<number, string>
    flag: Record<number, boolean>
  },
  trigrules: TriggerRuleTable
) {
  const indexes = [...Object.keys(trigrules), ...Object.keys(trig.actions)].map(Number)
  const last = Math.max(0, ...indexes.filter(Number.isFinite))
  for (let index = 1; index <= last; index += 1) {
    trigrules[index] ??= {
      rules: {},
      eventlist: '',
      predicate: 'triggerStart',
      comment: 'DCC (unused)',
      actions: {},
      colorItem: '0x00ffffff'
    }
    if (trig.actions[index] == null) {
      trig.actions[index] = ''
      trig.conditions[index] = 'return(false)'
      trig.flag[index] = true
    }
  }
}
