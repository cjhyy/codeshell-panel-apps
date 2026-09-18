import { realpath } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const MAX_INPUT_BYTES = 4_096;
const MAX_RESPONSE_BYTES = 3_000_000;
const MAX_RESULTS = 8;

function clean(value, limit) {
  return typeof value === "string"
    ? value.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, limit)
    : "";
}

function validateRequest(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid-request");
  if (Object.keys(value).some((key) => !["platform", "query", "limit"].includes(key)))
    throw new Error("invalid-request");
  const platform = value.platform;
  const query = clean(value.query, 300);
  const limit = value.limit;
  if (
    !["youtube", "bilibili"].includes(platform) ||
    !query ||
    typeof value.query !== "string" ||
    value.query.length > 300 ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > MAX_RESULTS
  )
    throw new Error("invalid-request");
  return { platform, query, limit };
}

function runs(value) {
  return clean(value?.runs?.map((part) => part?.text || "").join("") || value?.simpleText, 300);
}

export function parseYouTubeSearchHtml(html, limit = MAX_RESULTS) {
  if (typeof html !== "string" || html.length > MAX_RESPONSE_BYTES) return [];
  const script = html.match(/<script\b[^>]*\bid=["']yt-initial-data["'][^>]*>([\s\S]*?)<\/script>/i);
  let json = script?.[1];
  if (!json) {
    const marker = "var ytInitialData = ";
    const start = html.indexOf(marker);
    if (start < 0) return [];
    const open = html.indexOf("{", start + marker.length);
    if (open < 0 || open - (start + marker.length) > 10) return [];
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let index = open; index < html.length; index++) {
      const character = html[index];
      if (quoted) {
        if (escaped) escaped = false;
        else if (character === "\\") escaped = true;
        else if (character === '"') quoted = false;
      } else if (character === '"') quoted = true;
      else if (character === "{") depth++;
      else if (character === "}" && --depth === 0) {
        json = html.slice(open, index + 1);
        break;
      }
    }
  }
  if (!json) return [];
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    return [];
  }
  const results = [];
  const seen = new Set();
  function visit(value, depth = 0) {
    if (!value || typeof value !== "object" || depth > 40 || results.length >= limit) return;
    const video = value.videoRenderer;
    if (video) {
      const id = video.videoId;
      const title = runs(video.title);
      if (typeof id === "string" && /^[\w-]{11}$/.test(id) && title && !seen.has(id)) {
        seen.add(id);
        results.push({
          title,
          url: `https://www.youtube.com/watch?v=${id}`,
          platform: "youtube",
          author: runs(video.ownerText || video.longBylineText).slice(0, 160),
          duration: runs(video.lengthText).slice(0, 40),
          evidence: "platform-search",
        });
      }
      return;
    }
    for (const child of Object.values(value)) visit(child, depth + 1);
  }
  visit(data);
  return results;
}

function decodeXml(value) {
  return String(value || "").replace(/&(#(?:x[\da-f]+|\d+)|amp|lt|gt|quot|apos);/gi, (match, entity) => {
    const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
    if (!entity.startsWith("#")) return named[entity.toLowerCase()] || match;
    const code = entity[1]?.toLowerCase() === "x"
      ? Number.parseInt(entity.slice(2), 16)
      : Number.parseInt(entity.slice(1), 10);
    return Number.isInteger(code) && code > 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : match;
  });
}

