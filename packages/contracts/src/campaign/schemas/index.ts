import {
  campaign as campaignSchema,
  campaignDownedPilot,
  campaignEscalation,
  campaignEwrGroup,
  campaignSamGroup,
  campaignSummary,
  escalationStage
} from './campaign'
import {
  campaignMode,
  career,
  careerAcquisitionRule,
  careerAirframe,
  careerLedgerEntry,
  careerPilot,
  careerPilotSkill,
  careerPreset,
  careerSortie
} from './career'
import { entityTypeSchema } from './entity'
import { settings, settingsOutput } from './settings'

export const campaign = {
  campaign: campaignSchema,
  campaignDownedPilot,
  campaignEwrGroup,
  campaignSamGroup,
  campaignSummary,
  campaignEscalation,
  escalationStage,
  campaignMode,
  career,
  careerAcquisitionRule,
  careerAirframe,
  careerLedgerEntry,
  careerPilot,
  careerPilotSkill,
  careerPreset,
  careerSortie,
  entityType: entityTypeSchema,
  settings,
  settingsOutput
}
