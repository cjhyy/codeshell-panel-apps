import { parseTransactions } from "../portfolio.mjs";
import { parseNewsFeed } from "../news-feed.mjs";

// The Notes page needs only the local sources used by its saved links. Loading
// those sources must not initialize News, quote collection or historical returns.
export async function readNoteReferences(notes, { hostCall, expectedEpoch, currentEpoch, signal } = {}) {
  const check = () => {
    if (signal?.aborted || currentEpoch() !== expectedEpoch) throw new Error("笔记关联项目已切换");
  };
  const links = notes.flatMap(note => note.links);
  const sources = [
    { key: "ledger", path: "portfolio/transactions.json", needed: links.some(link => ["instrument", "transaction"].includes(link.type)), parse: text => parseTransactions(text).ledger },
    { key: "news", path: "data/news/feed.json", needed: links.some(link => link.type === "news"), parse: parseNewsFeed },
  ].filter(source => source.needed);
  const context = { unavailableSources: {} }, errors = [];
  await Promise.all(sources.map(async source => {
    try {
      check();
      const directory = source.path.slice(0, source.path.lastIndexOf("/"));
      const listing = await hostCall("workspace.list", { path: directory }, { owner: "notes-references", priority: "interactive", signal });
      check();
      if (!Array.isArray(listing?.entries)) throw new Error("目录读取结果无效");
      const entry = listing.entries.find(entry => entry && (entry.path === source.path || `${directory}/${entry.name}` === source.path));
      if (!entry) {
        if (listing.truncated) throw new Error("目录结果不完整，无法确认关联是否存在");
        context[source.key] = null;
        return;
      }
      if (entry.kind !== "file") throw new Error("关联源路径不是普通文件");
      const file = await hostCall("workspace.readText", { path: source.path }, { owner: "notes-references", priority: "interactive", signal });
      check();
      if (typeof file?.content !== "string") throw new Error("文件读取结果无效");
      context[source.key] = source.parse(file.content);
    } catch (error) {
      check();
      context.unavailableSources[source.key] = true;
      errors.push(`${source.path}：${error.message}`);
    }
  }));
  check();
  return { context, errors };
}
