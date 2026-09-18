import assert from "node:assert/strict";
import { test } from "node:test";
import {
  parseIndexedSearchRss,
  parseYouTubeSearchHtml,
  searchExternalSources,
} from "../../../apps/video-download/app/tools/search.mjs";

const youtubeId = "dQw4w9WgXcQ";
const biliId = "BV1xx411c7mD";
const youtubeHtml = `<script id="yt-initial-data" type="application/json">${JSON.stringify({
  contents: [
    { videoRenderer: { videoId: youtubeId, title: { runs: [{ text: "Blender & AI" }] }, ownerText: { runs: [{ text: "Creator" }] }, lengthText: { simpleText: "12:34" } } },
    { videoRenderer: { videoId: "invalid", title: { simpleText: "Wrong" } } },
  ],
})}</script>`;
const biliRss = `<?xml version="1.0"?><rss><channel>
  <item><title>Blender &amp; AI 教程</title><link>https://www.bilibili.com/video/${biliId}/?spm=search</link></item>
  <item><title>Impersonator</title><link>https://www.bilibili.com.evil.example/video/${biliId}/</link></item>
  <item><title>Duplicate</title><link>https://www.bilibili.com/video/${biliId}/</link></item>
</channel></rss>`;

test("public YouTube search page yields only canonical videos with real page metadata", () => {
  assert.deepEqual(parseYouTubeSearchHtml(youtubeHtml), [{
    title: "Blender & AI",
    url: `https://www.youtube.com/watch?v=${youtubeId}`,
    platform: "youtube",
    author: "Creator",
    duration: "12:34",
    evidence: "platform-search",
  }]);
  assert.deepEqual(parseYouTubeSearchHtml('<title>Consent required</title>'), []);
  assert.equal(parseYouTubeSearchHtml(`<script>var ytInitialData = ${youtubeHtml.match(/<script[^>]*>([\s\S]*?)<\/script>/)[1]};</script>`).length, 1);
});

test("search-index links are bounded, canonical and explicitly marked unverified", () => {
  assert.deepEqual(parseIndexedSearchRss(biliRss, "bilibili"), [{
    title: "Blender & AI 教程",
    url: `https://www.bilibili.com/video/${biliId}/`,
    platform: "bilibili",
    author: "",
    duration: "",
    evidence: "search-index",
  }]);
});

test("YouTube uses the platform page first; an unavailable page falls back to the index", async () => {
  const requests = [];
  const fetcher = async (url) => {
    requests.push(url.toString());
    return new Response(requests.length === 1 ? "<title>Unavailable</title>" : biliRss.replaceAll("bilibili.com/video/" + biliId + "/", "youtube.com/watch?v=" + youtubeId), { status: 200 });
  };
  const result = await searchExternalSources({ platform: "youtube", query: "Blender AI", limit: 3 }, fetcher);
  assert.equal(requests.length, 2);
  assert.equal(new URL(requests[0]).hostname, "www.youtube.com");
  assert.equal(new URL(requests[1]).hostname, "www.bing.com");
  assert.equal(result.source, "search-index");
  assert.equal(result.candidates[0].url, `https://www.youtube.com/watch?v=${youtubeId}`);
});

test("Bilibili fallback sends only a fixed search request and rejects invalid input", async () => {
  const requests = [];
  const result = await searchExternalSources({ platform: "bilibili", query: "Blender AI", limit: 8 }, async (url) => {
    requests.push(url.toString());
    return new Response(biliRss, { status: 200 });
  });
  assert.equal(requests.length, 1);
  assert.equal(new URL(requests[0]).hostname, "www.bing.com");
  assert.equal(result.candidates[0].evidence, "search-index");
  await assert.rejects(searchExternalSources({ platform: "file", query: "x", limit: 8 }));
  await assert.rejects(searchExternalSources({ platform: "youtube", query: "x".repeat(301), limit: 8 }));
});

test("a long Bilibili query retries with shorter terms and follows only Bing's regional redirect", async () => {
  const requests = [];
  const result = await searchExternalSources({
    platform: "bilibili", query: "Blender与AI的关系 AI辅助建模 工作流", limit: 8,
  }, async (url) => {
    requests.push(url.toString());
    if (requests.length === 1) return new Response("<rss/>", { status: 200 });
    if (requests.length === 2) return new Response("", {
      status: 302,
      headers: { location: url.toString().replace("www.bing.com", "cn.bing.com") },
    });
    return new Response(biliRss, { status: 200 });
  });
  assert.equal(requests.length, 3);
  assert.match(new URL(requests[1]).searchParams.get("q"), /^Blender AI site:/);
  assert.equal(new URL(requests[2]).hostname, "cn.bing.com");
  assert.equal(result.candidates[0].url, `https://www.bilibili.com/video/${biliId}/`);
  await assert.rejects(searchExternalSources({ platform: "bilibili", query: "Blender AI", limit: 8 }, async () =>
    new Response("", { status: 302, headers: { location: "https://evil.example/search" } })
  ));
});
