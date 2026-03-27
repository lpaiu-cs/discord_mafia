import { Project } from "ts-morph";

const project = new Project({ tsConfigFilePath: "tsconfig.json" });

const sources = project.getSourceFiles();

// Fix imports to GameRegistry and InMemoryGameRegistry
sources.forEach(sf => {
    let touched = false;
    const imports = sf.getImportDeclarations();
    imports.forEach(imp => {
        if (imp.getModuleSpecifierValue() === "../game/game" || imp.getModuleSpecifierValue() === "./game") {
            const named = imp.getNamedImports();
            const toMoveToRegistry: string[] = [];
            const toMoveToModel: string[] = [];
            
            for (const n of named) {
                const name = n.getName();
                if (name === "GameRegistry" || name === "InMemoryGameRegistry" || name === "createGame") {
                    toMoveToRegistry.push(name);
                    n.remove();
                    touched = true;
                } else if (["NightSelectionRequest", "NightSelectionResult", "PromptDefinition", "AftermathChoice", "WebChatMessage", "WebPrivateLogEntry", "VisibleAudioCue", "QueuedAudioCue", "createPlayer", "resolveMemberDisplayName", "formatDayBreakLabel", "shuffle", "hasActiveNightAction", "stringifyPrivatePayload"].includes(name)) {
                    toMoveToModel.push(name);
                    n.remove();
                    touched = true;
                }
            }

            if (toMoveToRegistry.length > 0) {
                sf.addImportDeclaration({
                    namedImports: toMoveToRegistry,
                    moduleSpecifier: imp.getModuleSpecifierValue().replace("game", "registry") // e.g. ./game -> ./registry or ../game/game -> ../game/registry
                });
            }
            if (toMoveToModel.length > 0) {
                sf.addImportDeclaration({
                    namedImports: toMoveToModel,
                    moduleSpecifier: imp.getModuleSpecifierValue().replace("game", "model") 
                });
            }
        }
    });
});

project.saveSync();
