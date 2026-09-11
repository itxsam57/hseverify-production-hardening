import { runDevelopmentServer } from "./lib/development-server.mjs";

try {
  const result = await runDevelopmentServer({
    args: process.argv.slice(2)
  });

  if (result.requestedSignal) {
    console.log(
      "Development server stopped with isolated output and unchanged source configuration."
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = error?.exitCode ?? 1;
}
