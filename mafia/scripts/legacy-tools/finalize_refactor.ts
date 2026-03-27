import { Project, SyntaxKind } from "ts-morph";

const project = new Project({ tsConfigFilePath: "tsconfig.json" });

const gameFile = project.getSourceFileOrThrow("src/game/game.ts");
const messagingFile = project.getSourceFileOrThrow("src/game/messaging.ts");
const resolutionFile = project.getSourceFileOrThrow("src/game/resolution.ts");

const gameClass = gameFile.getClassOrThrow("MafiaGame");

function moveMethod(methodName: string, targetFile: any) {
    const method = gameClass.getMethod(methodName);
    if (!method) return;

    const isAsync = method.isAsync();
    const parameters = method.getParameters().map(p => ({
        name: p.getName(),
        type: p.getTypeNode()?.getText() || "any",
        hasQuestionToken: p.hasQuestionToken()
    }));
    const returnType = method.getReturnTypeNode()?.getText() || "void";
    
    let bodyText = method.getBodyText() || "";
    // Extremely safe conservative replacement of `this.` with `game.`
    bodyText = bodyText.replace(/this\./g, "game.");
    
    targetFile.addFunction({
        isExported: true,
        isAsync: isAsync,
        name: methodName,
        parameters: [
            { name: "game", type: "MafiaGame" },
            ...parameters
        ],
        returnType: returnType,
        statements: bodyText
    });

    method.remove();
}

const toMessaging = ["buildRoleEmbed", "sendVotePrompt", "sendRoleCards", "prepareSecretChannels", "sendPhaseMessage"];
const toResolution = ["checkWinCondition", "getWinner"];

toMessaging.forEach(n => moveMethod(n, messagingFile));
toResolution.forEach(n => moveMethod(n, resolutionFile));

// Fix up the references inside game.ts
const allMoves = [...toMessaging, ...toResolution];
gameFile.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(callExpr => {
    const expr = callExpr.getExpression();
    if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
        const propAccess = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
        if (propAccess.getExpression().getKind() === SyntaxKind.ThisKeyword) {
            const name = propAccess.getName();
            if (allMoves.includes(name)) {
                // Change `this.methodName(arg)` to `methodName(this, arg)`
                const args = callExpr.getArguments().map(a => a.getText());
                callExpr.replaceWithText(`${name}(this${args.length > 0 ? ", " + args.join(", ") : ""})`);
            }
        }
    }
});

messagingFile.addImportDeclaration({
    namedImports: ["MafiaGame"],
    moduleSpecifier: "./game"
});

resolutionFile.addImportDeclaration({
    namedImports: ["MafiaGame"],
    moduleSpecifier: "./game"
});

gameFile.addImportDeclaration({
    namedImports: toMessaging,
    moduleSpecifier: "./messaging"
});

gameFile.addImportDeclaration({
    namedImports: toResolution,
    moduleSpecifier: "./resolution"
});

project.saveSync();
console.log("Extraction complete!");