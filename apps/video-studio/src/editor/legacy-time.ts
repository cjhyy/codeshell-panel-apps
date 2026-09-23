/** Old schema-1 frames always describe 1/30 second, whatever the sequence frame rate. */
export const LEGACY_FRAME_TICKS = 8000;
/** Latest old frame position that production records accept (24 hours at 30 fps). */
export const MAX_LEGACY_FRAME = 2592000;
