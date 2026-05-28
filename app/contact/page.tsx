/**
 * Contact route shell (Requirements 4.7, 7.1, 10.5).
 *
 * Server component shell for `/contact`. Renders the shared
 * `<ContactForm/>` client component (the only contact-form
 * implementation in the Gallery_App) alongside an "About the designer"
 * section, the GP Fashion contact details, and an FAQ block. Visitors
 * arriving from the Landing CTA, the Walkthrough_Engine's Zoom_View,
 * the WebGL_Fallback, or any direct link land here.
 *
 * Visual scheme: light grey surface that mirrors the original GP
 * Fashion contact page, so the form reads as a continuation of the
 * boutique brand rather than a dark gallery overlay. The dark
 * gallery palette used elsewhere in the app stays for `/` and
 * `/gallery`; this route locally overrides background and foreground
 * with `bg-[#f5f5f4]` and `text-stone-900` Tailwind utilities.
 *
 * No client-only APIs are used in this file, so it stays a server
 * component (the App Router default). The `<ContactForm/>` boundary
 * is marked `"use client"` inside `components/ContactForm.tsx`.
 */

import Image from "next/image";
import Link from "next/link";
import type { Metadata } from "next";

import { ContactForm } from "@/components/ContactForm";
import { FOCUS_RING_CLASS } from "@/components/FocusRing";

const SITE_NAME = "Virtual Fashion Design Gallery";

export const metadata: Metadata = {
  title: `Contact — ${SITE_NAME}`,
  description:
    "Send a note about a project, collaboration, or styling consultation.",
};

const BACK_LINK_CLASS = `inline-flex w-fit items-center gap-2 text-sm font-display uppercase tracking-[0.2em] text-stone-500 transition-colors hover:text-stone-900 ${FOCUS_RING_CLASS}`;

const CONTACT_INFO = [
  { label: "Email", value: "piyushbholla@gmail.com" },
  { label: "Phone", value: "+91 9821818352" },
  { label: "Location", value: "Delhi, India" },
  {
    label: "Availability",
    value:
      "Available for freelance projects, brand collaborations, and styling consultations worldwide.",
  },
];

const FAQ = [
  {
    question: "What services do you offer?",
    answer:
      "Fashion styling, creative direction, brand consulting, editorial styling, and personal styling services.",
  },
  {
    question: "Do you work with international clients?",
    answer:
      "Yes. I collaborate with clients globally and am available for international projects and remote consultations.",
  },
  {
    question: "How far in advance should I book?",
    answer:
      "For major projects, booking at least 2–4 weeks in advance is recommended. Availability may vary.",
  },
  {
    question: "Do you offer custom packages?",
    answer:
      "Absolutely. Every project is unique, and I tailor services to match your specific needs and vision.",
  },
];

/**
 * Designer profile shown above the contact form. Copy is lifted from
 * the GP Fashion `/about` page so the gallery's contact route stays
 * in voice with the wider brand. The hero image is mirrored from the
 * GP Fashion site at `/public/images/about/piyush1.jpg`.
 */
const DESIGNER = {
  name: "Piyush Bholla",
  role: "Founder & Creative Director, GP Fashion",
  imageSrc: "/images/about/piyush1.jpg",
  bio: [
    "An Indian fashion designer working across kidswear, menswear, and womenswear from a Delhi studio. Trained at NIFT Bengaluru and FIT New York, with a practice grounded in detail, craftsmanship, and the quiet pleasure of well-made clothes.",
    "Each collection is a balancing act between tradition and innovation, polish and playfulness. The aim is the same every time — clothes that feel authentic, elegant, and joyful to wear.",
  ],
  philosophyQuote: "Authenticity woven into every detail.",
};

