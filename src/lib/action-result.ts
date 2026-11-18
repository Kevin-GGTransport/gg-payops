/**
 * redirect() inside a server action rejects the client-side call with a
 * NEXT_REDIRECT digest even on success - that rejection IS the navigation,
 * not a failure. Success paths that redirect (delete/verify/copy...) must
 * treat it as success; only other rejections are real errors.
 */
export function isRedirectError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    (error as { digest: string }).digest.startsWith("NEXT_REDIRECT")
  );
}
