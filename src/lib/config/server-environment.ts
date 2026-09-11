import "server-only";

import {
  validateRuntimeEnvironment,
  type RuntimeEnvironment
} from "@/lib/config/environment";

let cachedEnvironment: RuntimeEnvironment | null = null;

export function getServerEnvironment(): RuntimeEnvironment {
  cachedEnvironment ??= validateRuntimeEnvironment(process.env);
  return cachedEnvironment;
}
