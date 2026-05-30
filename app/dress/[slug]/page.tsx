/**
 * Dress Detail Page — `/dress/[slug]`
 *
 * Statically generated at build time for every dress slug in the
 * `sketches` catalogue. Reads and validates the corresponding
 * `meta.json` via `loadDressMeta`, then renders the dress name,
 * cover image, formatted price, available sizes, and description.
 *
 * Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 4.1
 */

import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { FOCUS_RING_CLASS } from "@/components/FocusRing";
import { isDressRecord, loadDressMeta, formatRupees } from "@/lib/dress-meta";
import { sketches } from "@/lib/sketches";

// ---------------------------------------------------------------------------
// Static params — one entry per dress slug in the catalogue (Req 3.2)
// ---------------------------------------------------------------------------

export function generateStaticParams(): Array<{ slug: string }> {
  return sketches
    .filter((record) => isDressRecord(record.id))
    .map((record) => ({ slug: record.id }));
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const meta = await loadDressMeta(slug);
  if (!meta) return { title: "Not Found" };
  return {
    title: `${meta.name} — GP Fashion`,
    description: meta.description || `View details for ${meta.name} by GP Fashion.`,
  };
}

// ---------------------------------------------------------------------------
// Page component
// ---------------------------------------------------------------------------

export default async function DressDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const meta = await loadDressMeta(slug);

  // Req 3.1 — unknown slug → 404
  if (!meta) {
    notFound();
  }

  const coverSrc = `/images/shop/items/${slug}/${slug}-cover.webp`;
  const formattedPrice = formatRupees(meta.price);
  const hasDescription = meta.description.length > 0;

  return (
    <main className="min-h-screen w-full bg-[#f5f5f4] text-stone-900">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-12">

        {/* Back navigation (Req 4.1) */}
        <nav aria-label="Dress detail navigation">
          <Link
            href="/"
            className={`inline-flex w-fit items-center gap-2 text-sm font-display uppercase tracking-[0.2em] text-stone-500 transition-colors hover:text-stone-900 ${FOCUS_RING_CLASS}`}
            data-testid="back-to-gallery"
          >
            <span aria-hidden="true">←</span>
            Back to gallery
          </Link>
        </nav>

        {/* Main content grid */}
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">

          {/* Cover image (Req 2.6) */}
          <div className="relative aspect-[3/4] w-full overflow-hidden rounded-lg bg-stone-200 shadow-md">
            <Image
              src={coverSrc}
              alt={meta.name}
              fill
              sizes="(min-width: 1024px) 50vw, 100vw"
              className="object-cover"
              priority
              data-testid="dress-cover-image"
            />
          </div>

          {/* Metadata panel */}
          <div className="flex flex-col justify-center gap-6">

            {/* Name (Req 2.1) */}
            <h1
              className="font-display text-4xl tracking-tight text-stone-900"
              data-testid="dress-name"
            >
              {meta.name}
            </h1>

            {/* Price (Req 2.2) */}
            <p
              className="font-display text-2xl text-amber-700"
              data-testid="dress-price"
            >
              {formattedPrice}
            </p>

            {/* Sizes (Req 2.3) */}
            <div className="flex flex-col gap-2">
              <p className="font-display text-xs uppercase tracking-[0.2em] text-stone-500">
                Available sizes
              </p>
              <ul
                className="flex flex-wrap gap-2"
                aria-label="Available sizes"
                data-testid="dress-sizes"
              >
                {meta.sizes.map((size) => (
                  <li
                    key={size}
                    className="rounded border border-stone-300 bg-white px-3 py-1 font-body text-sm text-stone-800 shadow-sm"
                    data-testid="dress-size"
                  >
                    {size}
                  </li>
                ))}
              </ul>
            </div>

            {/* Description — suppressed when empty (Req 2.4, 2.5) */}
            {hasDescription ? (
              <p
                className="font-body text-base leading-relaxed text-stone-700"
                data-testid="dress-description"
              >
                {meta.description}
              </p>
            ) : null}

          </div>
        </div>
      </div>
    </main>
  );
}
