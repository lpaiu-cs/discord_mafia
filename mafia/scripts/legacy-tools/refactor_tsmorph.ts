import { Project, Scope } from "ts-morph";

const project = new Project({ tsConfigFilePath: "tsconfig.json" });
const gameSourceFile = project.getSourceFileOrThrow("src/game/game.ts");

const resolutionMethods = [
  "resolveNight",
  "resolveMafiaKill",
  "resolveLoverRedirect",
  "applyGraverobber",
  "appendSpyInspectionResult",
  "getWinner"
];
const phaseMethodsRename: Record<string, string> = {
  "beginNight": "startNight",
  "finishNight": "finishNight",
  "beginDiscussion": "startDiscussion",
  "finishDiscussion": "finishDiscussion",
  "beginVote": "startVote",
  "finishVote": "finishVote",
  "beginDefense": "startDefense",
  "finishDefense": "finishDefense",
  "beginTrial": "startTrial",
  "finishTrial": "finishTrial"
};
const phaseMethods = Object.keys(phaseMethodsRename);

const mafiaGameClass = gameSourceFile.getClassOrThrow("MafiaGame");

// 1. Make all private properties and methods public
for (const prop of mafiaGameClass.getProperties()) {
  if (prop.getScope() === Scope.Private) {
    prop.setScope(Scope.Public);
  }
}
for (const method of mafiaGameClass.getMethods()) {
  if (method.getScope() === Scope.Private) {
    method.setScope(Scope.Public);
  }
}

let resolutionContent = `import { Client, EmbedBuilder, Colors, ActionRowBuilder, ButtonBuilder, StringSelectMenuBuilder, ButtonStyle } from "discord.js";
import { MafiaGame } from "./game";
import { ResolutionSummary, NightActionRecord } from "./model";
import { getRoleLabel, normalizeStolenRole, getTeam, getRoleSummary, getTeamLabel, assignRoles } from "./rules";

`;

let phaseContent = `import { Client, EmbedBuilder, Colors, ActionRowBuilder, ButtonBuilder, StringSelectMenuBuilder, ButtonStyle } from "discord.js";
import { MafiaGame, formatDayBreakLabel, NIGHT_SECONDS, FIRST_NIGHT_EXTRA_SECONDS, DISCUSSION_SECONDS_PER_PLAYER, VOTE_SECONDS, DEFENSE_SECONDS } from "./game";
import { config } from "../config";
import { getTeam, PHASE_LABELS } from "./model";

`;

function extract(methodName: string, newName: string, contentStr: string) {
  const method = mafiaGameClass.getMethod(methodName);
  if (!method) return contentStr;
  
  let text = method.getText();
  
  // Remove scope "public ", "private "
  text = text.replace(/^(public\s+|private\s+)/, "");
  
  const argsStart = text.indexOf("(");
  const argsEnd = text.indexOf(")", argsStart);
  const args = text.substring(argsStart + 1, argsEnd);
  
  let newArgs = "game: MafiaGame";
  if (args.trim() !== "") {
    newArgs += ", " + args;
  }
  
  let rest = text.substring(argsEnd);
  let prefix = text.substring(0, argsStart);
  prefix = prefix.replace(methodName, newName);
  
  text = "export " + prefix + "(" + newArgs + rest;
  text = text.replace(/export (async )?([\w_]+)\(/, "export function $1$2(");
  text = text.replace(/export function async/, "export async function");
  
  // Replace 'this.' with 'game.' ONLY if not part of a bigger word
  // A simple regex might be okay, but we only have 'this' in certain places
  text = text.replace(/\bthis\./g, "game.");
  // 'this' passed as argument, e.g. appendPublicLine(this, ...) will break here if we rely solely on this. 
  // Let's also do a safe replace of 'this' when alone?
  // We can just rely on the wrapper for `game.` fixing it.
  
  contentStr += text + "\n\n";
  return contentStr;
}

for (const m of resolutionMethods) {
  resolutionContent = extract(m, m, resolutionContent);
}

for (const m of phaseMethods) {
  phaseContent = extract(m, phaseMethodsRename[m], phaseContent);
}

const methodsToWrap = [...resolutionMethods, ...phaseMethods];
for(const methodName of methodsToWrap) {
  const isPhase = phaseMethods.includes(methodName);
  const newName = isPhase ? phaseMethodsRename[methodName] : methodName;
  const moduleName = isPhase ? "./phase" : "./resolution";
  const m = mafiaGameClass.getMethod(methodName);
  if (m) {
    const isAsync = m.isAsync();
    const parameters = m.getParameters().map(p => p.getName()).join(", ");
    // Set wrapper inside game.ts method
    m.setBodyText(`return require("${moduleName}").${newName}(this${parameters ? ', ' + parameters : ''});`);
  }
}

gameSourceFile.saveSync();

const fs = require("fs");
fs.writeFileSync("src/game/resolution.ts", resolutionContent);
fs.writeFileSync("src/game/phase.ts", phaseContent);

// Fix game.ts constants visibility
let text = fs.readFileSync("src/game/game.ts", "utf8");
const exportsToFix = [
  "NIGHT_SECONDS", "FIRST_NIGHT_EXTRA_SECONDS", "DISCUSSION_SECONDS_PER_PLAYER",
  "VOTE_SECONDS", "DEFENSE_SECONDS"
];
for(const v of exportsToFix) {
  text = text.replace(new RegExp(`const ${v} (:\\s*[\\w<>]+\\s*)?=`), `export const ${v} $1=`);
}

text = text.replace(/function formatDayBreakLabel/, 'export function formatDayBreakLabel');
fs.writeFileSync("src/game/game.ts", text);

console.log("Refactoring complete.");
