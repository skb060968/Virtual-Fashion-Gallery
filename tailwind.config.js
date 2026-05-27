/**
 * Tailwind CSS 3 configuration (Requirement 11.3).
 *
 * Scans the App Router (`app/`), shared UI (`components/`), and the
 * walkthrough feature module (`features/`) for class usage. Tests and
 * library helpers do not emit DOM, so they are intentionally excluded.
 */
/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,jsx,ts,tsx,mdx}",
    "./components/**/*.{js,jsx,ts,tsx,mdx}",
    "./features/**/*.{js,jsx,ts,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Surface dark gallery palette via CSS variables defined in
        // `app/globals.css`, so utility classes like `bg-gallery-bg`
        // resolve to the same tokens used by raw CSS.
        "gallery-bg": "var(--gallery-bg)",
        "gallery-surface": "var(--gallery-surface)",
        "gallery-fg": "var(--gallery-fg)",
        "gallery-muted": "var(--gallery-muted)",
        "gallery-accent": "var(--gallery-accent)",
      },
      fontFamily: {
        // Wired by `app/layout.tsx` via `next/font/google` (Req 11.4).
        display: ["var(--font-display)", "system-ui", "sans-serif"],
        body: ["var(--font-body)", "system-ui", "sans-serif"],
      },
      ringColor: {
        focus: "var(--focus-ring-color)",
      },
      ringOffsetColor: {
        focus: "var(--focus-ring-offset)",
      },
    },
  },
  plugins: [],
};
