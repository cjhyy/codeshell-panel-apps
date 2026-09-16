import { source, sha256 } from "panel-browser:editor-renderer";
import { runEditorCli } from "./editor-runtime/cli.js";

await runEditorCli({ runtimeSource: source, runtimeSha: sha256 });
