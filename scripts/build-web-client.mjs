import { mkdir, copyFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const repoRoot = process.cwd();
const configPath = resolve(repoRoot, "src/web/client/tsconfig.json");
const distClientDir = resolve(repoRoot, "dist/web/client");

await rm(distClientDir, { recursive: true, force: true });

const configFile = ts.readConfigFile(configPath, ts.sys.readFile);
if (configFile.error) {
  reportDiagnostics([configFile.error]);
  process.exit(1);
}

const parsedConfig = ts.parseJsonConfigFileContent(
  configFile.config,
  ts.sys,
  dirname(configPath),
  undefined,
  configPath,
);

if (parsedConfig.errors.length > 0) {
  reportDiagnostics(parsedConfig.errors);
  process.exit(1);
}

const program = ts.createProgram({
  rootNames: parsedConfig.fileNames,
  options: parsedConfig.options,
});
const emitResult = program.emit();
const diagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);

if (diagnostics.length > 0) {
  reportDiagnostics(diagnostics);
}

if (emitResult.emitSkipped) {
  process.exit(1);
}

await mkdir(distClientDir, { recursive: true });
await copyFile(resolve(repoRoot, "src/web/client/app.css"), resolve(distClientDir, "app.css"));

function reportDiagnostics(diagnostics) {
  const host = {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => repoRoot,
    getNewLine: () => "\n",
  };
  const output = ts.formatDiagnosticsWithColorAndContext(diagnostics, host);
  if (output) {
    console.error(output);
  }
}
