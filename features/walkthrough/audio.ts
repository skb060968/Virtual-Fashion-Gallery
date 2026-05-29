// features/walkthrough/audio.ts — minimal audio manager for the
// gallery experience.
//
// Two channels:
//   1. "ambience" — a low-volume, looping pad that plays while the
//      visitor is `entryStage === "inside"`. Establishes the
//      acoustic feel of the boutique room.
//   2. "doorWhoosh" — a one-shot played on the entry-stage
//      "foyer" → "entering" transition (the moment the doors begin
//      to slide).
//
// Browsers gate `<audio>` autoplay behind a user gesture; the entry
// overlay's "Step inside" button click is exactly such a gesture, so
// the manager defers actual element creation until first-use. This
// keeps SSR safe (no `Audio` constructor on the server) and quietly
// no-ops if the source files are missing — the gallery still works
// in silence.
//
// Asset locations expected (drop files here, they're optional):
//   /public/sounds/gallery-ambience.mp3
//   /public/sounds/door-whoosh.mp3

const AMBIENCE_SRC = "/sounds/gallery-ambience.mp3";
const DOOR_WHOOSH_SRC = "/sounds/door-whoosh.mp3";

const AMBIENCE_VOLUME = 0.18;
const DOOR_WHOOSH_VOLUME = 0.55;

type AudioState = {
  ambience: HTMLAudioElement | null;
  doorWhoosh: HTMLAudioElement | null;
  initialised: boolean;
  ambiencePlaying: boolean;
};

const state: AudioState = {
  ambience: null,
  doorWhoosh: null,
  initialised: false,
  ambiencePlaying: false,
};

/**
 * Lazily allocate the underlying `HTMLAudioElement`s on first call.
 * Safe to call repeatedly — subsequent calls are no-ops.
 *
 * Must be invoked from a user-gesture handler (click / tap) so the
 * browser allows the eventual `play()` calls to succeed. The entry
 * overlay's "Step inside" handler in `EntryOverlay.tsx` is the
 * standard call site.
 */
export function initGalleryAudio(): void {
  if (state.initialised) return;
  if (typeof window === "undefined" || typeof Audio === "undefined") return;
  state.initialised = true;

  try {
    const ambience = new Audio(AMBIENCE_SRC);
    ambience.loop = true;
    ambience.volume = AMBIENCE_VOLUME;
    ambience.preload = "auto";
    state.ambience = ambience;
  } catch {
    state.ambience = null;
  }

  try {
    const doorWhoosh = new Audio(DOOR_WHOOSH_SRC);
    doorWhoosh.loop = false;
    doorWhoosh.volume = DOOR_WHOOSH_VOLUME;
    doorWhoosh.preload = "auto";
    state.doorWhoosh = doorWhoosh;
  } catch {
    state.doorWhoosh = null;
  }
}

/**
 * Play the door whoosh one-shot. Resets currentTime so a rapid
 * second trigger restarts the sample cleanly. Silent no-op if the
 * file is missing or the element failed to construct.
 */
export function playDoorWhoosh(): void {
  initGalleryAudio();
  const el = state.doorWhoosh;
  if (!el) return;
  try {
    el.currentTime = 0;
    void el.play().catch(() => {
      // Browser refused playback (autoplay policy edge case). The
      // gallery degrades silently — no error surface.
    });
  } catch {
    // Element entered an inconsistent state (e.g. cross-origin lock).
    // Silently ignore.
  }
}

/**
 * Start the ambience loop if not already playing. Idempotent.
 */
export function startAmbience(): void {
  initGalleryAudio();
  const el = state.ambience;
  if (!el || state.ambiencePlaying) return;
  try {
    void el.play().then(
      () => {
        state.ambiencePlaying = true;
      },
      () => {
        // Autoplay rejected; will retry on next user interaction
        // through whatever caller triggers `startAmbience` again.
      },
    );
  } catch {
    // Ignore.
  }
}

/**
 * Pause the ambience loop. Call when the visitor leaves the gallery
 * surface (e.g. navigates to /contact). Idempotent.
 */
export function stopAmbience(): void {
  const el = state.ambience;
  if (!el) return;
  try {
    el.pause();
    state.ambiencePlaying = false;
  } catch {
    // Ignore.
  }
}