export default function ContactPage() {
  return (
    <main className="min-h-screen w-full bg-[#f5f5f4] text-stone-900">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-12 px-6 py-12">
        <nav
          aria-label="Contact page navigation"
          className="flex flex-wrap items-center gap-x-6 gap-y-2"
        >
          <Link href="/gallery" className={BACK_LINK_CLASS} data-back-to="gallery">
            <span aria-hidden="true">←</span>
            Back to gallery
          </Link>
          <Link href="/" className={BACK_LINK_CLASS} data-back-to="landing">
            <span aria-hidden="true">←</span>
            Back to landing
          </Link>
        </nav>

        <header className="flex flex-col items-start gap-3">
          <p className="font-body text-xs uppercase tracking-[0.3em] text-stone-500">
            Let&apos;s work together
          </p>
          <h1 className="font-display text-4xl tracking-tight sm:text-5xl">
            Contact the designer
          </h1>
          <p className="max-w-2xl font-body text-base text-stone-600">
            Have a project in mind or need expert fashion styling guidance?
            Send a note and we&apos;ll create something exceptional together.
          </p>
        </header>

        {/* About the designer ----------------------------------------- */}
        <section
          aria-labelledby="designer-heading"
          className="grid grid-cols-1 gap-8 rounded-lg border border-stone-200 bg-white p-6 shadow-sm sm:p-8 lg:grid-cols-[2fr_3fr]"
        >
          <div className="relative aspect-[3/4] w-full overflow-hidden rounded-md bg-stone-100">
            <Image
              src={DESIGNER.imageSrc}
              alt={DESIGNER.name}
              fill
              sizes="(min-width: 1024px) 320px, 100vw"
              className="object-cover"
              priority
            />
          </div>
          <div className="flex flex-col justify-center gap-4">
            <p className="font-body text-xs uppercase tracking-[0.3em] text-amber-700">
              About the designer
            </p>
            <h2
              id="designer-heading"
              className="font-display text-3xl tracking-tight text-stone-900"
            >
              {DESIGNER.name}
            </h2>
            <p className="font-body text-sm uppercase tracking-[0.18em] text-stone-500">
              {DESIGNER.role}
            </p>
            <div className="flex flex-col gap-3 font-body text-base leading-relaxed text-stone-700">
              {DESIGNER.bio.map((paragraph, i) => (
                <p key={i}>{paragraph}</p>
              ))}
            </div>
            <blockquote className="mt-2 border-l-2 border-amber-500 pl-4 font-display text-lg italic text-stone-800">
              &ldquo;{DESIGNER.philosophyQuote}&rdquo;
            </blockquote>
          </div>
        </section>

        {/* Get in touch + form ---------------------------------------- */}
        <section className="grid grid-cols-1 gap-12 lg:grid-cols-2">
          <aside className="flex flex-col gap-8">
            <div className="flex flex-col gap-2">
              <h2 className="font-display text-2xl text-stone-900">
                Get in touch
              </h2>
              <p className="font-body text-sm leading-relaxed text-stone-600">
                Whether you&apos;re a brand, designer, photographer, or
                individual client, the studio is open to collaborations,
                consultations, and creative partnerships.
              </p>
            </div>
            <dl className="flex flex-col gap-4">
              {CONTACT_INFO.map((item) => (
                <div
                  key={item.label}
                  className="flex flex-col gap-1 border-l-2 border-amber-500 pl-4"
                >
                  <dt className="font-display text-xs uppercase tracking-[0.2em] text-stone-500">
                    {item.label}
                  </dt>
                  <dd className="font-body text-sm text-stone-800">
                    {item.value}
                  </dd>
                </div>
              ))}
            </dl>
          </aside>

          <section
            aria-labelledby="contact-form-heading"
            className="flex flex-col gap-6 rounded-lg border border-stone-200 bg-white p-6 shadow-sm sm:p-8"
          >
            <h2
              id="contact-form-heading"
              className="font-display text-2xl text-stone-900"
            >
              Send a message
            </h2>
            <ContactForm theme="light" />
          </section>
        </section>

        {/* FAQ -------------------------------------------------------- */}
        <section
          aria-labelledby="faq-heading"
          className="flex flex-col gap-6"
        >
          <h2
            id="faq-heading"
            className="font-display text-3xl tracking-tight text-stone-900"
          >
            Frequently asked
          </h2>
          <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2">
            {FAQ.map((entry) => (
              <div
                key={entry.question}
                className="flex flex-col gap-2 rounded-md border border-stone-200 bg-white p-5 shadow-sm"
              >
                <dt className="font-display text-base font-medium text-stone-900">
                  {entry.question}
                </dt>
                <dd className="font-body text-sm leading-relaxed text-stone-600">
                  {entry.answer}
                </dd>
              </div>
            ))}
          </dl>
        </section>
      </div>
    </main>
  );
}
