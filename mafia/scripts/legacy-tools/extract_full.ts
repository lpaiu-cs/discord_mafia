import { Project, SyntaxKind, MethodDeclaration, Node, SyntaxList } from "ts-morph";

const project = new Project({ tsConfigFilePath: "tsconfig.json" });

const gameFile = project.getSourceFileOrThrow("src/game/game.ts");
const messagingFile = project.getSourceFileOrThrow("src/game/messaging.ts");
const phaseFile = project.getSourceFileOrThrow("src/game/phase.ts");
const actionsFile = project.getSourceFileOrThrow("src/game/actions.ts");
const rulesFile = project.getSourceFileOrThrow("src/game/rules.ts");

const gameClass = gameFile.getClassOrThrow("MafiaGame");

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
    "assertAliveParticipant", "canReadChat", "canWriteChat", "getPlayer", "getPlayerOrThrow", "hasParticipant",
    "bumpStateVersion"
];

const movePlan: { [key: string]: any } = {};
toMessaging.forEach(m => movePlan[m] = messagingFile);
toPhase.forEach(m => movePlan[m] = phaseFile);
toActions.forEach(m => movePlan[m] = actionsFile);
toRules.forEach(m => movePlan[m] = rulesFile);

const allMoved = Object.keys(movePlan);

const filesToProcess = [gameFile, messagingFile, phaseFile, actionsFile, rulesFile];
const allFiles = project.getSourceFiles();

// Replace call sites everywhere FIRST
allFiles.forEach(file => {
    const callExprs = file.getDescendantsOfKind(SyntaxKind.CallExpression);
    // process backwards
    for (let i = callExprs.length - 1; i >= 0; i--) {
        const callExpr = callExprs[i];
        const expr = callExpr.getExpression();
        if (expr.getKind() === SyntaxKind.PropertyAccessExpression) {
            const propAccess = expr.asKindOrThrow(SyntaxKind.PropertyAccessExpression);
            const methodName = propAccess.getName();

            // Replace `<expr>.methodName(args)` with `methodName(<expr>, args)`
            if (allMoved.includes(methodName)) {
                
                let gameRef = propAccess.getExpression().getText();
                // Special case: if calling within same class
                // gameRef will be "this"

                const argsArray = callExpr.getArguments().map(a => a.getText());
                if (argsArray.length > 0) {
                    callExpr.replaceWithText(`${methodName}(${gameRef}, ${argsArray.join(", ")})`);
                } else {
                    callExpr.replaceWithText(`${methodName}(${gameRef})`);
                }
            }
        }
    }
});

// Now that `this.foo()` is replaced by `foo(this)`, extract the methods
allMoved.forEach(methodName => {
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
    
    // Convert property accesses: `this.state` -> `game.state`
    // but keep `this` in function params or something? Mostly just `this.` is sufficient, and standalone `this`.
    // We already moved method calls to `foo(this)`. Now they became `foo(game)` if we replace `\bthis\b`.
    bodyText = bodyText.replace(/\bthis\b/g, "game");

    const targetFile = movePlan[methodName];
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
});

project.saveSync();
console.log('Successfully completed full extraction... now run tsc to fix imports');
