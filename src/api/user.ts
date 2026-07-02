import type { ApiClient } from "./client.js";
import { unwrap } from "./client.js";

export interface CurrentUser {
  id: string;
  userId: string;
  username: string;
  email: string;
  emailVerified: boolean;
}

let cachedUser: CurrentUser | undefined;

/** Fetch the authenticated user. Memoized for the lifetime of the process. */
export async function getCurrentUser(client: ApiClient): Promise<CurrentUser> {
  if (cachedUser) return cachedUser;
  const data = unwrap(await client.GET("/v1/user/me"));
  cachedUser = data.data as CurrentUser;
  return cachedUser;
}

/** Resolve the `userId` needed by /v1/wallets, /v1/tx and /v1/usage. */
export async function getUserId(client: ApiClient): Promise<string> {
  return (await getCurrentUser(client)).userId;
}

/** Test helper: reset the in-process cache. */
export function __resetUserCache(): void {
  cachedUser = undefined;
}
