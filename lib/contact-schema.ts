/**
 * Contact_API request / response shapes and shared validator.
 *
 * Used by both the route handler at `app/api/contact/route.ts` and the
 * `ContactForm` client component, so client-side gating (Requirement 7.3) and
 * server-side validation (Requirements 7.4, 7.5) agree on bounds and on the
 * email shape from Requirement 7.4 byte-for-byte.
 *
 * Email shape (Requirement 7.4):
 *   - exactly one "@" symbol
 *   - at least one character before the "@"
 *   - at least one "." after the "@"
 *   - at least one character after the final "."
 *
 * Length bounds (Requirement 7.1):
 *   - name:    1..=100
 *   - email:   5..=254
 *   - message: 1..=2000
 */

export type ContactRequest = {
  name: string;
  email: string;
  message: string;
};

export type ContactSuccess = { ok: true };
export type ContactFailure = { ok: false; errors: Record<string, string> };
export type ContactResponse = ContactSuccess | ContactFailure;

/**
 * Length bounds shared by the client form and the route handler. Exported so
 * `ContactForm` can render inline character counts (Requirement 7.1) without
 * duplicating numeric literals.
 */
export const CONTACT_BOUNDS = {
  name: { min: 1, max: 100 },
  email: { min: 5, max: 254 },
  message: { min: 1, max: 2000 },
} as const;

/**
 * Email shape per Requirement 7.4.
 *
 *   ^[^@]+@[^@]*\.[^@]+$
 *
 * The leading `[^@]+` guarantees ≥1 character before the `@`. The single
 * literal `@` plus the `[^@]` character classes on both sides guarantee
 * exactly one `@` symbol (no `@` may appear in the local-part or the
 * domain-part). The `[^@]*\.` segment guarantees at least one `.` somewhere
 * after the `@` (greedy backtracking finds the *last* `.` in the domain so
 * `[^@]+$` after it forces ≥1 character after the final `.`).
 */
export const contactEmailRegex = /^[^@]+@[^@]*\.[^@]+$/;

type ValidationOk = { ok: true; value: ContactRequest };
type ValidationErr = { ok: false; errors: Record<string, string> };
export type ValidateContactResult = ValidationOk | ValidationErr;

type ContactField = "name" | "email" | "message";

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkStringField(
  raw: unknown,
  field: ContactField,
  errors: Record<string, string>,
): string | null {
  if (typeof raw !== "string") {
    errors[field] = `${field} must be a string`;
    return null;
  }
  const { min, max } = CONTACT_BOUNDS[field];
  if (raw.length < min || raw.length > max) {
    errors[field] = `${field} must be between ${min} and ${max} characters`;
    return null;
  }
  return raw;
}

/**
 * Validate an unknown payload against the Contact_API contract.
 *
 * Returns `{ ok: true, value }` with a typed `ContactRequest` on success, or
 * `{ ok: false, errors }` mapping each invalid field name to a human-readable
 * message. Top-level shape failures (non-object inputs) are reported under the
 * reserved `_root` key, matching the route handler's parse-error response in
 * Requirement 7.5.
 */
export function validateContactRequest(input: unknown): ValidateContactResult {
  if (!isPlainObject(input)) {
    return { ok: false, errors: { _root: "request body must be a JSON object" } };
  }

  const errors: Record<string, string> = {};
  const name = checkStringField(input.name, "name", errors);
  const email = checkStringField(input.email, "email", errors);
  const message = checkStringField(input.message, "message", errors);

  if (email !== null && !contactEmailRegex.test(email)) {
    errors.email = "email must contain a single '@' and a '.' with characters on either side";
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  // The non-null assertions are safe: we only reach this branch when each
  // checkStringField call returned a string and no errors were recorded.
  return {
    ok: true,
    value: {
      name: name as string,
      email: email as string,
      message: message as string,
    },
  };
}
