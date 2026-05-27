// Asset_Protection_Layer (Requirement 6) protects against casual copying only.
// Watermarking, signed URLs, and DRM are deferred to Requirement 13.6 and
// will hook in at the texture-composition seam in
// `features/walkthrough/textures/loadSketchTexture.ts` and a future signed-URL
// asset pipeline; this component intentionally does not attempt those.

"use client";

import type { CSSProperties, DragEvent, MouseEvent, ReactNode } from "react";

/**
 * `ProtectedSurface` scopes the Asset_Protection_Layer to a sketch-related
 * subtree (Sketch_Frame, Metadata_Panel, Zoom_View, WebGL_Fallback sketch
 * card). Outside this wrapper the browser's default context-menu and drag
 * behaviour is left untouched (Req 6.5, 6.6).
 *
 * Behaviour:
 * - `onContextMenu` and `onDragStart` call `preventDefault()` so right-click
 *   and touch long-press do not surface the native menu, and native drag
 *   operations produce no DataTransfer payload (Req 6.1, 6.2).
 * - Descendant `<img>` elements receive `user-select: none` and
 *   `-webkit-user-drag: none` via a Tailwind arbitrary-variant className so
 *   no drag-image preview is rendered (Req 6.2). The same selector also
 *   sets the standard `user-drag` property where supported.
 *
 * The wrapper renders a single `<div>`; consumers can pass `className` and
 * `style` to lay it out without losing the protection handlers.
 */
export type ProtectedSurfaceProps = {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
};

// Tailwind arbitrary-variant utilities applied to every descendant <img>:
//   [&_img]:select-none                 -> user-select: none
//   [&_img]:[-webkit-user-drag:none]    -> -webkit-user-drag: none
//   [&_img]:[user-drag:none]            -> user-drag: none (standard, where supported)
const PROTECTED_IMG_CLASSES =
  "[&_img]:select-none [&_img]:[-webkit-user-drag:none] [&_img]:[user-drag:none]";

export function ProtectedSurface({
  children,
  className,
  style,
}: ProtectedSurfaceProps) {
  const handleContextMenu = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const handleDragStart = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
  };

  const composedClassName = className
    ? `${PROTECTED_IMG_CLASSES} ${className}`
    : PROTECTED_IMG_CLASSES;

  return (
    <div
      data-protected-surface=""
      className={composedClassName}
      style={style}
      onContextMenu={handleContextMenu}
      onDragStart={handleDragStart}
    >
      {children}
    </div>
  );
}

export default ProtectedSurface;
