import assert from "node:assert/strict";
import { test } from "node:test";
import { createServer } from "node:http";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { chromium } from "playwright";
import { renderResumePdf } from "../../../apps/job-hunt-hq/app/tools/resume-pdf.mjs";
const exec = promisify(execFile);

test("reviewed PDF tool creates selectable Chinese A4 text without page scripts or network", async () => {
  const directory = await mkdtemp(join(tmpdir(), "job-hunt-pdf-"));
  let requests = 0;
  const server = createServer((_request, response) => { requests++; response.end("blocked input"); });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = `http://127.0.0.1:${server.address().port}`;
  const previous = process.env.CODESHELL_PDF_BROWSER;
  process.env.CODESHELL_PDF_BROWSER = chromium.executablePath();
  try {
    const result = await renderResumePdf({
      action: "resume-pdf",
      html: `<main class="resume-paper resume-print-paper" data-template="technical"><h1>示例候选人 · Example Candidate</h1><h2>项目经验</h2><p>中文可选择文本，核验公开简历。</p><div class="resume-point-proof">PRIVATE EVIDENCE</div><button>PRIVATE CONTROL</button><iframe src="${address}/frame"></iframe><script>document.querySelector('h1').textContent='SCRIPT EXECUTED';fetch('${address}/script')</script><style>@import url('${address}/style');</style><meta http-equiv="refresh" content="0;url=${address}/navigate"><a href="javascript:alert(1)">Public link</a></main>`,
    }, { directory });
    const bytes = await readFile(join(directory, "resume.pdf"));
    assert.equal(result.artifacts[0].sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(result.artifacts[0].bytes, bytes.length);
    assert.equal(requests, 0);
    const { stdout: text } = await exec("pdftotext", [join(directory, "resume.pdf"), "-"]);
    assert.match(text, /Example Candidate/);
    assert.match(text, /项目经验/);
    assert.doesNotMatch(text, /SCRIPT EXECUTED/);
    assert.doesNotMatch(text, /PRIVATE EVIDENCE|PRIVATE CONTROL/);
    const { stdout: info } = await exec("pdfinfo", [join(directory, "resume.pdf")]);
    assert.match(info, /Page size:.*A4/);
    assert.deepEqual((await readdir(directory)).sort(), ["resume.pdf"]);
    console.log(`PDF visual evidence: ${directory}/resume.pdf`);
  } finally {
    if (previous === undefined) delete process.env.CODESHELL_PDF_BROWSER;
    else process.env.CODESHELL_PDF_BROWSER = previous;
    await new Promise((resolve) => server.close(resolve));
    if (process.env.KEEP_PDF_EVIDENCE !== "1") await rm(directory, { recursive: true, force: true });
  }
});

test("PDF input and cancellation fail before writing an output", async () => {
  const directory = await mkdtemp(join(tmpdir(), "job-hunt-pdf-invalid-"));
  try {
    await assert.rejects(renderResumePdf({ action: "resume-pdf", html: "x", path: "/tmp/unsafe" }, { directory }), /格式/);
    await assert.rejects(renderResumePdf({ action: "resume-pdf", html: "x" }, { directory, signal: AbortSignal.abort() }), /取消/);
    assert.deepEqual(await readdir(directory), []);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

async function withBrowser(run) {
  const directory = await mkdtemp(join(tmpdir(), "job-hunt-pdf-case-"));
  const previous = process.env.CODESHELL_PDF_BROWSER;
  process.env.CODESHELL_PDF_BROWSER = chromium.executablePath();
  try { await run(directory); }
  finally {
    if (previous === undefined) delete process.env.CODESHELL_PDF_BROWSER;
    else process.env.CODESHELL_PDF_BROWSER = previous;
    await rm(directory, { recursive: true, force: true });
  }
}

test("unsupported or broken photos fail visibly without a misleading PDF", async () => withBrowser(async (directory) => {
  for (const source of ["https://example.invalid/photo.jpg", "file:///etc/passwd", "data:image/png;base64,AAAA"]) {
    await assert.rejects(renderResumePdf({ action: "resume-pdf", html: `<img src="${source}">` }, { directory }), /简历照片/);
    assert.deepEqual(await readdir(directory), []);
  }
}));

test("packaged print layout paginates long Chinese resumes with an embedded photo", async () => withBrowser(async (directory) => {
  const photo = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=";
  const content = Array.from({ length: 100 }, (_, index) => `<li>项目经验 ${index + 1}：公开内容与中文排版核验。</li>`).join("");
  await renderResumePdf({ action: "resume-pdf", html: `<main class="resume-paper resume-print-paper" data-template="classic"><div class="resume-photo-slot"><img src="${photo}" alt="示例照片"></div><h1>示例候选人</h1><h2>项目经验</h2><ul>${content}</ul><p>LAST PUBLIC LINE</p></main>` }, { directory });
  const path = join(directory, "resume.pdf");
  const { stdout: info } = await exec("pdfinfo", [path]);
  assert.ok(Number(info.match(/Pages:\s+(\d+)/)?.[1]) >= 2);
  const { stdout: text } = await exec("pdftotext", [path, "-"]);
  assert.match(text, /项目经验 100/);
  assert.match(text, /LAST PUBLIC LINE/);
  const { stdout: images } = await exec("pdfimages", ["-list", path]);
  assert.match(images, /image/);
}));

test("cancelling an active browser removes its profile and leaves no PDF", async () => withBrowser(async (directory) => {
  const controller = new AbortController();
  const task = renderResumePdf({ action: "resume-pdf", html: "<main>cancel me</main>" }, { directory, signal: controller.signal });
  // Attach rejection immediately while waiting for the actual process profile.
  const checked = assert.rejects(task, /取消/);
  void checked.catch(() => {});
  let active = false;
  for (let attempt = 0; attempt < 100; attempt++) {
    const profiles = (await readdir(directory)).filter((name) => name.startsWith(".pdf-browser-"));
    if (profiles.length && (await readdir(join(directory, profiles[0]))).length) { active = true; break; }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  controller.abort();
  await checked;
  assert.equal(active, true, "browser must have started before cancellation");
  assert.deepEqual(await readdir(directory), []);
}));

test("an existing output is never replaced", async () => withBrowser(async (directory) => {
  await writeFile(join(directory, "resume.pdf"), "preserved original");
  await assert.rejects(renderResumePdf({ action: "resume-pdf", html: "<main>replacement</main>" }, { directory }), /EEXIST/);
  assert.equal(await readFile(join(directory, "resume.pdf"), "utf8"), "preserved original");
  assert.deepEqual(await readdir(directory), ["resume.pdf"]);
}));

test("installed entry accepts the Host stdin envelope and returns a capturable artifact", async () => withBrowser(async (directory) => {
  const child = spawn(process.execPath, [fileURLToPath(new URL("../../../apps/job-hunt-hq/app/tools/resume-pdf.mjs", import.meta.url)), "--job-dir", directory], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const exited = new Promise((resolve, reject) => { child.once("error", reject); child.once("exit", resolve); });
  child.stdin.end(JSON.stringify({ action: "resume-pdf", html: '<main class="resume-paper resume-print-paper"><h1>公开简历</h1><p>CLI output</p></main>',
    source: { resumeId: "resume-a", updatedAt: "2026-09-27T00:00:00Z" }, jobId: "job-test", scopeKey: "test-scope" }));
  assert.equal(await exited, 0, stderr || stdout);
  const messages = stdout.trim().split("\n").map((line) => JSON.parse(line));
  assert.equal(messages.length, 1);
  assert.equal(messages[0].type, "result");
  const artifact = messages[0].result.artifacts[0];
  const bytes = await readFile(join(directory, artifact.file));
  assert.equal(artifact.assetId, "asset-" + createHash("sha256").update(bytes).digest("hex"));
  assert.equal(artifact.mimeType, "application/pdf");
}));
