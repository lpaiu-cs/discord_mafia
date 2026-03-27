const fs = require('fs');
let gameTs = fs.readFileSync('src/game/game.ts', 'utf8');
gameTs = gameTs.replace(/interface AftermathChoice/, 'export interface AftermathChoice');
gameTs = gameTs.replace(/private readonly onEnded/, 'public readonly onEnded');
gameTs = gameTs.replace(/const PHASE_LABELS/, 'export const PHASE_LABELS');
fs.writeFileSync('src/game/game.ts', gameTs);

let phaseTs = fs.readFileSync('src/game/phase.ts', 'utf8');
phaseTs = phaseTs.replace('import { getTeam, PHASE_LABELS } from "./model";', 'import { getTeam } from "./model";\nimport { PHASE_LABELS } from "./game";');
fs.writeFileSync('src/game/phase.ts', phaseTs);

let resolutionTs = fs.readFileSync('src/game/resolution.ts', 'utf8');
resolutionTs = resolutionTs.replace('import { getRoleLabel, normalizeStolenRole, getTeam, getRoleSummary, getTeamLabel, assignRoles } from "./rules";', 'import { getRoleLabel, normalizeStolenRole, getRoleSummary, getTeamLabel, assignRoles } from "./rules";\nimport { getTeam, isMafiaTeam } from "./model";');
fs.writeFileSync('src/game/resolution.ts', resolutionTs);
