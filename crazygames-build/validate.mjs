import { readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const required = [
  '<html lang="en">',
  'crazygames-sdk-v3.js',
  'await window.CrazyGames.SDK.init()',
  'SDK.data.setItem(\'skyengine-world-v1\'',
  'cgGameplayStart();',
  'cgGameplayStop();',
  'GOAL: Build a shelter.',
  'id="loginGate"'
];
for (const marker of required) {
  if (!html.includes(marker)) {
    console.error("Missing required release feature:", marker);
    process.exit(1);
  }
}
const modules = [...html.matchAll(/<script type="module">([\\s\\S]*?)<\\/script>/g)];
if (modules.length !== 1) {
  console.error("Expected exactly one game module script; found", modules.length);
  process.exit(1);
}
const tempFile = join(tmpdir(), "skyengine-crazygames-module-check.mjs");
writeFileSync(tempFile, modules[0][1]);
const check = spawnSync(process.execPath, ["--check", tempFile], { stdio: "inherit" });
if (check.status !== 0) process.exit(check.status ?? 1);
console.log("SKYENGINE CrazyGames release checks passed.");
