import { execFileSync } from "node:child_process";

const experiments = {
  "owned-preview": {
    commit: "a5f6352bba817062e00b5e1dee80fa000719dd53",
    baseline: "9a22855f8defe3fb1ed6235cf87065e20f6b1223",
    script: "scripts/video-studio-owned-preview-prototype.mjs",
  },
  "timeline-media-plan": {
    commit: "61f7beaccf173b298d7e12d2e3e00184f8434bf8",
    baseline: "b2ad2d20866dad9e51a88e8a279edc1cf41af001",
    script: "scripts/video-studio-timeline-media-plan-prototype.mjs",
  },
  "timeline-owned-plan": {
    commit: "ff32d42a4dccd195beb20bd365b3000607096d3c",
    baseline: "b2ad2d20866dad9e51a88e8a279edc1cf41af001",
    script: "scripts/video-studio-timeline-owned-plan-prototype.mjs",
  },
};

function experiment(id) {
  const value = experiments[id];
  if (!value) throw new Error(`Unknown historical Video Studio experiment: ${id}`);
  return value;
}

export function historicalResearchUsage(id) {
  const value = experiment(id);
  const directory = `/tmp/video-studio-${id}-history`;
  return [
    "Historical Video Studio research from 2026-10-12; not a current-main benchmark.",
    `Original source baseline: ${value.baseline}`,
    "Restore the original experiment in a fresh, separate directory:",
    `  git worktree add --detach ${directory} ${value.commit}`,
    `  cd ${directory}`,
    "  npm ci",
    `  node ${value.script}`,
    "Requires the historical npm dependencies and Playwright Chromium; timeline media experiments also require FFmpeg and ffprobe.",
    "See docs/history/video-studio-research-2026-10-12.md for modes and interpretation.",
  ].join("\n");
}

export function assertHistoricalResearchBaseline(id, root) {
  const value = experiment(id);
  const git = (...args) =>
    execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  let head;
  try {
    head = git("rev-parse", "HEAD");
  } catch {
    throw new Error(`Cannot identify the historical source checkout.\n${historicalResearchUsage(id)}`);
  }
  if (head !== value.commit && head !== value.baseline) {
    throw new Error(
      `This experiment uses historical source anchors and cannot run at ${head}.\n${historicalResearchUsage(id)}`,
    );
  }
  try {
    git(
      "diff",
      "--quiet",
      value.baseline,
      "--",
      "apps/video-studio",
      "tests",
      "package.json",
      "package-lock.json",
      "scripts/run-typescript-tests.mjs",
    );
  } catch {
    throw new Error(
      `Historical application, fixture or dependency files have changed. Restore a clean baseline.\n${historicalResearchUsage(id)}`,
    );
  }
}
