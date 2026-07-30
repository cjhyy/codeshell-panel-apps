import { getHtml2figmaCase } from "./cases.mjs";

const fixture = document.querySelector("#fixture");
const qaState = document.documentElement.dataset;
const qaParams = new URLSearchParams(location.search);
const caseId = qaParams.get("case");
const mode = qaParams.get("mode") ?? "source";

qaState.qaStage = "setup";
try {
  const testCase = getHtml2figmaCase(caseId);
  if (!testCase) throw new Error(`Unknown html2figma parity case: ${caseId}`);

  const sourceReflow = mode === "source-reflow";
  const targetWidth = sourceReflow ? testCase.reflowWidth : testCase.width;
  fixture.style.width = `${targetWidth}px`;
  fixture.style.height = `${testCase.height}px`;
  fixture.innerHTML = testCase.html;

  const { captureHtmlToDesign } =
    await import("../../../apps/design-studio/app/html-capture.mjs?html2figma-cases=1");
  const { exportDesignSvg, normalizeDesignDocument, serializeDesignDocument } =
    await import("../../../apps/design-studio/app/document.mjs");
  const { auditDesign, summarizeAudit } = await import(
    "../../../apps/design-studio/app/audit.mjs"
  );
  const { applyAllAutoLayouts } = await import("../../../apps/design-studio/app/layout.mjs");

  qaState.qaStage = "fonts";
  await document.fonts.ready;
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

  qaState.qaStage = "capture";
  const captured = await captureHtmlToDesign(fixture, {
    name: `html2figma parity · ${testCase.name}`,
  });
  const normalized = normalizeDesignDocument(captured);

  if (mode === "converted-reflow") {
    const root = normalized.nodes.find((node) => !node.parentId);
    if (!root) throw new Error(`Captured case ${caseId} has no root node`);
    const widthDelta = root.width - testCase.reflowWidth;
    root.width = testCase.reflowWidth;
    normalized.canvas.width = Math.max(1, normalized.canvas.width - widthDelta);
    applyAllAutoLayouts(normalized.nodes);
  }

  const auditIssues = auditDesign(normalized);
  const audit = summarizeAudit(auditIssues);
  const normalizedById = new Map(normalized.nodes.map((node) => [node.id, node]));
  qaState.qaIssueCount = String(audit.issueCount);
  qaState.qaBlockingIssueCount = String(audit.blockingIssueCount);
  qaState.qaIssueCodes = JSON.stringify(
    auditIssues.reduce((counts, issue) => {
      counts[issue.code] = (counts[issue.code] ?? 0) + 1;
      return counts;
    }, {}),
  );
  qaState.qaNodeCount = String(normalized.nodes.length);
  qaState.qaAutoLayoutCount = String(
    normalized.nodes.filter(
      (node) =>
        ["frame", "group", "component"].includes(node.type) &&
        ["horizontal", "vertical", "grid"].includes(node.layout),
    ).length,
  );
  qaState.qaGridLayoutCount = String(
    normalized.nodes.filter((node) => node.layout === "grid").length,
  );
  qaState.qaWrapLayoutCount = String(
    normalized.nodes.filter((node) =>
      ["wrap", "wrap-reverse"].includes(node.layoutWrap),
    ).length,
  );
  qaState.qaReverseLayoutCount = String(
    normalized.nodes.filter(
      (node) => node.layoutReverse === true || node.layoutWrap === "wrap-reverse",
    ).length,
  );
  qaState.qaBaselineLayoutCount = String(
    normalized.nodes.filter((node) => node.alignItems === "baseline").length,
  );
  qaState.qaMinMaxNodeCount = String(
    normalized.nodes.filter((node) =>
      ["minWidth", "maxWidth", "minHeight", "maxHeight"].some(
        (property) => node[property] !== undefined,
      ),
    ).length,
  );
  qaState.qaAbsoluteAutoChildCount = String(
    normalized.nodes.filter(
      (node) =>
        node.layoutPositioning === "absolute" &&
        ["horizontal", "vertical", "grid"].includes(normalizedById.get(node.parentId)?.layout),
    ).length,
  );
  const serialized = serializeDesignDocument(normalized);
  const data = document.createElement("script");
  data.id = "qa-design";
  data.type = "application/json";
  data.textContent = serialized;
  document.head.append(data);

  if (mode === "converted" || mode === "converted-reflow") {
    document.body.innerHTML = exportDesignSvg(normalized);
    document.body.querySelector("svg")?.setAttribute("data-qa-render", "converted");
  }
} catch (error) {
  qaState.qaError = error instanceof Error ? error.stack : String(error);
  console.error(error);
}
qaState.qaStage = "done";
qaState.qaReady = "true";
