import fs from "fs";

const file = fs.readFileSync("src/game/game.ts", "utf-8");

const resolutionMethods = [
  "resolveNight",
  "resolveMafiaKill",
  "resolveLoverRedirect",
  "applyGraverobber",
  "appendSpyInspectionResult",
  "getWinner",
];

const phaseMethods = [
  "beginNight",
  "finishNight",
  "beginDiscussion",
  "finishDiscussion",
  "beginVote",
  "finishVote",
  "beginDefense",
  "finishDefense",
  "beginTrial",
  "finishTrial",
  "clearTimer",
  "clearPendingAftermathChoice",
];

// Helper to find a method and its body
function extractMethod(name, isPublicOrPrivate) {
  // Regex to find: (public|private)? async? name(args) {
  const regex = new RegExp(`(?:public\\s+|private\\s+)?(?:async\\s+)?${name}\\s*\\([^{]*\\)\\s*(?::\\s*[A-Za-z0-9_<>\\[\\]]+)?\\s*\\{`);
  const match = regex.exec(file);
  if (!match) return null;

  const startIdx = match.index;
  const startBraceIdx = startIdx + match[0].length - 1;

  let braceCount = 1;
  let endIdx = startBraceIdx + 1;
  while (braceCount > 0 && endIdx < file.length) {
    if (file[endIdx] === "{") braceCount++;
    if (file[endIdx] === "}") braceCount--;
    endIdx++;
  }

  const fullMethod = file.substring(startIdx, endIdx);
  return { startIdx, endIdx, code: fullMethod, match: match[0] };
}

let modifiedFile = file;
let resolutionContent = `import { Client } from "discord.js";\nimport { MafiaGame } from "./game";\n// Add missing imports as needed\n\n`;
let phaseContent = `import { Client } from "discord.js";\nimport { MafiaGame } from "./game";\n// Add missing imports as needed\n\n`;

const replacements = [];

for (const name of resolutionMethods) {
  const m = extractMethod(name);
  if (m) {
    let newCode = m.code.replace(/^(?:public\s+|private\s+)?/, "export ");
    // Fix signature: insert `game: MafiaGame, ` 
    newCode = newCode.replace(new RegExp(`(export\\s+(?:async\\s+)?${name}\\s*)\\(`), `$1(game: MafiaGame, `).replace(/,\s*\)/, ')').replace(/\(\s*game:\s*MafiaGame,\s*\)/, '(game: MafiaGame)');
    newCode = newCode.replace(/\bthis\./g, "game.");
    resolutionContent += newCode + "\n\n";

    // Setup wrapper in game.ts
    const isAsync = m.match.includes("async");
    const isPrivate = m.match.includes("private ") ? "private " : m.match.includes("public ") ? "public " : "private ";
    // This is naive wrapper generator
    const wrapper = `  ${isPrivate}${isAsync ? "async " : ""}${name}(...args: any[]): any {\n    return require("./resolution").${name}(this, ...args);\n  }`;
    replacements.push({ start: m.startIdx, end: m.endIdx, wrapper });
  }
}

for (const name of phaseMethods) {
  const m = extractMethod(name);
  if (m) {
    let newCode = m.code.replace(/^(?:public\s+|private\s+)?/, "export ");
    newCode = newCode.replace(new RegExp(`(export\\s+(?:async\\s+)?${name}\\s*)\\(`), `$1(game: MafiaGame, `).replace(/,\s*\)/, ')').replace(/\(\s*game:\s*MafiaGame,\s*\)/, '(game: MafiaGame)');
    newCode = newCode.replace(/\bthis\./g, "game.");
    phaseContent += newCode + "\n\n";

    const isAsync = m.match.includes("async");
    const isPrivate = m.match.includes("private ") ? "private " : m.match.includes("public ") ? "public " : "private ";
    const wrapper = `  ${isPrivate}${isAsync ? "async " : ""}${name}(...args: any[]): any {\n    return require("./phase").${name}(this, ...args);\n  }`;
    replacements.push({ start: m.startIdx, end: m.endIdx, wrapper });
  }
}

// Apply replacements back-to-front
replacements.sort((a, b) => b.start - a.start);
for (const rep of replacements) {
  modifiedFile = modifiedFile.substring(0, rep.start) + rep.wrapper + modifiedFile.substring(rep.end);
}

fs.writeFileSync("src/game/game.ts", modifiedFile);
fs.writeFileSync("src/game/resolution.ts", resolutionContent);
fs.writeFileSync("src/game/phase.ts", phaseContent);

console.log("Extraction parsed and written.");
