/**
 * Contact_API route handler — Requirements 7.4–7.8, 12.6, 13.4.
 *
 * Behaviour summary:
 *   - POST  parses JSON, validates via the shared schema, and calls
 *           `submitContact(payload)` — the encapsulated submission step
 *           (Requirement 13.4) that today only logs server-side and tomorrow
 *           is the only place a future `nodemailer` integration would land.
 *   - GET / PUT / DELETE / PATCH / OPTIONS all return a shared 405 response
 *           with `Allow: POST` per Requirement 7.6.
 *
 * Scope guarantees:
 *   - No outbound network requests (Requirements 7.7, 12.6).
 *   - No DB calls (Requirement 12.2 + 7.7).
 *   - No third-party email service calls (Requirement 12.6).
 *
 * Runtime: Node (default for App Router route handlers; no edge-only APIs are
 * used). Performance budget per Requirement 7.8 is comfortably met because the
 * handler only performs synchronous validation, a single console log, and a
 * small JSON response.
 */

import {
  validateContactRequest,
  type ContactFailure,
  type ContactRequest,
  type ContactSuccess,
} from "@/lib/contact-schema";

/**
 * Shared 405 response builder (Requirement 7.6). Every non-POST verb export
 * delegates here so the `Allow` header and body shape are defined exactly once.
 */
function methodNotAllowed(): Response {
  const body: ContactFailure = {
    ok: false,
    errors: { _root: "method not allowed" },
  };
  return new Response(JSON.stringify(body), {
    status: 405,
    headers: {
      "Content-Type": "application/json",
      Allow: "POST",
    },
  });
}

/**
 * Submission seam (Requirement 13.4). v1 logs the validated payload alongside
 * a `receivedAt` ISO timestamp; a future `nodemailer`-backed implementation
 * is purely an internal change to this function.
 */
function submitContact(payload: ContactRequest): void {
  const receivedAt = new Date().toISOString();
  // eslint-disable-next-line no-console -- intentional server-side log per Requirement 7.4
  console.info("[contact]", { ...payload, receivedAt });
}

function jsonResponse(status: number, body: ContactSuccess | ContactFailure): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: Request): Promise<Response> {
  let parsed: unknown;
  try {
    parsed = await req.json();
  } catch {
    // Body was not valid JSON — Requirement 7.5.
    return jsonResponse(400, {
      ok: false,
      errors: { _root: "invalid JSON" },
    });
  }

  const result = validateContactRequest(parsed);
  if (!result.ok) {
    // Schema violation — Requirement 7.5. The validator already names every
    // offending field in `errors`.
    return jsonResponse(400, { ok: false, errors: result.errors });
  }

  submitContact(result.value);

  return jsonResponse(200, { ok: true });
}

export async function GET(): Promise<Response> {
  return methodNotAllowed();
}

export async function PUT(): Promise<Response> {
  return methodNotAllowed();
}

export async function DELETE(): Promise<Response> {
  return methodNotAllowed();
}

export async function PATCH(): Promise<Response> {
  return methodNotAllowed();
}

export async function OPTIONS(): Promise<Response> {
  return methodNotAllowed();
}
