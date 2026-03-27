import { mkdir, copyFile, rm } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ts = require("typescript");

const scriptDir = dirname(fileURLToPath(import.meta.url));
const moduleRoot = resolve(scriptDir, "..");
const configPath = resolve(moduleRoot, "src/web/client/tsconfig.json");
const distClientDir = resolve(moduleRoot, "dist/web/client");

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

if (parsedConfig.options.tsBuildInfoFile) {
  await mkdir(dirname(parsedConfig.options.tsBuildInfoFile), { recursive: true });
}

const builder = ts.createIncrementalProgram({
  rootNames: parsedConfig.fileNames,
  options: parsedConfig.options,
});
const program = builder.getProgram();
const emitResult = builder.emit();
const diagnostics = ts.getPreEmitDiagnostics(program).concat(emitResult.diagnostics);

if (diagnostics.length > 0) {
  reportDiagnostics(diagnostics);
}

if (emitResult.emitSkipped) {
  process.exit(1);
}

await mkdir(distClientDir, { recursive: true });
await copyFile(resolve(moduleRoot, "src/web/client/app.css"), resolve(distClientDir, "app.css"));

function reportDiagnostics(diagnostics) {
  const host = {
    getCanonicalFileName: (fileName) => fileName,
    getCurrentDirectory: () => moduleRoot,
    getNewLine: () => "\n",
  };
  const output = ts.formatDiagnosticsWithColorAndContext(diagnostics, host);
  if (output) {
    console.error(output);
  }
}
