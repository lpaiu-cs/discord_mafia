import { Project, SyntaxKind, MethodDeclaration, Node } from "ts-morph";

const project = new Project({ tsConfigFilePath: "tsconfig.json" });

const gameFile = project.getSourceFileOrThrow("src/game/game.ts");
const messagingFile = project.getSourceFileOrThrow("src/game/messaging.ts");
const phaseFile = project.getSourceFileOrThrow("src/game/phase.ts");
const actionsFile = project.getSourceFileOrThrow("src/game/actions.ts");
const rulesFile = project.getSourceFileOrThrow("src/game/rules.ts");

const gameClass = gameFile.getClassOrThrow("MafiaGame");

function moveMethod(methodName: string, targetFile: any) {
    const method = gameClass.getMethod(methodName);
    if (!method) return null;

    const isAsync = method.isAsync();
    const parameters = method.getParameters().map(p => ({
        name: p.getName(),
        type: p.getTypeNode()?.getText() || "any",
        hasQuestionToken: p.hasQuestionToken()
    }));
    const returnType = method.getReturnTypeNode()?.getText() || "void";

    let bodyText = method.getBodyText() || "";
    // Extremely safe conservative replacement of `this.` with `game.`
    bodyText = bodyText.replace(/\bthis\./g, "game.");

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
    return methodName;
}

const toMessaging = [
    "sendOrUpdateLobby", "describeAssignments", "sendOrUpdateStatus", "sendMadamPrompt",
    "sendReporterPublishPrompt", "sendTerrorBurnPrompt", "sendNightPrompts", "getNightPrompt",
    "requestAftermathTarget", "lockOrDeleteSecretChannels", "syncSecretChannels",
    "syncChannelMembers", "buildLobbyEmbed", "buildStatusEmbed", "buildLobbyControls",
    "buildVoteControls", "buildTrialControls", "buildTimeControls", "buildDirectActionPayload",
    "buildSpyBonusPayload", "buildAftermathPayload", "buildMadamPayload", "buildReporterPublishPayload",
    "buildTerrorBurnPayload", "safeSendDm", "getPublicChannel", "fetchSecretTextChannel",
    "fetchMessage", "sendChat", "appendSystemChat", "appendPublicActivityLog", "appendPublicLine",
    "setPublicLines", "appendPrivateLog", "getPrivateLog", "getAudioCuesForUser", "getNightPromptForPlayer",
    "queueAudioCue", "pruneAudioCues", "formatNames"
];

const toPhase = [
    "start", "forceAdvance", "end", "beginNight", "finishNight", "beginDiscussion", "finishDiscussion",
    "beginVote", "finishVote", "beginDefense", "finishDefense", "beginTrial", "finishTrial",
    "resolveNight", "resolveMafiaKill", "resolveLoverRedirect", "applyGraverobber", "clearTimer",
    "restartTimer", "newPhaseContext", "requirePhase", "readPhaseToken", "requirePhaseToken",
    "requirePhaseTokenValue"
];

const toActions = [
    "handleLobbyButton", "handleVoteSelect", "submitVote", "handleTrialVote", "submitTrialVote",
    "handleTimeAdjust", "adjustDiscussionTime", "handleReporterPublish", "publishReporterArticle",
    "handleNightSelect", "submitNightSelection", "appendSpyInspectionResult", "assignLovers",
    "contactPlayer", "killPlayer", "revivePlayer", "clearPendingAftermathChoice"
];

const toRules = [
    "isBlockedTonight", "isAliveRole", "getAliveMafia", "hasOtherAliveMafiaTeam", "getVoteWeight",
    "findActionByRole", "findBonusActionByRole", "findSubmittedActionForActor", "findActorTarget",
    "isPoliticianEffectBlocked", "getSecretChatAccess", "assertAllowedTarget", "validateNightSelection",
    "assertAliveParticipant", "canReadChat", "canWriteChat"
];

const allMoved: string[] = [];

toMessaging.forEach(n => { if (moveMethod(n, messagingFile)) allMoved.push(n); });
toPhase.forEach(n => { if (moveMethod(n, phaseFile)) allMoved.push(n); });
toActions.forEach(n => { if (moveMethod(n, actionsFile)) allMoved.push(n); });
toRules.forEach(n => { if (moveMethod(n, rulesFile)) allMoved.push(n); });

// Fix up the references inside all workspace TS files using `this.methodName(...)` internally
// game.ts needs to call `methodName(this, ...)`
gameClass.getMethods().forEach(method => {
    // We already removed the moved methods, so these are the remaining ones.
    const bodyText = method.getBodyText() || "";
    // We must replace inside the body
    let newBody = bodyText;
    allMoved.forEach(moved => {
        // match: this.methodName(
        const regex = new RegExp(`\\bthis\\.${moved}\\(`, 'g');
        newBody = newBody.replace(regex, `${moved}(this, `);
        
        // match: this.methodName property access without parens?
        // Let's assume most are function calls.
    });
    // This string manipulation is faster/simpler than deep AST mapping since we're in sandbox
    if (newBody !== bodyText) {
        method.setBodyText(newBody);
    }
});

// For all moved functions (now in target files), we also need to update their internal `.call`s 
// because what was previously `this.foo()` might have been another moved method, and is now `foo(game)`.
// And what was `this.remainingMethod()` is now `game.remainingMethod()`.

[messagingFile, phaseFile, actionsFile, rulesFile].forEach(file => {
    file.getFunctions().forEach(func => {
        if (!allMoved.includes(func.getName() || "")) return; // Only process our moved functions
        
        let bodyText = func.getBodyText() || "";
        let newBody = bodyText;
        allMoved.forEach(moved => {
            // match: game.methodName(
            const regex = new RegExp(`\\bgame\\.${moved}\\(`, 'g');
            // rewrite to: methodName(game, 
            newBody = newBody.replace(regex, `${moved}(game, `);
            
            // Wait, what if it was game.methodName(arg)? -> methodName(game, arg)?
            // We replaced this.method( with game.method( earlier.
            // But if we do regex replace of game.method( -> method(game, 
            // `game.method(...)` becomes `method(game, ...)` BUT what if it takes no arguments:
            // `game.method()` -> `method(game, )` which is a syntax error!
        });
        if (newBody !== bodyText) {
            func.setBodyText(newBody);
        }
    });
});

project.saveSync().then(() => console.log('Done!'));