export function parseIndexedSearchRss(xml, platform, limit = MAX_RESULTS) {
  if (typeof xml !== "string" || xml.length > MAX_RESPONSE_BYTES) return [];
  const results = [];
  const seen = new Set();
  for (const match of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const title = clean(decodeXml(match[1].match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]), 300);
    const link = decodeXml(match[1].match(/<link\b[^>]*>([\s\S]*?)<\/link>/i)?.[1]).trim();
    let target;
    try {
      target = new URL(link);
    } catch {
      continue;
    }
    if (target.protocol !== "https:" || target.username || target.password || target.port) continue;
    let url = "";
    if (platform === "youtube" && ["youtube.com", "www.youtube.com", "m.youtube.com"].includes(target.hostname)) {
      const id = target.pathname === "/watch" ? target.searchParams.get("v") : null;
      if (id && /^[\w-]{11}$/.test(id)) url = `https://www.youtube.com/watch?v=${id}`;
    } else if (platform === "bilibili" && ["bilibili.com", "www.bilibili.com", "m.bilibili.com"].includes(target.hostname)) {
      const id = target.pathname.match(/^\/video\/(BV[A-Za-z0-9]{10}|av\d+)\/?$/)?.[1];
      if (id) url = `https://www.bilibili.com/video/${id}/`;
    }
    if (!title || !url || seen.has(url)) continue;
    seen.add(url);
    results.push({ title, url, platform, author: "", duration: "", evidence: "search-index" });
    if (results.length >= limit) break;
  }
  return results;
}

async function readText(response) {
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_RESPONSE_BYTES) throw new Error("response-too-large");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("empty-response");
  const decoder = new TextDecoder();
  let text = "";
  let bytes = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error("response-too-large");
    }
    text += decoder.decode(value, { stream: true });
  }
  return text + decoder.decode();
}

async function requestText(url, fetcher = fetch) {
  const options = {
    redirect: "manual",
    signal: AbortSignal.timeout(15_000),
    headers: { "user-agent": "Mozilla/5.0 (compatible; CodeShellVideoSearch/1.0)" },
  };
  let response = await fetcher(url, options);
  if ([301, 302, 307, 308].includes(response.status)) {
    const redirect = new URL(response.headers.get("location") || "", url);
    if (
      url.hostname !== "www.bing.com" ||
      redirect.protocol !== "https:" ||
      redirect.hostname !== "cn.bing.com" ||
      redirect.pathname !== "/search" ||
      redirect.username || redirect.password || redirect.port
    ) throw new Error("unexpected-redirect");
    response = await fetcher(redirect, options);
  }
  return readText(response);
}

export async function searchExternalSources(value, fetcher = fetch) {
  const { platform, query, limit } = validateRequest(value);
  if (platform === "youtube") {
    try {
      const url = new URL("https://www.youtube.com/results");
      url.searchParams.set("search_query", query);
      const candidates = parseYouTubeSearchHtml(await requestText(url, fetcher), limit);
      if (candidates.length) return { candidates, source: "platform-search" };
    } catch {
      // A blocked page can still have public search-index links below.
    }
  }
  const latinTerms = [...new Set(query.match(/[A-Za-z][A-Za-z0-9-]*/g) || [])].slice(0, 4);
  const shorter = latinTerms.length >= 2
    ? latinTerms.join(" ")
    : query.split(/\s+/).slice(0, 2).join(" ");
  const queries = [...new Set([query, shorter])];
  const candidates = [];
  for (const terms of queries) {
    const url = new URL("https://www.bing.com/search");
    url.searchParams.set("format", "rss");
    url.searchParams.set("q", `${terms} site:${platform === "youtube" ? "youtube.com/watch" : "bilibili.com/video"}`);
    try {
      const found = parseIndexedSearchRss(await requestText(url, fetcher), platform, limit);
      for (const candidate of found) {
        if (!candidates.some((existing) => existing.url === candidate.url)) candidates.push(candidate);
        if (candidates.length >= limit) break;
      }
    } catch (error) {
      if (terms === queries.at(-1) && !candidates.length) throw error;
    }
    if (candidates.length >= limit) break;
  }
  return { candidates, source: "search-index" };
}

async function readInput(stream) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.byteLength;
    if (size > MAX_INPUT_BYTES) throw new Error("request-too-large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("invalid-json");
  }
}

const directEntry = process.argv[1] && (await realpath(process.argv[1]).catch(() => null));
if (directEntry && import.meta.url === pathToFileURL(directEntry).href) {
  try {
    process.stdout.write(`${JSON.stringify(await searchExternalSources(await readInput(process.stdin)))}\n`);
  } catch (error) {
    process.stdout.write(`${JSON.stringify({ error: clean(error?.message, 200) || "search-failed" })}\n`);
    process.exitCode = 1;
  }
}
