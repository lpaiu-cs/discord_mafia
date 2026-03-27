import { Project, SyntaxKind, ClassDeclaration } from "ts-morph";
import * as fs from "fs";

const project = new Project({
  tsConfigFilePath: "tsconfig.json"
});

const gameFile = project.getSourceFileOrThrow("src/game/game.ts");
const messagingFile = project.getSourceFileOrThrow("src/game/messaging.ts");
const resolutionFile = project.getSourceFileOrThrow("src/game/resolution.ts");

const mafiaGameClass = gameFile.getClassOrThrow("MafiaGame");

// Helper to move a method to an exported function in another file
function moveMethodToFunction(file: any, classDecl: ClassDeclaration, methodName: string) {
  const method = classDecl.getMethod(methodName);
  if (!method) return false;

  const params = method.getParameters().map(p => ({
    name: p.getName(),
    type: p.getTypeNode()?.getText() || "any",
    hasQuestionToken: p.hasQuestionToken()
  }));

  // Wait, let's just make it simpler: extract the method and prepend `export function name(game: MafiaGame, ...params) {`
  // Actually, replacing `this.` with `game.` is hard.
  // Instead, the user wants us to:
  // "Any UI helper like buildRoleEmbed should directly live in messaging.ts AND you should REMOVE it from MafiaGame completely... The same goes for Discord interaction senders like sendVotePrompt, sendRoleCards, prepareSecretChannels"
  return method;
}

const methodContentToMove: { [key: string]: { method: any, target: any } } = {
  buildRoleEmbed: { method: mafiaGameClass.getMethod("buildRoleEmbed"), target: messagingFile },
  sendVotePrompt: { method: mafiaGameClass.getMethod("sendVotePrompt"), target: messagingFile },
  sendRoleCards: { method: mafiaGameClass.getMethod("sendRoleCards"), target: messagingFile },
  prepareSecretChannels: { method: mafiaGameClass.getMethod("prepareSecretChannels"), target: messagingFile },
  sendPhaseMessage: { method: mafiaGameClass.getMethod("sendPhaseMessage"), target: messagingFile },
  checkWinCondition: { method: mafiaGameClass.getMethod("checkWinCondition"), target: resolutionFile },
  getWinner: { method: mafiaGameClass.getMethod("getWinner"), target: resolutionFile },
};

for (const [name, info] of Object.entries(methodContentToMove)) {
  if (info.method) {
    const text = info.method.getText();
    // naive string replacement of `this.` and method signature
    let newText = text.replace(/^(?:async |private |public )*([a-zA-Z0-9_]+)\s*\((.*?)\)/, "export async function $1(game: MafiaGame, $2)");
    if (!newText.includes("export ")) {
        newText = "export function " + newText;
    }
    newText = newText.replace(/this\./g, "game.");
    
    // add it to target
    info.target.addStatements(newText);
    
    // remove from class
    info.method.remove();
  }
}

// ensure imports
messagingFile.addImportDeclaration({
  namedImports: ["MafiaGame"],
  moduleSpecifier: "./game"
});
resolutionFile.addImportDeclaration({
  namedImports: ["MafiaGame"],
  moduleSpecifier: "./game"
});

project.saveSync();
console.log("Done");
