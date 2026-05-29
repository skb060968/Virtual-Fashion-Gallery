/**
 * Legacy `/gallery` route shell.
 *
 * The landing and gallery surfaces were merged into the root route
 * (`/`). This shell is retained only to keep deep links and old
 * bookmarks working — it server-side redirects to `/` so any visitor
 * who hits `/gallery` is sent straight to the merged immersive
 * experience without a flash of empty page.
 *
 * `next/navigation`'s `redirect()` throws a special `NEXT_REDIRECT`
 * exception that the App Router catches and converts into a 307
 * redirect response. The function never returns a React tree, so the
 * client-side bundle for this route is effectively empty.
 */

import { redirect } from "next/navigation";

export default function LegacyGalleryRedirect(): never {
  redirect("/");
}
