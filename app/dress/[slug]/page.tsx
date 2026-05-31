/**
 * Dress Detail Page — `/dress/[slug]`
 *
 * Statically generated at build time for every dress slug in the
 * `sketches` catalogue. Reads and validates the corresponding
 * `meta.json` via `loadDressMeta`, then renders the dress name,
 * category, cover image, and description.
 */

import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";

import { FOCUS_RING_CLASS } from "@/components/FocusRing";
import { isDressRecord, loadDressMeta } from "@/lib/dress-meta";
import { sketches } from "@/lib/sketches";

// Category badge colours
const CATEGORY_STYLES: Record<string, string> = {
  WOMENSWEAR: "bg-rose-100 text-rose-800 border-rose-200",
  MENSWEAR:   "bg-sky-100 text-sky-800 border-sky-200",
  KIDSWEAR:   "bg-amber-100 text-amber-800 border-amber-200",
};

export function generateStaticParams(): Array<{ slug: string }> {
  return sketches
    .filter((record) => isDressRecord(record.id))
    .map((record) => ({ slug: record.id }));
}

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
    description:
      meta.description ||
      `${meta.category} piece by GP Fashion.`,
  };
}

export default async function DressDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const meta = await loadDressMeta(slug);

  if (!meta) notFound();

  const coverSrc = `/images/shop/items/${slug}/${slug}-cover.webp`;
  const hasDescription = meta.description.length > 0;
  const categoryStyle =
    CATEGORY_STYLES[meta.category] ?? "bg-stone-100 text-stone-700 border-stone-200";

  return (
    <main className="min-h-screen w-full bg-[#f5f5f4] text-stone-900">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10 px-6 py-12">

        {/* Back navigation */}
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

          {/* Cover image */}
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

            {/* Name */}
            <h1
              className="font-display text-4xl tracking-tight text-stone-900"
              data-testid="dress-name"
            >
              {meta.name}
            </h1>

            {/* Category badge */}
            <span
              className={`inline-flex w-fit items-center rounded-full border px-4 py-1 font-display text-xs uppercase tracking-[0.2em] ${categoryStyle}`}
              data-testid="dress-category"
            >
              {meta.category}
            </span>

            {/* Description — suppressed when empty */}
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
