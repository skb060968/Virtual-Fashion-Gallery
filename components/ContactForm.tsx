"use client";

/**
 * ContactForm (Requirements 7.1, 7.2, 7.3, 7.9, 10.1, 10.7, 14.4).
 *
 * Client-side companion to the Contact_API route handler. Renders three
 * labelled fields (`name`, `email`, `message`) with inline character
 * counts (Req 7.1), gates submission through the same
 * `validateContactRequest` validator the route handler uses so client
 * and server agree on bounds and on the email shape from Req 7.4
 * (Req 7.3), and POSTs a fresh literal payload as JSON with a 10-second
 * client-side timeout (Req 7.2, 7.9).
 *
 * No-mutation invariant (Req 14.4): the submit handler always builds a
 * brand-new `{ name, email, message }` literal from the current React
 * state values and calls `JSON.stringify` on that fresh object. The
 * field state values themselves are never reassigned in place, and the
 * outgoing payload object is local to the handler invocation.
 *
 * On a non-200 response, a network error, or a 10-second timeout, the
 * form renders a non-blocking inline error region (`aria-live="polite"`),
 * retains the values the Visitor has entered, and re-enables the submit
 * control (Req 7.9).
 *
 * Accessibility (Req 10.1, 10.7):
 *   - Every field has a `<label htmlFor>` and a stable `id`.
 *   - Tab order is the natural document order: name → email → message →
 *     submit. No `tabIndex` overrides are applied.
 *   - All focusable controls compose `FOCUS_RING_CLASS` from
 *     `components/FocusRing` so the visible focus indicator matches the
 *     rest of the Gallery_App.
 *   - Field-level error messages are wired through `aria-describedby` and
 *     `aria-invalid` so assistive technologies surface them without
 *     stealing focus.
 */

import { useId, useState } from "react";
import type { FormEvent } from "react";
import {
  CONTACT_BOUNDS,
  validateContactRequest,
} from "@/lib/contact-schema";
import { FOCUS_RING_CLASS } from "@/components/FocusRing";

/**
 * Web3Forms access key shared with the GP Fashion contact form.
 * Web3Forms is a hosted form-submission relay: the POST body is
 * forwarded to the email address registered against this key, so no
 * server-side mailer (and no `nodemailer` dependency) is needed in the
 * gallery itself. The key is publishable; it identifies the inbox, not
 * a private credential.
 */
const WEB3FORMS_ENDPOINT = "https://api.web3forms.com/submit";
const WEB3FORMS_ACCESS_KEY = "3ff1a5f0-5f4c-42d3-967d-413a0f8adc75";

/**
 * Returns an `AbortSignal` that aborts after `ms` milliseconds, used to
 * bound the contact submission `fetch` per Requirement 7.9. Implemented
 * with a plain `AbortController` rather than `AbortSignal.timeout` so we
 * stay compatible with the React 18 + jsdom test environment.
 */
function timeoutSignal(ms: number): AbortSignal {
  const controller = new AbortController();
  setTimeout(() => {
    controller.abort();
  }, ms);
  return controller.signal;
}

type SubmitStatus =
  | { kind: "idle" }
  | { kind: "submitting" }
  | { kind: "success" }
  | { kind: "error"; message: string };

type FieldErrors = Partial<
  Record<"name" | "email" | "message" | "_root", string>
>;

/**
 * `theme` selects the form's surface palette. The default `"dark"`
 * matches the gallery shell (used when the form appears as an embed
 * over the dark Walkthrough_Engine UI). `"light"` mirrors the GP
 * Fashion contact page palette and is used by the standalone
 * `/contact` route — light inputs on a white card, with stone-coloured
 * helper text instead of the muted gallery tones.
 */
export type ContactFormTheme = "dark" | "light";

const FIELD_BASE_DARK =
  "w-full rounded-md border border-white/10 bg-[var(--gallery-surface)] px-3 py-2 text-[var(--gallery-fg)] placeholder:text-[var(--gallery-muted)] disabled:opacity-60";
const FIELD_BASE_LIGHT =
  "w-full rounded-md border border-stone-300 bg-white px-3 py-2 text-stone-900 placeholder:text-stone-400 disabled:opacity-60";

const SUBMIT_BASE_DARK =
  "inline-flex items-center justify-center rounded-md bg-[var(--gallery-accent)] px-4 py-2 font-medium text-black transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60";
const SUBMIT_BASE_LIGHT =
  "inline-flex items-center justify-center rounded-md bg-amber-500 px-4 py-2 font-medium text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60";

