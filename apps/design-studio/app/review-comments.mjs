import { isSafeDesignPath } from "./document.mjs";
import { projectContextKey } from "./project-context.mjs";

export const REVIEW_COMMENTS_FORMAT = "codeshell.design.comments";
export const MAX_REVIEW_COMMENT_TEXT = 10_000;
export const MAX_REVIEW_COMMENTS_BYTES = 2 * 1024 * 1024;
const MAX_THREADS = 1_000;
const MAX_REPLIES = 200;

export function reviewCommentsPath(designPath) {
  if (!isSafeDesignPath(designPath)) throw Error("评论需要 designs/ 下的 .codesign.json 设计路径");
  return designPath.replace(/\.codesign\.json$/u, ".comments.json");
}

function contextOf(snapshot) {
  return snapshot.context ?? snapshot;
}

// Epochs cancel a reload even when the next document has the same path. Drafts
// intentionally use the stable project/path key so returning restores the text.
export function reviewDraftKey(snapshot) {
  return JSON.stringify([projectContextKey(contextOf(snapshot)), snapshot.path]);
}

export function reviewScopeKey(snapshot) {
  return JSON.stringify([
    reviewDraftKey(snapshot),
    snapshot.workspaceEpoch ?? null,
    snapshot.documentEpoch ?? null,
  ]);
}

function fail(message) {
  throw Error(`评论文件无法读取：${message}`);
}
function identifier(value) {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 160 &&
    !/[\u0000-\u001f\u007f]/u.test(value)
  );
}
function textField(value, label, maximum = MAX_REVIEW_COMMENT_TEXT) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum)
    fail(`${label} 必须是 1–${maximum} 个字符`);
}
function timestamp(value) {
  if (typeof value !== "string" || value.length > 40 || !Number.isFinite(Date.parse(value)))
    fail("时间格式无效");
}
function message(value, ids) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    !identifier(value.id) ||
    ids.has(value.id)
  )
    fail("评论 ID 无效或重复");
  ids.add(value.id);
  textField(value.text, "评论");
  textField(value.author, "署名", 120);
  timestamp(value.createdAt);
}

export function parseReviewComments(source, designPath) {
  reviewCommentsPath(designPath);
  if (
    typeof source !== "string" ||
    new TextEncoder().encode(source).length > MAX_REVIEW_COMMENTS_BYTES
  )
    fail("文件超过 2 MiB 或内容无效");
  let value;
  try {
    value = JSON.parse(source);
  } catch {
    fail("JSON 格式无效；已有内容已保留");
  }
  if (
    value?.format !== REVIEW_COMMENTS_FORMAT ||
    value.version !== 1 ||
    value.designPath !== designPath
  )
    fail("文件不是当前设计的评论记录；已有内容已保留");
  if (!Array.isArray(value.threads) || value.threads.length > MAX_THREADS) fail("讨论数量超过限制");
  const ids = new Set();
  for (const thread of value.threads) {
    message(thread, ids);
    if (!identifier(thread.pageId) || (thread.nodeId !== null && !identifier(thread.nodeId)))
      fail("评论目标无效");
    if (thread.targetName !== undefined) textField(thread.targetName, "目标名称", 500);
    if (thread.status !== "open" && thread.status !== "resolved") fail("讨论状态无效");
    timestamp(thread.updatedAt);
    if (!Array.isArray(thread.replies) || thread.replies.length > MAX_REPLIES)
      fail("回复数量超过限制");
    for (const reply of thread.replies) message(reply, ids);
  }
  return value;
}

export function isMissingReviewFile(error) {
  const code = error?.code ?? error?.error?.code;
  return (
    ["ENOENT", "NOT_FOUND", "WORKSPACE_PATH_NOT_FOUND", "FILE_NOT_FOUND"].includes(code) ||
    /^(?:file (?:not found|missing)|文件不存在)(?:$|[:：\s])/iu.test(error?.message ?? "")
  );
}

function isConflict(error) {
  return (
    ["CONFLICT", "WORKSPACE_CONFLICT", "EEXIST", "STALE_WRITE"].includes(error?.code) ||
    /changed since|file changed|file exists|已存在|文件已.*变更|版本冲突/iu.test(
      error?.message ?? "",
    )
  );
}

export class StaleReviewScopeError extends Error {
  constructor() {
    super("项目或设计文件已切换，旧评论操作已停止；草稿会保留");
    this.code = "STALE_REVIEW_SCOPE";
  }
}

function uniqueId() {
  return `comment-${globalThis.crypto.randomUUID()}`;
}

