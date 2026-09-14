import { createDemoProject, validateProject, type Asset, type Project } from "./model";

/** Scene identity must survive filtering, source-only previews and deleting other examples. */
export function demoSceneIndex(asset: Asset): number {
  return asset.id === "demo-city" ? 1 : asset.id === "demo-outro" ? 2 : 0;
}

export const DEMO_NARRATION_ID = "demo-narration-v1";
const narration: Asset = {
  id: DEMO_NARRATION_ID,
  name: "示例旁白 · 从想法，到成片。",
  kind: "audio",
  durationFrames: 720,
  mimeType: "audio/mpeg",
};
export function isDemoNarration(asset: Asset): boolean {
  return (
    asset.id === narration.id &&
    asset.name === narration.name &&
    asset.kind === "audio" &&
    asset.durationFrames === 720 &&
    asset.mimeType === "audio/mpeg" &&
    !asset.mediaId
  );
}
function withNarration(project: Project): Project {
  return validateProject({
    ...project,
    assets: [...project.assets, narration],
    audioClips: [
      {
        id: "demo-voiceover-v1",
        assetId: DEMO_NARRATION_ID,
        inFrame: 0,
        outFrame: 720,
        startFrame: 0,
        volume: 1,
      },
    ],
  });
}
export function createNarratedDemoProject(): Project {
  return withNarration(createDemoProject());
}

/** Only the exact untouched legacy template is eligible, never a user's edits. */
export function migratePristineDemoProject(value: Project): Project | null {
  if (value.revision !== 0 || value.audioClips?.length) return null;
  const project = validateProject(value),
    template = createDemoProject();
  if (JSON.stringify({ ...project, id: "demo" }) !== JSON.stringify({ ...template, id: "demo" }))
    return null;
  return withNarration({ ...project, revision: project.revision + 1 });
}
