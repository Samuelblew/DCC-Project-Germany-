import * as z from 'zod'

export const packageMemberRole = z.enum([
  'primary',
  'sead',
  'cap',
  'dead',
  'cas',
  'transport',
  'csar',
  'casevac',
  'troop-extraction',
  'antiship',
  'awacs',
  'intercept',
  'sweep',
  'relocate',
  'ecm'
])

export const packageMember = z.object({
  flightGroupId: z.string(),
  role: packageMemberRole,
  totOffset: z.number() // milliseconds offset from package ToT
})

export const packageType = z.enum([
  'Strike Package',
  'SEAD Strike Package',
  'SEAD Strategic Strike Package',
  'CAP Package',
  'DEAD Package',
  'CAS Package',
  'CSAR Package',
  'CASEVAC Package',
  'Troop Extraction Package',
  'Antiship Package',
  'Transport Package',
  'OCA Package',
  'SEAD OCA Package',
  'AWACS Package',
  'Intercept Package',
  'Sweep Package',
  'Relocate Package',
  'ECM Package'
])

export const packageStatus = z.enum(['active', 'completed'])

export const missionPackage = z.object({
  id: z.string(),
  type: packageType,
  targetObjectiveId: z.string(),
  members: z.array(packageMember),
  tot: z.date(),
  originalTot: z.date().optional(),
  status: packageStatus,
  priority: z.number().optional(),
  reason: z.string().optional(),
  targetType: z.string().optional(),
  variantId: z.string().optional(),
  variantLabel: z.string().optional()
})
