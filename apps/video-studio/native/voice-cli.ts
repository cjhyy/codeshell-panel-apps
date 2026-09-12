import { runCli } from "./voice-runtime.js";

let request: unknown;
try {
  request = JSON.parse(process.argv.at(-1) ?? "null");
} catch {
  request = null;
}
await runCli(request);
