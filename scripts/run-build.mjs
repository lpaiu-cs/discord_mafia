import { spawn } from "node:child_process";
import { hrtime } from "node:process";

const debug = process.argv.includes("--debug");
const npmExecPath = process.env.npm_execpath;
const nodeExecPath = process.env.npm_node_execpath || process.execPath;

if (!npmExecPath) {
  console.error("[build] npm 실행 경로를 찾을 수 없습니다.");
  process.exit(1);
}

const steps = [
  { script: "build:clean", label: "clean dist" },
  { script: "build:types", label: "typescript compile" },
  { script: "build:web-client", label: "web client compile" },
];

const totalStartedAt = hrtime.bigint();

if (debug) {
  console.log(`[build:debug] cwd=${process.cwd()}`);
  console.log(`[build:debug] node=${process.version}`);
  console.log(`[build:debug] npm_execpath=${npmExecPath}`);
}

for (const [index, step] of steps.entries()) {
  const startedAt = hrtime.bigint();
  console.log(`[build] ${index + 1}/${steps.length} ${step.script} (${step.label})`);
  await runNpmScript(step.script);
  const elapsedMs = Number(hrtime.bigint() - startedAt) / 1_000_000;
  console.log(`[build] completed ${step.script} in ${formatDuration(elapsedMs)}`);
}

const totalElapsedMs = Number(hrtime.bigint() - totalStartedAt) / 1_000_000;
console.log(`[build] done in ${formatDuration(totalElapsedMs)}`);

function runNpmScript(script) {
  return new Promise((resolve, reject) => {
    const child = spawn(nodeExecPath, [npmExecPath, "run", script], {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit",
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`${script} 가 signal ${signal} 로 종료되었습니다.`));
        return;
      }

      if (code !== 0) {
        reject(new Error(`${script} 가 코드 ${code} 로 실패했습니다.`));
        return;
      }

      resolve();
    });
  });
}

function formatDuration(milliseconds) {
  if (milliseconds >= 1000) {
    return `${(milliseconds / 1000).toFixed(2)}s`;
  }

  return `${Math.round(milliseconds)}ms`;
}
