/**
 * Force dynamic rendering for the whole app.
 *
 * TaskNote Plus is per-user and cookie-authenticated, so nothing here is
 * meaningfully static. Declaring it once at the root keeps individual pages
 * from accidentally being prerendered and evaluated without a database
 * connection at build time.
 */
export const dynamic = "force-dynamic";
