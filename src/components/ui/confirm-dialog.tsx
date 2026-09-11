"use client";

import { useCallback, useId, useRef, useState } from "react";
import { createPortal, useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";

type FormAction = NonNullable<React.ComponentProps<"form">["action"]>;
type HiddenField = Readonly<{ name: string; value: string | number }>;

function ConfirmActionButton({
  label,
  pendingLabel,
  danger
}: {
  label: string;
  pendingLabel: string;
  danger: boolean;
}): React.JSX.Element {
  const { pending } = useFormStatus();

  return (
    <Button
      aria-disabled={pending}
      disabled={pending}
      variant={danger ? "danger" : "primary"}
      type="submit"
    >
      {pending ? pendingLabel : label}
    </Button>
  );
}

export function ConfirmDialog({
  triggerLabel,
  title,
  description,
  confirmLabel,
  pendingLabel = "Confirming…",
  action,
  hiddenFields = [],
  danger = false
}: {
  triggerLabel: string;
  title: string;
  description: string;
  confirmLabel: string;
  pendingLabel?: string;
  action: FormAction;
  hiddenFields?: readonly HiddenField[];
  danger?: boolean;
}): React.JSX.Element {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [isOpen, setIsOpen] = useState(false);
  const titleId = useId();
  const descriptionId = useId();

  const attachDialog = useCallback((node: HTMLDialogElement | null) => {
    dialogRef.current = node;
    if (node && !node.open) node.showModal();
  }, []);

  const closeDialog = (): void => {
    dialogRef.current?.close();
    setIsOpen(false);
  };

  const dialog =
    isOpen && typeof document !== "undefined"
      ? createPortal(
          <dialog
            aria-describedby={descriptionId}
            aria-labelledby={titleId}
            className="ds-dialog"
            onClose={() => setIsOpen(false)}
            ref={attachDialog}
          >
            <div className="ds-dialog-body">
              <div>
                <p className="section-kicker">Confirmation required</p>
                <h2 id={titleId}>{title}</h2>
              </div>
              <p id={descriptionId}>{description}</p>
              <div className="ds-dialog-actions">
                <Button variant="secondary" onClick={closeDialog} type="button">
                  Cancel
                </Button>
                <form action={action}>
                  {hiddenFields.map((field) => (
                    <input
                      key={field.name}
                      name={field.name}
                      type="hidden"
                      value={field.value}
                    />
                  ))}
                  <ConfirmActionButton
                    danger={danger}
                    label={confirmLabel}
                    pendingLabel={pendingLabel}
                  />
                </form>
              </div>
            </div>
          </dialog>,
          document.body
        )
      : null;

  return (
    <>
      <Button
        aria-haspopup="dialog"
        variant="ghost"
        onClick={() => setIsOpen(true)}
        type="button"
      >
        {triggerLabel}
      </Button>
      {dialog}
    </>
  );
}
