"use server";

import { redirect } from "next/navigation";

import {
  signInWorkerAccount,
  type RoleLoginActionState
} from "@/app/auth/actions";
import { revokeCurrentAuthenticationSession } from "@/lib/auth/auth-session-service";

export type WorkerLoginState = RoleLoginActionState;

export async function signInWorker(
  previousState: WorkerLoginState,
  formData: FormData
): Promise<WorkerLoginState> {
  return signInWorkerAccount(previousState, formData);
}

export async function signOutWorker(): Promise<void> {
  await revokeCurrentAuthenticationSession();
  redirect("/worker/login?reason=signed-out");
}
