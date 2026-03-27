import { Project } from "ts-morph";

const project = new Project({ tsConfigFilePath: "tsconfig.json" });

const dirs = ["src/game/actions.ts", "src/game/phase.ts", "src/game/messaging.ts", "src/game/rules.ts", "src/game/resolution.ts"];

dirs.forEach(path => {
    const f = project.getSourceFile(path);
    if (!f) return;

    const seen = new Set<string>();
    const funcs = f.getFunctions();
    
    // We iterate over a copy of the list because we might remove items
    for (const func of [...funcs]) {
        const name = func.getName();
        if (name && seen.has(name)) {
            console.log(`Removing duplicate ${name} from ${path}`);
            func.remove();
        } else if (name) {
            seen.add(name);
        }
    }
});

project.saveSync();
