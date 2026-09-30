export type WorkerIdPresentation = Readonly<{
  permanent: boolean;
  label: "Permanent Worker ID" | "Registration reference";
  helper: string;
}>;

export function isPermanentWorkerId(value: string): boolean {
  return (
    /^worker_id_[A-Za-z0-9_-]{24}$/.test(value) ||
    /^HSE-WRK-[A-Z0-9-]+$/.test(value)
  );
}

export function workerIdPresentation(value: string): WorkerIdPresentation {
  if (isPermanentWorkerId(value)) {
    return Object.freeze({
      permanent: true,
      label: "Permanent Worker ID",
      helper:
        "Use this identifier when linking with an employer or verifying an approved public record."
    });
  }
  return Object.freeze({
    permanent: false,
    label: "Registration reference",
    helper:
      "This is a provisional onboarding reference. Your permanent Worker ID is issued only after the accepted identity workflow."
  });
}
