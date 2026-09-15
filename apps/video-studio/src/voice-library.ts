/** Voice recipes refer to Host-managed media, never filesystem paths or project-local asset IDs. */
export interface VoiceRecipe {
  id: string;
  name: string;
  modelId: string;
  referenceMediaId: string;
  referenceText: string;
  sampleMediaId: string;
  sampleText: string;
}

export interface VoiceLibraryReference {
  mediaId: string;
  name: string;
  durationSeconds: number;
}

export interface LibraryVoiceRecipe extends VoiceRecipe {
  referenceName: string;
  referenceDurationSeconds: number;
}

export interface VoiceLibrary {
  schemaVersion: 1;
  scope: string;
  recipes: LibraryVoiceRecipe[];
}

export const VOICE_LIBRARY_KEY = "video-studio-voice-library-v1";
export const VOICE_LIBRARY_LIMIT = 20;
export const voiceEngines = ["audio8-tts", "qwen3-tts"] as const;
export const isVoiceMediaId = (value: unknown): value is string =>
  typeof value === "string" && /^(?:asset|external)-[a-f0-9]{64}$/.test(value);
export const isVoiceText = (value: unknown, max: number): value is string =>
  typeof value === "string" && Array.from(value).length <= max;

export function validVoiceRecipe(value: unknown, library = false): value is VoiceRecipe {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const recipe = value as LibraryVoiceRecipe;
  const keys = [
    "id",
    "name",
    "modelId",
    "referenceMediaId",
    "referenceText",
    "sampleMediaId",
    "sampleText",
    ...(library ? ["referenceName", "referenceDurationSeconds"] : []),
  ];
  return (
    isVoiceText(recipe.id, 80) &&
    !!recipe.id &&
    isVoiceText(recipe.name, 80) &&
    !!recipe.name.trim() &&
    voiceEngines.includes(recipe.modelId as (typeof voiceEngines)[number]) &&
    isVoiceMediaId(recipe.referenceMediaId) &&
    isVoiceMediaId(recipe.sampleMediaId) &&
    isVoiceText(recipe.referenceText, 1000) &&
    !!recipe.referenceText.trim() &&
    isVoiceText(recipe.sampleText, 120) &&
    !!recipe.sampleText.trim() &&
    Object.keys(recipe).every((key) => keys.includes(key)) &&
    (!library ||
      (isVoiceText(recipe.referenceName, 256) &&
        !!recipe.referenceName.trim() &&
        Number.isFinite(recipe.referenceDurationSeconds) &&
        recipe.referenceDurationSeconds >= 3 &&
        recipe.referenceDurationSeconds <= 30))
  );
}

export const emptyVoiceLibrary = (scope: string): VoiceLibrary => ({
  schemaVersion: 1,
  scope,
  recipes: [],
});

export function validateVoiceLibrary(value: unknown, scope: string): VoiceLibrary {
  const data = value as VoiceLibrary;
  if (
    !data ||
    typeof data !== "object" ||
    Array.isArray(data) ||
    data.schemaVersion !== 1 ||
    data.scope !== scope ||
    !Array.isArray(data.recipes) ||
    data.recipes.length > VOICE_LIBRARY_LIMIT ||
    Object.keys(data).some((key) => !["schemaVersion", "scope", "recipes"].includes(key)) ||
    data.recipes.some((recipe) => !validVoiceRecipe(recipe, true)) ||
    new Set(data.recipes.map((recipe) => recipe.id)).size !== data.recipes.length
  )
    throw new Error("声音库无法恢复，原记录已保留。请恢复声音库后重试。");
  return structuredClone(data);
}

/** Read again before each addition so another project's saved voices are retained. */
export function mergeVoiceLibrary(
  library: VoiceLibrary,
  recipes: LibraryVoiceRecipe[],
  replaceMedia = false,
): VoiceLibrary {
  const next = structuredClone(library);
  for (const recipe of recipes) {
    const existing = next.recipes.find((item) => item.id === recipe.id);
    if (existing) {
      const same = Object.keys(existing).every(
        (key) =>
          existing[key as keyof LibraryVoiceRecipe] === recipe[key as keyof LibraryVoiceRecipe],
      );
      if (!same) {
        // Importing an app-wide copy may turn an external reference into a captured asset.
        // Only its current-workspace media mapping may change; the confirmed voice stays identical.
        const stable = ["id", "name", "modelId", "referenceText", "sampleText"] as const;
        if (!replaceMedia || !stable.every((key) => existing[key] === recipe[key]))
          throw new Error("声音库中已有同编号的不同声音，原记录已保留，请重新创建声音。");
        next.recipes[next.recipes.indexOf(existing)] = structuredClone(recipe);
      }
      continue;
    }
    if (next.recipes.length >= VOICE_LIBRARY_LIMIT)
      throw new Error(`声音库最多保存 ${VOICE_LIBRARY_LIMIT} 个声音。`);
    next.recipes.push(structuredClone(recipe));
  }
  return validateVoiceLibrary(next, library.scope);
}
