import { resolve as resolvePath } from "node:path";
import { readFile, stat } from "node:fs/promises";
import { RouteContext } from "./context";
import { sendJson } from "./utils";

const transpiledClientModuleCache = new Map<string, { mtimeMs: number; outputText: string }>();
let typeScriptCompilerPromise: Promise<any | null> | null = null;
const moduleRoot = resolvePath(__dirname, "../../../");

export async function handleResource(ctx: RouteContext, filename: string): Promise<void> {
  const resourceDir = resolvePath(moduleRoot, "resource");
  const filePath = resolvePath(resourceDir, filename);
  if (!filePath.startsWith(resourceDir)) {
    sendJson(ctx.response, 403, { error: "접근이 거부되었습니다." });
    return;
  }

  try {
    const data = await readFile(filePath);
    ctx.response.statusCode = 200;
    let contentType = "application/octet-stream";
    if (filename.endsWith(".svg")) contentType = "image/svg+xml";
    else if (filename.endsWith(".png")) contentType = "image/png";
    else if (filename.endsWith(".mp3")) contentType = "audio/mpeg";
    ctx.response.setHeader("content-type", contentType);
    ctx.response.setHeader("cache-control", "public, max-age=86400, immutable");
    ctx.response.end(data);
  } catch {
    sendJson(ctx.response, 404, { error: "리소스를 찾을 수 없습니다." });
  }
}

export async function handleClientAsset(ctx: RouteContext, filename: string): Promise<void> {
  if (filename.endsWith(".js")) {
    const transpiled = await transpileClientModule(filename);
    if (transpiled) {
      ctx.response.statusCode = 200;
      ctx.response.setHeader("content-type", "application/javascript; charset=utf-8");
      ctx.response.setHeader("cache-control", "no-store");
      ctx.response.end(transpiled);
      return;
    }
  }

  // __dirname 은 mafia/src/web/routes/ 또는 mafia/dist/web/routes/
  const candidateDirs = [
    resolvePath(__dirname, "../client"),
    resolvePath(moduleRoot, "src/web/client"),
    resolvePath(moduleRoot, "dist/web/client"),
  ];

  for (const clientDir of candidateDirs) {
    const filePath = resolvePath(clientDir, filename);
    if (!filePath.startsWith(clientDir)) {
      sendJson(ctx.response, 403, { error: "접근이 거부되었습니다." });
      return;
    }

    try {
      const data = await readFile(filePath);
      ctx.response.statusCode = 200;
      let contentType = "application/octet-stream";
      if (filename.endsWith(".js")) contentType = "application/javascript";
      else if (filename.endsWith(".css")) contentType = "text/css";
      ctx.response.setHeader("content-type", contentType);
      ctx.response.setHeader("cache-control", "no-store");
      ctx.response.end(data);
      return;
    } catch {
      // 다음 후보 경로를 확인한다.
    }
  }

  sendJson(ctx.response, 404, { error: "클라이언트 자산을 찾을 수 없습니다." });
}

async function transpileClientModule(filename: string): Promise<string | null> {
  const sourcePath = resolvePath(moduleRoot, "src/web/client", filename.replace(/\.js$/u, ".ts"));

  try {
    const sourceStat = await stat(sourcePath);
    const cached = transpiledClientModuleCache.get(sourcePath);
    if (cached && cached.mtimeMs === sourceStat.mtimeMs) {
      return cached.outputText;
    }

    const typeScript = await loadTypeScriptCompiler();
    if (!typeScript) {
      return null;
    }

    const sourceText = await readFile(sourcePath, "utf8");
    const transpiled = typeScript.transpileModule(sourceText, {
      compilerOptions: {
        target: typeScript.ScriptTarget.ES2022,
        module: typeScript.ModuleKind.ES2022,
        moduleResolution: typeScript.ModuleResolutionKind.Bundler,
      },
      fileName: sourcePath,
    }).outputText;

    transpiledClientModuleCache.set(sourcePath, {
      mtimeMs: sourceStat.mtimeMs,
      outputText: transpiled,
    });

    return transpiled;
  } catch {
    return null;
  }
}

async function loadTypeScriptCompiler(): Promise<any | null> {
  if (!typeScriptCompilerPromise) {
    typeScriptCompilerPromise = import("typescript")
      .then((module) => module.default ?? module)
      .catch(() => null);
  }

  return typeScriptCompilerPromise;
}
