"use client";

import { createAuthClient } from "better-auth/react";
import { magicLinkClient } from "better-auth/client/plugins";

/** Browser-side auth client (sign-out, session hooks). Magic-link requests go through server actions. */
export const authClient = createAuthClient({
  plugins: [magicLinkClient()],
});
