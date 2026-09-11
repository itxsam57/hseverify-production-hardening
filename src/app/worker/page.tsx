import { redirect } from "next/navigation";

export default function WorkerPortalEntry(): never {
  redirect("/worker/dashboard");
}
