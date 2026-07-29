const fixture = document.querySelector("#fixture");
const qaState = document.documentElement.dataset;
const qaParams = new URLSearchParams(location.search);
qaState.qaStage = "imports";
try {
  if (qaParams.has("seed_preview")) {
    const [sourceHtml, sourceCss] = await Promise.all([
      fetch("./index.html").then((response) => response.text()),
      fetch("./style.css").then((response) => response.text()),
    ]);
    const htmlPath = "tests/fixtures/design-studio-html-capture/index.html";
    const cssPath = "tests/fixtures/design-studio-html-capture/style.css";
    localStorage.setItem(`codeshell-design-studio:file:${htmlPath}`, sourceHtml);
    localStorage.setItem(`codeshell-design-studio:mtime:${htmlPath}`, "1000");
    localStorage.setItem(`codeshell-design-studio:file:${cssPath}`, sourceCss);
    localStorage.setItem(`codeshell-design-studio:mtime:${cssPath}`, "1000");
    qaState.qaSeedReady = "true";
  }
  const { captureHtmlToDesign } =
    await import("../../../apps/design-studio/app/html-capture.mjs?capture=9");
  const { exportDesignSvg, normalizeDesignDocument, serializeDesignDocument } =
    await import("../../../apps/design-studio/app/document.mjs");
  const { auditDesign, summarizeAudit } = await import("../../../apps/design-studio/app/audit.mjs");
  const { applyAllAutoLayouts } =
    await import("../../../apps/design-studio/app/layout.mjs");
  qaState.qaStage = "fonts";
  await document.fonts.ready;
  qaState.qaStage = "frames";
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  qaState.qaStage = "capture";
  const captured = await captureHtmlToDesign(fixture, {
    name: "CodeShell HTML fidelity fixture",
  });
  qaState.qaStage = "normalize";
  qaState.qaRawBytes = String(new TextEncoder().encode(JSON.stringify(captured)).length);
  const normalized = normalizeDesignDocument(captured);
  const mode = qaParams.get("mode") ?? "source";
  if (mode === "converted-reflow") applyAllAutoLayouts(normalized.nodes);
  const auditIssues = auditDesign(normalized);
  const audit = summarizeAudit(auditIssues);
  qaState.qaIssueCount = String(audit.issueCount);
  qaState.qaBlockingIssueCount = String(audit.blockingIssueCount);
  qaState.qaIssueCodes = JSON.stringify(
    auditIssues.reduce((counts, issue) => {
      counts[issue.code] = (counts[issue.code] ?? 0) + 1;
      return counts;
    }, {}),
  );
  qaState.qaStage = "svg";
  const svg = exportDesignSvg(normalized);

  const serialized = serializeDesignDocument(normalized);
  qaState.qaSerializedBytes = String(new TextEncoder().encode(serialized).length);
  qaState.qaNodeCount = String(normalized.nodes.length);
  qaState.qaAutoLayoutCount = String(
    normalized.nodes.filter(
      (node) =>
        ["frame", "group", "component"].includes(node.type) &&
        ["horizontal", "vertical"].includes(node.layout),
    ).length,
  );
  qaState.qaManualContainerCount = String(
    normalized.nodes.filter(
      (node) =>
        ["frame", "group", "component"].includes(node.type) && node.layout === "none",
    ).length,
  );
  const data = document.createElement("script");
  data.id = "qa-design";
  data.type = "application/json";
  data.textContent = serialized;
  document.head.append(data);

  if (mode !== "source") {
    document.body.innerHTML = svg;
    document.body.querySelector("svg")?.setAttribute("data-qa-render", "converted");
  }
} catch (error) {
  qaState.qaError = error instanceof Error ? error.stack : String(error);
  console.error(error);
}
qaState.qaStage = "done";
qaState.qaReady = "true";
