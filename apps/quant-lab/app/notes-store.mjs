import {
  NOTES_PATH,
  createEmptyNotes,
  createNote,
  parseNotes,
  serializeNotes,
} from "./notes.mjs";

function checkEpoch(expectedEpoch, currentEpoch) {
  if (typeof currentEpoch === "function" && currentEpoch() !== expectedEpoch) {
    throw new Error("workspace epoch changed; operation cancelled");
  }
}

export class NotesStoreConflictError extends Error {
  constructor(message, draft, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = "NotesStoreConflictError";
    this.frozen = true;
    this.draft = structuredClone(draft ?? null);
  }
}

async function readRaw(hostCall, epoch) {
  checkEpoch(epoch.expectedEpoch, epoch.currentEpoch);
  const listing = await hostCall("workspace.list", { path: "portfolio" });
  checkEpoch(epoch.expectedEpoch, epoch.currentEpoch);
  if (!listing || !Array.isArray(listing.entries) || listing.truncated) {
    throw new Error("portfolio listing is invalid or truncated");
  }
  const exists = listing.entries.some((item) => item?.kind === "file" && (item.path === NOTES_PATH || item.name === "journal.json"));
  if (!exists) return { exists: false, content: null, modifiedAt: null, revision: null };
  const result = await hostCall("workspace.readText", { path: NOTES_PATH });
  checkEpoch(epoch.expectedEpoch, epoch.currentEpoch);
  if (!result || typeof result.content !== "string") throw new Error("workspace.readText returned invalid notes content");
  return { exists: true, content: result.content, modifiedAt: result.modifiedAt ?? null, revision: result.revision ?? null };
}

export async function loadNotes(hostCall, { expectedEpoch, currentEpoch } = {}) {
  const file = await readRaw(hostCall, { expectedEpoch, currentEpoch });
  return { file, document: file.exists ? parseNotes(file.content) : null };
}

function sameFile(base, current) {
  if (!base || base.exists !== current.exists) return false;
  if (!base.exists) return true;
  if (base.revision != null && current.revision != null && base.revision !== current.revision) return false;
  if (base.modifiedAt != null && current.modifiedAt != null && base.modifiedAt !== current.modifiedAt) return false;
  return base.content === current.content;
}

function nextId(document, now) {
  const stem = `note-${new Date(now).toISOString().replace(/[-:.TZ]/gu, "").slice(0, 14)}`;
  if (!document.entries.some((entry) => entry.id === stem)) return stem;
  let suffix = 2;
  while (document.entries.some((entry) => entry.id === `${stem}-${suffix}`)) suffix += 1;
  return `${stem}-${suffix}`;
}

function applyChange(document, change, now) {
  const next = structuredClone(document);
  let note = null;
  if (change.type === "create") {
    note = createNote(change.draft, { id: nextId(next, now), now });
    if (next.entries.some((entry) => entry.id === note.id)) throw new Error("duplicate note id");
    next.entries.push(note);
  } else {
    const index = next.entries.findIndex((entry) => entry.id === change.id);
    if (index < 0) throw new NotesStoreConflictError("note disappeared; draft frozen", change.draft ?? change);
    const existing = next.entries[index];
    if (existing.revision !== change.expectedRevision) throw new NotesStoreConflictError("note revision changed; draft frozen", change.draft ?? change);
    if (change.type === "update") {
      note = createNote(change.draft, { id: existing.id, createdAt: existing.createdAt, now, revision: existing.revision + 1 });
      next.entries[index] = note;
    } else if (change.type === "delete") {
      next.entries.splice(index, 1);
    } else {
      throw new Error("unsupported note operation");
    }
  }
  next.updatedAt = new Date(now).toISOString();
  return { document: parseNotes(serializeNotes(next)), note };
}

export async function commitNoteChange(
  hostCall,
  change,
  { baseFile, expectedEpoch, currentEpoch, now = new Date().toISOString() } = {},
) {
  if (!change || typeof change !== "object") throw new Error("note change is required");
  const epoch = { expectedEpoch, currentEpoch };
  const current = await readRaw(hostCall, epoch);
  if (!sameFile(baseFile, current)) {
    throw new NotesStoreConflictError("portfolio/journal.json changed; draft frozen", change.draft ?? change);
  }
  let prior;
  try {
    prior = current.exists ? parseNotes(current.content) : createEmptyNotes(now);
  } catch (error) {
    throw new NotesStoreConflictError("portfolio/journal.json is invalid; draft frozen", change.draft ?? change, error);
  }
  const applied = applyChange(prior, change, now);
  const content = serializeNotes(applied.document);
  checkEpoch(expectedEpoch, currentEpoch);
  let result;
  try {
    result = await hostCall("workspace.writeText", {
      path: NOTES_PATH,
      content,
      expectedModifiedAt: current.exists ? current.modifiedAt : null,
      ...(current.exists && current.revision != null ? { expectedRevision: current.revision } : {}),
    });
  } catch (error) {
    throw new NotesStoreConflictError(error instanceof Error ? error.message : "notes write conflict", change.draft ?? change, error);
  }
  checkEpoch(expectedEpoch, currentEpoch);
  const reread = await hostCall("workspace.readText", { path: NOTES_PATH });
  checkEpoch(expectedEpoch, currentEpoch);
  if (!reread || reread.content !== content) {
    throw new NotesStoreConflictError("notes write verification failed; draft frozen", change.draft ?? change);
  }
  const document = parseNotes(reread.content);
  return {
    document,
    note: applied.note,
    file: {
      exists: true,
      content: reread.content,
      modifiedAt: reread.modifiedAt ?? result?.modifiedAt ?? null,
      revision: reread.revision ?? result?.revision ?? null,
    },
  };
}
