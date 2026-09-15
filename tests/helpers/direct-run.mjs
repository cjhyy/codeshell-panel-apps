import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function isDirectRun(url) {
  return Boolean(process.argv[1]) && resolve(process.argv[1]) === fileURLToPath(url);
}
