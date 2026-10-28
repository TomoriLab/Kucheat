import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const source = join(root, "ui");
const output = join(root, "target", "frontend");
const compiler = join(root, "node_modules", "typescript", "bin", "tsc");

if (!existsSync(compiler)) {
  throw new Error("TypeScript is not installed. Run npm ci before building the GUI.");
}

rmSync(output, { recursive: true, force: true });
execFileSync(process.execPath, [compiler, "--project", join(root, "tsconfig.json")], {
  cwd: root,
  stdio: "inherit",
});

function copyAssets(directory: string, destination: string): void {
  mkdirSync(destination, { recursive: true });
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "tests") continue;
    const input = join(directory, entry.name);
    const target = join(destination, entry.name);
    if (entry.isDirectory()) {
      copyAssets(input, target);
    } else if (/\.(html|css|svg|png|woff2?)$/u.test(entry.name)) {
      cpSync(input, target);
    }
  }
}

copyAssets(source, output);
copyAssets(join(root, "assets", "icons"), join(output, "assets", "icons"));
console.log("Built TypeScript frontend in target/frontend.");
