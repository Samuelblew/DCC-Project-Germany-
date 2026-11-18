import { proceduralDeploymentSites, proceduralStructureTargets } from '../procedural-ground-sites'
import { objectives } from './objectives'

export const groundStructureTargets = proceduralStructureTargets(objectives)

export const deploymentSites = proceduralDeploymentSites(objectives)
