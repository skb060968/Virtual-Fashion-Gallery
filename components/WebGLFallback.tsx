"use client";

/**
 * WebGL_Fallback (Requirements 6.5, 10.4, 10.5, 10.6, 3.10, 14.6).
 *
 * Rendered by `GalleryClient` whenever `detectWebGL()` returns `false`
 * or the R3F `<Canvas onCreated>` callback throws during initialisation
 * (Req 10.4). It deliberately does NOT import `WalkthroughEngine`,
 * `three`, or any feature module from `features/walkthrough/` — that
 * import boundary is what keeps the three.js bundle out of the
 * fallback path. The only sketch data it touches is the public
 * `sketches` export from `lib/sketches.ts`, which keeps the cross-
 * surface consistency invariant (Req 14.6) trivially true: the same
 * `imageSrc` referenced here is the one used by `SketchFrame` and
 * `ZoomView` because all three surfaces read from the same module.
 *
 * Layout:
 *   - A vertical, scrollable list of cards, one per `SketchRecord` in
 *     catalogue order (Req 10.4).
 *   - Each card renders an `<img loading="lazy" alt="…" />` followed
 *     by the record's `title`, `date`, `medium`, and `description`
 *     text exactly as stored in `lib/sketches.ts` (Req 10.4, 10.6).
 *   - When a record's `description` is the empty string, the
 *     description region is not rendered at all (Req 3.10) — neither
 *     a paragraph nor an empty container is emitted, so screen
 *     readers and visual layout both collapse cleanly.
 *   - Each card is wrapped in `<ProtectedSurface>` so the
 *     Asset_Protection_Layer's `contextmenu` / `dragstart` handlers
 *     and the descendant-`<img>` user-select / user-drag suppression
 *     apply on this surface as well (Req 6.5).
 *   - A visible, keyboard-activatable contact link is rendered at
 *     both the top and the bottom of the page, each navigating to
 *     `/contact`. Both compose `FOCUS_RING_CLASS` so the visible
 *     focus indicator (Req 10.7) matches the rest of the
 *     Gallery_App, and they sit in normal document tab order so they
 *     are reachable by keyboard alone (Req 10.5, 10.1).
 *
 * Alt-text composition (Req 10.6):
 *   `alt={`${record.title} — ${record.medium}`}` uses the em dash
 *   character U+2014 between the title and medium values exactly as
 *   stored in the catalogue. The composition is intentionally
 *   templated so that Property 17 can assert byte-for-byte equality
 *   against `${title} — ${medium}` for every record.
 */

import Link from "next/link";
import { sketches } from "@/lib/sketches";
import ProtectedSurface from "@/components/ProtectedSurface";
import { FOCUS_RING_CLASS } from "@/components/FocusRing";

const CONTACT_LINK_CLASS = `inline-flex items-center justify-center rounded-md border border-white/10 bg-[var(--gallery-surface)] px-4 py-2 text-sm font-medium text-[var(--gallery-fg)] transition-opacity hover:opacity-90 ${FOCUS_RING_CLASS}`;

/**
 * Visible, keyboard-activatable contact link (Req 10.5). Rendered at
 * both the top and the bottom of the fallback page so the Visitor
 * never has to scroll the entire catalogue to reach it. We use
 * Next.js's `<Link>` so client-side navigation to `/contact` reuses
 * the same `<ContactForm/>` component as the gallery's contact entry
 * point.
 */
function ContactLink({ position }: { position: "top" | "bottom" }) {
  return (
    <Link
      href="/contact"
      className={CONTACT_LINK_CLASS}
      data-contact-link={position}
    >
      Contact the designer
    </Link>
  );
}

export function WebGLFallback() {
  return (
    <main
      data-webgl-fallback=""
      className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-10"
    >
      {/* Top contact link (Req 10.5). */}
      <header className="flex flex-col gap-4">
        <h1
          className="text-3xl font-semibold tracking-tight"
          style={{ fontFamily: "var(--font-display)" }}
        >
          Sketch catalogue
        </h1>
        <p className="text-sm text-[var(--gallery-muted)]">
          Your browser could not start the 3D walkthrough, so we are showing
          the same sketches as a static catalogue. Each entry lists the
          title, date, medium, and any accompanying description.
        </p>
        <div>
          <ContactLink position="top" />
        </div>
      </header>

      <ol className="flex flex-col gap-12" aria-label="Sketch catalogue">
        {sketches.map((record) => {
          const altText = record.medium
            ? `${record.title} \u2014 ${record.medium}`
            : record.title;
          const hasDescription = record.description.length > 0;

          return (
            <li key={record.id}>
              {/* Asset_Protection_Layer scope (Req 6.5). The wrapper
                  attaches the contextmenu / dragstart handlers and
                  ensures the descendant <img> below cannot produce a
                  drag-image preview or DataTransfer payload. */}
              <ProtectedSurface className="flex flex-col gap-4">
                <article className="flex flex-col gap-4">
                  <figure className="flex flex-col gap-3">
                    <img
                      src={record.imageSrc}
                      alt={altText}
                      loading="lazy"
                      draggable={false}
                      className="w-full rounded-md border border-white/5 bg-[var(--gallery-surface)] object-contain"
                    />
                    <figcaption className="flex flex-col gap-1">
                      <h2
                        className="text-xl font-semibold"
                        style={{ fontFamily: "var(--font-display)" }}
                      >
                        {record.title}
                      </h2>
                      <p className="text-sm text-[var(--gallery-muted)]">
                        <time dateTime={record.date}>{record.date}</time>
                        {record.medium ? (
                          <>
                            <span aria-hidden="true"> · </span>
                            <span>{record.medium}</span>
                          </>
                        ) : null}
                      </p>
                    </figcaption>
                  </figure>

                  {/*
                    Empty-description suppression (Req 3.10). When the
                    catalogue entry's `description` is the empty
                    string, no description region is rendered: not a
                    paragraph, not a wrapping container, not an
                    aria-labelled placeholder. Visual and assistive
                    layouts both collapse cleanly.
                  */}
                  {hasDescription ? (
                    <p
                      data-sketch-description={record.id}
                      className="text-sm leading-relaxed text-[var(--gallery-fg)]"
                    >
                      {record.description}
                    </p>
                  ) : null}
                </article>
              </ProtectedSurface>
            </li>
          );
        })}
      </ol>

      {/* Bottom contact link (Req 10.5). */}
      <footer className="flex flex-col items-start gap-2">
        <ContactLink position="bottom" />
      </footer>
    </main>
  );
}

export default WebGLFallback;
