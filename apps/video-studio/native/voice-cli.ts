import { runCli } from "./voice-runtime.js";

let request: unknown;
try {
  request = JSON.parse(process.argv.slice(2).join("") || "null");
} catch {
  request = null;
}
await runCli(request);