const COUNT_TEXT_DARK = "text-xs text-[var(--gallery-muted)]";
const COUNT_TEXT_LIGHT = "text-xs text-stone-500";

const ERROR_TEXT_DARK = "text-red-300";
const ERROR_TEXT_LIGHT = "text-red-600";

const SUCCESS_TEXT_DARK = "text-emerald-300";
const SUCCESS_TEXT_LIGHT = "text-emerald-700";

export type ContactFormProps = {
  /** Surface palette. Defaults to `"dark"`. */
  theme?: ContactFormTheme;
};

export function ContactForm({ theme = "dark" }: ContactFormProps = {}) {
  const isLight = theme === "light";
  const fieldBase = isLight ? FIELD_BASE_LIGHT : FIELD_BASE_DARK;
  const submitBase = isLight ? SUBMIT_BASE_LIGHT : SUBMIT_BASE_DARK;
  const countText = isLight ? COUNT_TEXT_LIGHT : COUNT_TEXT_DARK;
  const errorText = isLight ? ERROR_TEXT_LIGHT : ERROR_TEXT_DARK;
  const successText = isLight ? SUCCESS_TEXT_LIGHT : SUCCESS_TEXT_DARK;
  const [name, setName] = useState<string>("");
  const [email, setEmail] = useState<string>("");
  const [message, setMessage] = useState<string>("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [status, setStatus] = useState<SubmitStatus>({ kind: "idle" });

  const reactId = useId();
  const nameId = `${reactId}-name`;
  const nameCountId = `${reactId}-name-count`;
  const nameErrorId = `${reactId}-name-error`;
  const emailId = `${reactId}-email`;
  const emailCountId = `${reactId}-email-count`;
  const emailErrorId = `${reactId}-email-error`;
  const messageId = `${reactId}-message`;
  const messageCountId = `${reactId}-message-count`;
  const messageErrorId = `${reactId}-message-error`;
  const errorRegionId = `${reactId}-form-status`;

  const submitting = status.kind === "submitting";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    // Build a fresh literal from current React state on every submit.
    // The literal is local to this invocation; we never mutate it after
    // calling `JSON.stringify`, which preserves the no-mutation invariant
    // tied to Requirement 14.4.
    const payload = { name, email, message };

    const validation = validateContactRequest(payload);
    if (!validation.ok) {
      // Client-side validation gate (Req 7.3): no network submission and
      // entered values are retained because we never touch the field
      // state setters here.
      setFieldErrors(validation.errors as FieldErrors);
      setStatus({ kind: "idle" });
      return;
    }

    setFieldErrors({});
    setStatus({ kind: "submitting" });

    // POST through Web3Forms — the same hosted relay used by GP Fashion.
    // The endpoint expects the access_key alongside the form fields and
    // returns `{ success: boolean }` JSON regardless of HTTP status, so
    // both the HTTP code and the body's `success` flag are checked.
    const web3formsPayload = {
      access_key: WEB3FORMS_ACCESS_KEY,
      subject: "Virtual Fashion Gallery — Contact",
      from_name: payload.name,
      name: payload.name,
      email: payload.email,
      message: payload.message,
    };
    const body = JSON.stringify(web3formsPayload);

    let response: Response;
    try {
      response = await fetch(WEB3FORMS_ENDPOINT, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body,
        signal: timeoutSignal(10000),
      });
    } catch (err) {
      // Network error or 10s timeout (AbortError). The error region is
      // rendered non-blocking via `aria-live="polite"`; entered values
      // are retained because we don't reset field state, and the submit
      // control is re-enabled by transitioning out of "submitting".
      const isAbort =
        err instanceof DOMException
          ? err.name === "AbortError"
          : (err as { name?: string } | null)?.name === "AbortError";
      setStatus({
        kind: "error",
        message: isAbort
          ? "Submission timed out after 10 seconds. Please try again."
          : "Could not reach the contact endpoint. Please try again.",
      });
      return;
    }

    // Web3Forms always returns JSON with a `success` boolean. We treat
    // a 2xx response with `success: true` as the green path; everything
    // else is surfaced through the inline error region.
    let web3formsResult: { success?: boolean; message?: string } | null =
      null;
    try {
      web3formsResult = (await response.json()) as {
        success?: boolean;
        message?: string;
      };
    } catch {
      // Body was empty or not JSON; leave `web3formsResult` as null and
      // fall through to the generic error message below.
    }

    if (response.ok && web3formsResult?.success) {
      // Clear the form on success only. Error paths below intentionally
      // leave the entered values in place per Req 7.9.
      setName("");
      setEmail("");
      setMessage("");
      setStatus({ kind: "success" });
      return;
    }

    setStatus({
      kind: "error",
      message:
        web3formsResult?.message ??
        `Submission failed (HTTP ${response.status}). Please try again.`,
    });
  }

  const rootError = fieldErrors._root;
  const showErrorRegion = status.kind === "error" || rootError !== undefined;
  const showSuccessRegion = status.kind === "success";

  return (
    <form
      noValidate
      onSubmit={handleSubmit}
      aria-describedby={errorRegionId}
      className="flex w-full max-w-xl flex-col gap-6"
    >
      {/* Name */}
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={nameId} className="text-sm font-medium">
            Name
          </label>
          <span
            id={nameCountId}
            className={countText}
            aria-live="polite"
          >
            {name.length}/{CONTACT_BOUNDS.name.max}
          </span>
        </div>
        <input
          id={nameId}
          name="name"
          type="text"
          autoComplete="name"
          inputMode="text"
          maxLength={CONTACT_BOUNDS.name.max}
          value={name}
          onChange={(e) => setName(e.target.value)}
          disabled={submitting}
          aria-invalid={fieldErrors.name ? "true" : "false"}
          aria-describedby={`${nameCountId}${fieldErrors.name ? ` ${nameErrorId}` : ""}`}
          className={`${fieldBase} ${FOCUS_RING_CLASS}`}
        />
        {fieldErrors.name ? (
          <p id={nameErrorId} className={`text-xs ${errorText}`}>
            {fieldErrors.name}
          </p>
        ) : null}
      </div>

      {/* Email */}
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={emailId} className="text-sm font-medium">
            Email
          </label>
          <span
            id={emailCountId}
            className={countText}
            aria-live="polite"
          >
            {email.length}/{CONTACT_BOUNDS.email.max}
          </span>
        </div>
        <input
          id={emailId}
          name="email"
          type="email"
          autoComplete="email"
          inputMode="email"
          maxLength={CONTACT_BOUNDS.email.max}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
          aria-invalid={fieldErrors.email ? "true" : "false"}
          aria-describedby={`${emailCountId}${fieldErrors.email ? ` ${emailErrorId}` : ""}`}
          className={`${fieldBase} ${FOCUS_RING_CLASS}`}
        />
        {fieldErrors.email ? (
          <p id={emailErrorId} className={`text-xs ${errorText}`}>
            {fieldErrors.email}
          </p>
        ) : null}
      </div>

      {/* Message */}
      <div className="flex flex-col gap-1">
        <div className="flex items-baseline justify-between gap-2">
          <label htmlFor={messageId} className="text-sm font-medium">
            Message
          </label>
          <span
            id={messageCountId}
            className={countText}
            aria-live="polite"
          >
            {message.length}/{CONTACT_BOUNDS.message.max}
          </span>
        </div>
        <textarea
          id={messageId}
          name="message"
          rows={6}
          maxLength={CONTACT_BOUNDS.message.max}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          disabled={submitting}
          aria-invalid={fieldErrors.message ? "true" : "false"}
          aria-describedby={`${messageCountId}${fieldErrors.message ? ` ${messageErrorId}` : ""}`}
          className={`${fieldBase} resize-y ${FOCUS_RING_CLASS}`}
        />
        {fieldErrors.message ? (
          <p id={messageErrorId} className={`text-xs ${errorText}`}>
            {fieldErrors.message}
          </p>
        ) : null}
      </div>

      <div className="flex items-center gap-4">
        <button
          type="submit"
          disabled={submitting}
          className={`${submitBase} ${FOCUS_RING_CLASS}`}
        >
          {submitting ? "Sending…" : "Send message"}
        </button>
      </div>

      {/*
        Non-blocking status region (Req 7.9, 10.1).
        `aria-live="polite"` means assistive technologies will announce
        updates without interrupting the Visitor's current task; focus
        is never moved into this region, so the form is still usable.
      */}
      <div
        id={errorRegionId}
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="min-h-[1.5rem] text-sm"
      >
        {showErrorRegion ? (
          <p className={errorText}>
            {status.kind === "error" ? status.message : rootError}
          </p>
        ) : null}
        {showSuccessRegion ? (
          <p className={successText}>Thanks — your message was sent.</p>
        ) : null}
      </div>
    </form>
  );
}

export default ContactForm;
