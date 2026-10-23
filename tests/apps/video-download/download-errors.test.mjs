import assert from "node:assert/strict";
import test from "node:test";
import { classifyYtDlpFailure } from "../../../apps/video-download/app/tools/download-errors.mjs";

test("source failures preserve actionable categories without reflecting private diagnostics", () => {
  for (const [diagnostic, code, message] of [
    ["Unable to download webpage: HTTP Error 412: Precondition Failed", "SOURCE_HTTP_412", /HTTP 412/],
    ["<HTTPError 412: Precondition Failed>", "SOURCE_HTTP_412", /浏览器确认视频可播放/],
    ["HTTP Error 429: Too Many Requests", "SOURCE_HTTP_429", /暂停请求/],
    ["Sign in to confirm you’re not a bot", "SOURCE_LOGIN_REQUIRED", /登录账号/],
    ["This video requires cookie verification", "SOURCE_LOGIN_REQUIRED", /有权访问/],
  ]) {
    const classified = classifyYtDlpFailure(
      `\u001b[31mERROR: ${diagnostic}\u001b[0m\nCookie: SESSDATA=private-cookie\nhttps://media.invalid/?token=private-token`,
    );
    assert.equal(classified.code, code);
    assert.equal(classified.retryable, true);
    assert.match(classified.message, message);
    assert.doesNotMatch(JSON.stringify(classified), /private-cookie|private-token|media\.invalid/);
  }
  for (const diagnostic of ["connection reset by peer", "HTTP Error 404", "token=private-cookie", ""]) {
    assert.equal(classifyYtDlpFailure(diagnostic), null);
  }
  assert.equal(
    classifyYtDlpFailure("WARNING: Sign in for additional formats\nERROR: HTTP Error 404"),
    null,
  );
  assert.equal(classifyYtDlpFailure("WARNING: HTTP Error 429"), null);
});
