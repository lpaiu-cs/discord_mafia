import { Project } from "ts-morph";

const project = new Project({ tsConfigFilePath: "tsconfig.json" });

project.getSourceFiles().forEach(sf => {
    sf.fixMissingImports();
    sf.fixUnusedIdentifiers();
});

project.saveSync();
console.log("Imports fixed");