export function createReviewCommentsStore({
  getSnapshot,
  call,
  now = () => new Date().toISOString(),
  id = uniqueId,
  getOperationEpoch = () => null,
}) {
  function capture() {
    const snapshot = getSnapshot();
    const key = reviewScopeKey(snapshot),
      operationEpoch = getOperationEpoch();
    reviewCommentsPath(snapshot.path);
    const check = () => {
      const current = getSnapshot();
      if (reviewScopeKey(current) !== key || getOperationEpoch() !== operationEpoch)
        throw new StaleReviewScopeError();
      if (current.ready === false || contextOf(current).trusted === false)
        throw Error("当前项目尚未准备好，请稍后重试评论操作");
    };
    check();
    return { snapshot, key, check, path: reviewCommentsPath(snapshot.path) };
  }

  async function read(operation) {
    operation.check();
    let result;
    try {
      result = await call("workspace.readText", { path: operation.path });
    } catch (error) {
      operation.check();
      if (!isMissingReviewFile(error)) throw error;
      return {
        document: {
          format: REVIEW_COMMENTS_FORMAT,
          version: 1,
          designPath: operation.snapshot.path,
          threads: [],
        },
        expectedModifiedAt: null,
      };
    }
    operation.check();
    if (result?.path !== undefined && result.path !== operation.path)
      throw Error("Host 返回了其他路径的评论记录");
    const document = parseReviewComments(result?.content, operation.snapshot.path);
    const expectedRevision =
      typeof result.revision === "string" && result.revision.length > 0
        ? result.revision
        : undefined;
    const expectedModifiedAt =
      typeof result.modifiedAt === "number" && Number.isFinite(result.modifiedAt)
        ? result.modifiedAt
        : undefined;
    if (expectedRevision === undefined && expectedModifiedAt === undefined)
      throw Error("Host 未提供评论文件版本，无法安全保存；已有内容已保留");
    return { document, expectedRevision, expectedModifiedAt };
  }

  async function mutate(operation, apply) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const baseline = await read(operation);
      operation.check();
      const document = baseline.document;
      if (apply(document) === false)
        return { document, scopeKey: operation.key, path: operation.path };
      const content = `${JSON.stringify(document, null, 2)}\n`;
      parseReviewComments(content, operation.snapshot.path);
      operation.check();
      try {
        await call("workspace.writeText", {
          path: operation.path,
          content,
          ...(baseline.expectedModifiedAt !== undefined
            ? { expectedModifiedAt: baseline.expectedModifiedAt }
            : {}),
          ...(baseline.expectedRevision !== undefined
            ? { expectedRevision: baseline.expectedRevision }
            : {}),
        });
      } catch (error) {
        operation.check();
        if (attempt < 2 && isConflict(error)) continue;
        throw error;
      }
      operation.check();
      return { document, scopeKey: operation.key, path: operation.path };
    }
    throw Error("评论文件正在被其他窗口修改，请重试；草稿已保留");
  }

  function newMessage(text, author = "本地评审") {
    const value = { id: id(), text: String(text ?? "").trim(), author, createdAt: now() };
    message(value, new Set());
    return value;
  }
  return {
    async refresh() {
      const operation = capture(),
        result = await read(operation);
      return { document: result.document, scopeKey: operation.key, path: operation.path };
    },
    async addThread({ pageId, nodeId = null, targetName, text, author }) {
      const operation = capture();
      if (!identifier(pageId) || (nodeId !== null && !identifier(nodeId)))
        throw Error("请选择有效的页面或图层");
      const root = newMessage(text, author);
      const thread = {
        ...root,
        pageId,
        nodeId,
        ...(targetName ? { targetName } : {}),
        status: "open",
        updatedAt: root.createdAt,
        replies: [],
      };
      return mutate(operation, (document) => {
        if (document.threads.some((item) => item.id === thread.id)) return false;
        document.threads.push(thread);
      });
    },
    async reply(threadId, text, author) {
      const operation = capture(),
        reply = newMessage(text, author);
      return mutate(operation, (document) => {
        const thread = document.threads.find((item) => item.id === threadId);
        if (!thread) throw Error("这条讨论已在外部移除，回复草稿已保留");
        if (thread.replies.some((item) => item.id === reply.id)) return false;
        thread.replies.push(reply);
        thread.updatedAt = reply.createdAt;
      });
    },
    async setResolved(threadId, resolved) {
      const operation = capture(),
        updatedAt = now();
      return mutate(operation, (document) => {
        const thread = document.threads.find((item) => item.id === threadId);
        if (!thread) throw Error("这条讨论已在外部移除，请刷新列表");
        const status = resolved ? "resolved" : "open";
        if (thread.status === status) return false;
        thread.status = status;
        thread.updatedAt = updatedAt;
      });
    },
  };
}
