import { spawnSync } from "node:child_process";
import { extname, join } from "node:path";
import { listFiles, repositoryRoot } from "../panel-projects.mjs";

// Cover every runtime module, including source-built packages and Node tools.
// Discovery keeps newly added apps and lazy chunks inside the same syntax gate.
export async function validateSyntax(packages) {
for (const packagePath of packages) {
  const appRoot = join(repositoryRoot, packagePath, "app");
  for (const file of await listFiles(appRoot)) {
    if (![".js", ".mjs"].includes(extname(file))) continue;
    const parsed = spawnSync(process.execPath, ["--check", join(appRoot, file)], { encoding: "utf8" });
    if (parsed.status !== 0) {
      throw new Error(`${packagePath}/app/${file} failed to parse:\n${parsed.stderr.trim()}`);
    }
  }
}

}
