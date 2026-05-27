/**
 * Contact route shell (Requirements 4.7, 7.1, 10.5).
 *
 * Server component shell for `/contact`. Renders the shared
 * `<ContactForm/>` client component (the only contact-form
 * implementation in the Gallery_App) alongside the GP Fashion contact
 * details and FAQ block. Visitors arriving from the Landing CTA, the
 * Walkthrough_Engine's Zoom_View, the WebGL_Fallback, or any direct
 * link land here.
 *
 * No client-only APIs are used in this file, so it stays a server
 * component (the App Router default). The `<ContactForm/>` boundary
 * is marked `"use client"` inside `components/ContactForm.tsx`.
 */

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

const BACK_LINK_CLASS = `inline-flex w-fit items-center gap-2 text-sm font-display uppercase tracking-[0.2em] text-[var(--gallery-muted)] transition-colors hover:text-[var(--gallery-fg)] ${FOCUS_RING_CLASS}`;

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

export default function ContactPage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-5xl flex-col gap-12 px-6 py-12">
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
        <p className="font-body text-xs uppercase tracking-[0.3em] text-[var(--gallery-muted)]">
          Let&apos;s work together
        </p>
        <h1 className="font-display text-4xl tracking-tight sm:text-5xl">
          Contact the designer
        </h1>
        <p className="max-w-2xl font-body text-base text-[var(--gallery-muted)]">
          Have a project in mind or need expert fashion styling guidance? Send
          a note and we&apos;ll create something exceptional together.
        </p>
      </header>

      <section className="grid grid-cols-1 gap-12 lg:grid-cols-2">
        <aside className="flex flex-col gap-8">
          <div className="flex flex-col gap-2">
            <h2 className="font-display text-2xl">Get in touch</h2>
            <p className="font-body text-sm leading-relaxed text-[var(--gallery-muted)]">
              Whether you&apos;re a brand, designer, photographer, or
              individual client, the studio is open to collaborations,
              consultations, and creative partnerships.
            </p>
          </div>
          <dl className="flex flex-col gap-4">
            {CONTACT_INFO.map((item) => (
              <div
                key={item.label}
                className="flex flex-col gap-1 border-l-2 border-[var(--gallery-accent)] pl-4"
              >
                <dt className="font-display text-xs uppercase tracking-[0.2em] text-[var(--gallery-muted)]">
                  {item.label}
                </dt>
                <dd className="font-body text-sm text-[var(--gallery-fg)]">
                  {item.value}
                </dd>
              </div>
            ))}
          </dl>
        </aside>

        <section
          aria-labelledby="contact-form-heading"
          className="flex flex-col gap-6 rounded-md border border-white/10 bg-[var(--gallery-surface)]/60 p-6 sm:p-8"
        >
          <h2
            id="contact-form-heading"
            className="font-display text-2xl"
          >
            Send a message
          </h2>
          <ContactForm />
        </section>
      </section>

      <section
        aria-labelledby="faq-heading"
        className="flex flex-col gap-6"
      >
        <h2
          id="faq-heading"
          className="font-display text-3xl tracking-tight"
        >
          Frequently asked
        </h2>
        <dl className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          {FAQ.map((entry) => (
            <div
              key={entry.question}
              className="flex flex-col gap-2 rounded-md border border-white/10 bg-[var(--gallery-surface)]/40 p-5"
            >
              <dt className="font-display text-base font-medium text-[var(--gallery-fg)]">
                {entry.question}
              </dt>
              <dd className="font-body text-sm leading-relaxed text-[var(--gallery-muted)]">
                {entry.answer}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </main>
  );
}
