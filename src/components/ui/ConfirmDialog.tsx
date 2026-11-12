"use client";

import { AlertTriangle, HelpCircle } from "lucide-react";
import { useId, useState, type FormEvent, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";
import { Dialog } from "./Dialog";
import { Input } from "./Input";

export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description?: ReactNode;
  /** Extra content between the description and the buttons (lists, warnings…). */
  children?: ReactNode;
  /** Default "Confirm" (or "Delete" when `danger`). */
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button + warning icon. */
  danger?: boolean;
  /** Require typing this exact text (e.g. "DELETE") before confirming. */
  requireText?: string;
  /**
   * Runs on confirm. While its promise is pending the button shows a spinner and the dialog can't
   * be dismissed. On success the dialog closes; if it throws, the message is shown inline.
   */
  onConfirm: () => void | Promise<void>;
  /** Custom leading icon. */
  icon?: ReactNode;
  "data-testid"?: string;
}

/** "Are you sure?" dialog with optional typed confirmation. Confirm button has data-testid="confirm-button". */
export function ConfirmDialog({
  open,
  onClose,
  title,
  description,
  children,
  confirmLabel,
  cancelLabel = "Cancel",
  danger = false,
  requireText,
  onConfirm,
  icon,
  "data-testid": testId,
}: ConfirmDialogProps) {
  const formId = useId();
  const inputId = `${formId}-confirm`;
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setTyped("");
      setError(null);
      setBusy(false);
    }
  }

  const matches = !requireText || typed.trim() === requireText;

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!matches || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      setBusy(false);
      onClose();
    } catch (err) {
      setBusy(false);
      setError(err instanceof Error && err.message ? err.message : "Something went wrong. Please try again.");
    }
  }

  const leading =
    icon ??
    (
      <span
        className={cn(
          "grid size-11 place-items-center rounded-2xl ring-1 ring-inset",
          danger
            ? "bg-rose-500/10 text-rose-600 ring-rose-500/20 dark:text-rose-300"
            : "bg-brand-500/10 text-brand-600 ring-brand-500/20 dark:text-brand-300",
        )}
      >
        {danger ? <AlertTriangle className="size-5" /> : <HelpCircle className="size-5" />}
      </span>
    );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissible={!busy}
      size="sm"
      title={title}
      icon={leading}
      data-testid={testId}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            type="submit"
            form={formId}
            variant={danger ? "danger" : "primary"}
            loading={busy}
            disabled={!matches}
            data-testid="confirm-button"
          >
            {confirmLabel ?? (danger ? "Delete" : "Confirm")}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit} className="flex flex-col gap-4">
        {description ? <div className="text-sm leading-relaxed text-muted">{description}</div> : null}
        {children}
        {requireText ? (
          <div className="flex flex-col gap-1.5">
            <label htmlFor={inputId} className="text-sm text-zinc-700 dark:text-zinc-300">
              Type <span className="rounded-md bg-zinc-100 px-1.5 py-0.5 font-mono text-[13px] font-semibold text-zinc-900 dark:bg-white/10 dark:text-white">{requireText}</span> to confirm
            </label>
            <Input
              id={inputId}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              data-autofocus
              data-testid="confirm-input"
              disabled={busy}
            />
          </div>
        ) : null}
        {error ? (
          <p role="alert" className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-700 dark:text-rose-300">
            {error}
          </p>
        ) : null}
      </form>
    </Dialog>
  );
}
