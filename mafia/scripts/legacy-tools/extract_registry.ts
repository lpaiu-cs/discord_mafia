import { Project, SyntaxKind } from "ts-morph";

const project = new Project({ tsConfigFilePath: "tsconfig.json" });

const gameFile = project.getSourceFileOrThrow("src/game/game.ts");
const modelFile = project.getSourceFileOrThrow("src/game/model.ts");
// We can create `src/game/registry.ts`
const registryFile = project.createSourceFile("src/game/registry.ts", "", { overwrite: true });

// Move Interfaces to model.ts
const interfacesToMove = [
    "NightSelectionRequest", "NightSelectionResult", "PromptDefinition",
    "AftermathChoice", "WebChatMessage", "WebPrivateLogEntry",
    "VisibleAudioCue", "QueuedAudioCue"
];

interfacesToMove.forEach(name => {
    const intf = gameFile.getInterface(name);
    if (intf) {
        modelFile.addInterface({
            name: intf.getName(),
            isExported: true,
            properties: intf.getProperties().map(p => ({
                name: p.getName(),
                type: p.getTypeNode()?.getText() || "any",
                hasQuestionToken: p.hasQuestionToken()
            }))
        });
        intf.remove();
    }
});

// Move GameRegistry, InMemoryGameRegistry, createGame to registry.ts
const registryIntf = gameFile.getInterface("GameRegistry");
if (registryIntf) {
    registryFile.addInterface({
        name: registryIntf.getName(),
        isExported: true,
        properties: registryIntf.getProperties().map(p => ({
            name: p.getName(),
            type: p.getTypeNode()?.getText() || "any",
            hasQuestionToken: p.hasQuestionToken(),
            // Wait, GameRegistry has methods, not just properties!
        })),
        methods: registryIntf.getMethods().map(m => ({
            name: m.getName(),
            returnType: m.getReturnTypeNode()?.getText(),
            parameters: m.getParameters().map(p => ({
                name: p.getName(),
                type: p.getTypeNode()?.getText()
            }))
        }))
    });
    registryIntf.remove();
}

const registryClass = gameFile.getClass("InMemoryGameRegistry");
if (registryClass) {
    registryFile.addClass({
        name: registryClass.getName(),
        isExported: true,
        implements: registryClass.getImplements().map(i => i.getText()),
        properties: registryClass.getProperties().map(p => ({
            name: p.getName(),
            type: p.getTypeNode()?.getText(),
            initializer: p.getInitializer()?.getText(),
            scope: p.getScope(),
            isReadonly: p.isReadonly()
        })),
        methods: registryClass.getMethods().map(m => ({
            name: m.getName(),
            isAsync: m.isAsync(),
            parameters: m.getParameters().map(p => ({name: p.getName(), type: p.getTypeNode()?.getText()})),
            returnType: m.getReturnTypeNode()?.getText(),
            statements: m.getBodyText()
        }))
    });
    registryClass.remove();
}

// Move utility functions to maybe model.ts or keep in game.ts
const funcsToMove = [
    "createGame", "createPlayer", "resolveMemberDisplayName", "formatDayBreakLabel",
    "shuffle", "hasActiveNightAction", "stringifyPrivatePayload"
];
// Move to registry.ts (createGame), model.ts (the rest)
funcsToMove.forEach(name => {
    const fn = gameFile.getFunction(name);
    if (!fn) return;
    
    const targetFile = (name === "createGame") ? registryFile : modelFile;
    targetFile.addFunction({
        name: fn.getName(),
        isExported: true,
        isAsync: fn.isAsync(),
        parameters: fn.getParameters().map(p => ({name: p.getName(), type: p.getTypeNode()?.getText(), initializer: p.getInitializer()?.getText()})),
        returnType: fn.getReturnTypeNode()?.getText(),
        statements: fn.getBodyText()
    });
    fn.remove();
});

project.saveSync();
