import { Project, ClassDeclaration, MethodDeclaration, SourceFile, SyntaxKind } from "ts-morph";

const project = new Project({ tsConfigFilePath: "tsconfig.json" });

const gameFile = project.getSourceFileOrThrow("src/game/game.ts");
const messagingFile = project.getSourceFile("src/game/messaging.ts") || project.createSourceFile("src/game/messaging.ts", "", { overwrite: false });
const resolutionFile = project.getSourceFile("src/game/resolution.ts") || project.createSourceFile("src/game/resolution.ts", "", { overwrite: false });

const gameClass = gameFile.getClassOrThrow("MafiaGame");

function moveMethod(className: ClassDeclaration, methodName: string, targetFile: SourceFile) {
    const method = className.getMethod(methodName);
    if (!method) return;

    // Get method signature
    const isAsync = method.isAsync();
    const parameters = method.getParameters().map(p => p.getText());
    const returnType = method.getReturnTypeNode()?.getText() || "void";
    
    // Convert body
    let bodyText = method.getBodyText() || "";
    // Replace `this.methodName(` with `methodName(game, ` (Assuming we're extracting all these)
    bodyText = bodyText.replace(/this\.([a-zA-Z0-9_]+)\(/g, "$1(game, ");
    // Replace `this.` with `game.`
    bodyText = bodyText.replace(/this\./g, "game.");
    
    // Add game parameter to the front
    const newParams = ["game: MafiaGame", ...parameters].join(", ");
    
    // Create new function in target file
    targetFile.addFunction({
        isExported: true,
        isAsync: isAsync,
        name: methodName,
        parameters: [], // We'll just replace the signature text below or add them correctly
        returnType: returnType,
        statements: bodyText
    }).setParameters(["game: MafiaGame", ...parameters].map(p => {
        const [name, ...typeParts] = p.split(":");
        return { name: name.trim().replace('?', ''), hasQuestionToken: p.includes('?'), type: typeParts.join(":").trim() };
    }));

    // Remove from class
    method.remove();
}

[
    { name: "buildRoleEmbed", target: messagingFile },
    { name: "sendVotePrompt", target: messagingFile },
    { name: "sendRoleCards", target: messagingFile },
    { name: "prepareSecretChannels", target: messagingFile },
    { name: "sendPhaseMessage", target: messagingFile }
].forEach(info => moveMethod(gameClass, info.name, info.target));

[
    { name: "checkWinCondition", target: resolutionFile },
    { name: "getWinner", target: resolutionFile }
].forEach(info => moveMethod(gameClass, info.name, info.target));

// Replace calls inside MafiaGame class!
// (This is tricky, we'll just let the user fix the calls, or we can do a naive replace in the game.ts file as a whole)

project.saveSync();
