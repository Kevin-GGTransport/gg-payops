import { toast } from "sonner";

import { isRedirectError } from "@/lib/action-result";

/**
 * Call a redirecting server action imperatively under the standard toast
 * contract. The subtlety every caller used to repeat: a redirecting action
 * REJECTS the client-side promise with NEXT_REDIRECT when it succeeds, so the
 * rejection is the success path and only other throws are failures. Result-
 * code actions ({ ok: false; code }) keep their dialogs' inline error
 * mapping - this helper is for the void/redirect family.
 */
export async function submitWithToast(
  fd: FormData,
  action: (fd: FormData) => Promise<unknown>,
  opts: { success: string; failure: string }
): Promise<void> {
  try {
    await action(fd);
    toast.success(opts.success);
  } catch (error) {
    if (isRedirectError(error)) toast.success(opts.success);
    else toast.error(opts.failure);
  }
}
