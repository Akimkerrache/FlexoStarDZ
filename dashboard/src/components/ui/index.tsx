import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AlertTriangle, Inbox, Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn, STATUS_TONE } from "@/lib/utils";
import { ApiError } from "@/services/http";

type Variant = "primary" | "secondary" | "danger" | "ghost" | "outline";
const variants: Record<Variant, string> = {
  primary:
    "bg-teal-700 text-white hover:bg-teal-800 focus-visible:outline-teal-700",
  secondary:
    "bg-slate-100 text-slate-800 hover:bg-slate-200 focus-visible:outline-slate-500",
  danger:
    "bg-red-600 text-white hover:bg-red-700 focus-visible:outline-red-600",
  ghost: "text-slate-700 hover:bg-slate-100 focus-visible:outline-slate-500",
  outline:
    "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50 focus-visible:outline-slate-500",
};

export const Button = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: Variant;
    size?: "sm" | "md";
    loading?: boolean;
  }
>(
  (
    {
      className,
      variant = "primary",
      size = "md",
      loading,
      children,
      disabled,
      type = "button",
      ...p
    },
    ref,
  ) => (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
        size === "sm" ? "h-8 px-3 text-sm" : "h-10 px-4 text-sm",
        variants[variant],
        className,
      )}
      {...p}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  ),
);
Button.displayName = "Button";

const inputCls =
  "block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-600 focus:outline-2 focus:outline-teal-600/30 disabled:bg-slate-100 disabled:text-slate-500 aria-[invalid=true]:border-red-500";

export const Input = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement>
>(({ className, ...p }, ref) => (
  <input ref={ref} className={cn(inputCls, className)} {...p} />
));
Input.displayName = "Input";
export const Textarea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className, ...p }, ref) => (
  <textarea ref={ref} rows={3} className={cn(inputCls, className)} {...p} />
));
Textarea.displayName = "Textarea";
export const Select = forwardRef<
  HTMLSelectElement,
  SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...p }, ref) => (
  <select ref={ref} className={cn(inputCls, "pe-8", className)} {...p}>
    {children}
  </select>
));
Select.displayName = "Select";

export function Field({
  label,
  error,
  hint,
  children,
  htmlFor,
  className,
  required,
}: {
  label?: ReactNode;
  error?: string;
  hint?: ReactNode;
  children: ReactNode;
  htmlFor?: string;
  className?: string;
  required?: boolean;
}) {
  return (
    <div className={cn("space-y-1", className)}>
      {label && (
        <label
          htmlFor={htmlFor}
          className="block text-sm font-medium text-slate-700"
        >
          {label}
          {required && (
            <span className="ms-0.5 text-red-600" aria-hidden>
              *
            </span>
          )}
        </label>
      )}
      {children}
      {hint && !error && <p className="text-xs text-slate-500">{hint}</p>}
      {error && (
        <p role="alert" className="text-xs text-red-600">
          {error}
        </p>
      )}
    </div>
  );
}

export const Card = ({
  className,
  children,
}: {
  className?: string;
  children: ReactNode;
}) => (
  <section
    className={cn(
      "rounded-lg border border-slate-200 bg-white shadow-sm",
      className,
    )}
  >
    {children}
  </section>
);
export const CardHeader = ({
  title,
  actions,
}: {
  title: ReactNode;
  actions?: ReactNode;
}) => (
  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
    <h2 className="text-sm font-semibold text-slate-800">{title}</h2>
    {actions}
  </div>
);

export function StatusBadge({
  status,
  label,
}: {
  status: string;
  label?: string;
}) {
  const { t } = useTranslation();
  return (
    <span
      className={cn(
        "inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium",
        STATUS_TONE[status] ?? "bg-slate-100 text-slate-700",
      )}
    >
      {label ?? t(`status.${status}`, { defaultValue: status })}
    </span>
  );
}

export const Badge = ({
  children,
  tone = "bg-slate-100 text-slate-700",
}: {
  children: ReactNode;
  tone?: string;
}) => (
  <span
    className={cn(
      "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
      tone,
    )}
  >
    {children}
  </span>
);

export const Spinner = ({ className }: { className?: string }) => (
  <Loader2
    className={cn("size-5 animate-spin text-teal-700", className)}
    aria-hidden
  />
);

export function Loading({ label }: { label?: string }) {
  const { t } = useTranslation();
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 p-10 text-sm text-slate-500"
    >
      <Spinner /> {label ?? t("common.loading")}
    </div>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title?: string;
  hint?: string;
  action?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-2 p-10 text-center text-slate-500">
      <Inbox className="size-8 text-slate-300" aria-hidden />
      <p className="font-medium text-slate-600">{title ?? t("common.empty")}</p>
      {hint && <p className="text-sm">{hint}</p>}
      {action}
    </div>
  );
}

export function errorText(
  e: unknown,
  t: (k: string, o?: any) => string,
): string {
  if (e instanceof ApiError) {
    const key = `errors.${e.code}`;
    const translated = t(key, { defaultValue: "" });
    return translated || e.message;
  }
  return t("errors.network");
}

export function ErrorState({
  error,
  onRetry,
}: {
  error: unknown;
  onRetry?: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="flex flex-col items-center gap-3 p-10 text-center"
    >
      <AlertTriangle className="size-8 text-red-500" aria-hidden />
      <p className="text-sm text-slate-700">{errorText(error, t)}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t("common.retry")}
        </Button>
      )}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-slate-900">{title}</h1>
        {subtitle && (
          <p className="mt-0.5 text-sm text-slate-500">{subtitle}</p>
        )}
      </div>
      {actions && (
        <div className="flex flex-wrap items-center gap-2">{actions}</div>
      )}
    </header>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  wide?: boolean;
  footer?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Dialog.Root open={open} onOpenChange={(o) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-900/50" />
        <Dialog.Content
          aria-describedby={undefined}
          className={cn(
            "fixed start-1/2 top-1/2 z-50 flex max-h-[92vh] w-[calc(100vw-1.5rem)] -translate-x-1/2 -translate-y-1/2 flex-col rounded-lg bg-white shadow-xl rtl:translate-x-1/2",
            wide ? "max-w-3xl" : "max-w-lg",
          )}
        >
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-3">
            <Dialog.Title className="text-base font-semibold text-slate-900">
              {title}
            </Dialog.Title>
            <Dialog.Close
              className="rounded p-1 text-slate-500 hover:bg-slate-100"
              aria-label={t("common.close")}
            >
              <X className="size-4" />
            </Dialog.Close>
          </div>
          <div className="overflow-y-auto px-5 py-4">{children}</div>
          {footer && (
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-3">
              {footer}
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  danger,
  loading,
  confirmDisabled,
  onConfirm,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
  loading?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
  onClose: () => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            {t("common.cancel")}
          </Button>
          <Button
            variant={danger ? "danger" : "primary"}
            loading={loading}
            disabled={confirmDisabled}
            onClick={onConfirm}
          >
            {confirmLabel ?? t("common.confirm")}
          </Button>
        </>
      }
    >
      {message && <p className="text-sm text-slate-600">{message}</p>}
      {children}
    </Modal>
  );
}

export function Pagination({
  page,
  totalPages,
  total,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPage: (p: number) => void;
}) {
  const { t } = useTranslation();
  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 px-4 py-3 text-sm text-slate-600"
      aria-label={t("common.pagination")}
    >
      <span>{t("common.totalCount", { count: total })}</span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page <= 1}
          onClick={() => onPage(page - 1)}
        >
          {t("common.previous")}
        </Button>
        <span aria-live="polite">
          {page} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          {t("common.next")}
        </Button>
      </div>
    </nav>
  );
}

export const Th = ({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) => (
  <th
    scope="col"
    className={cn(
      "whitespace-nowrap bg-slate-50 px-4 py-2.5 text-start text-xs font-semibold uppercase tracking-wide text-slate-500",
      className,
    )}
  >
    {children}
  </th>
);
export const Td = ({
  children,
  className,
}: {
  children?: ReactNode;
  className?: string;
}) => (
  <td className={cn("px-4 py-3 text-sm text-slate-700", className)}>
    {children}
  </td>
);

export function Tabs({
  tabs,
  value,
  onChange,
}: {
  tabs: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <div
      role="tablist"
      className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200"
    >
      {tabs.map((tb) => (
        <button
          key={tb.id}
          role="tab"
          aria-selected={value === tb.id}
          onClick={() => onChange(tb.id)}
          className={cn(
            "whitespace-nowrap border-b-2 px-4 py-2 text-sm font-medium",
            value === tb.id
              ? "border-teal-700 text-teal-800"
              : "border-transparent text-slate-500 hover:text-slate-800",
          )}
        >
          {tb.label}
        </button>
      ))}
    </div>
  );
}

export const DL = ({ items }: { items: [ReactNode, ReactNode][] }) => (
  <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2">
    {items.map(([k, v], i) => (
      <div key={i}>
        <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {k}
        </dt>
        <dd className="mt-0.5 text-sm text-slate-900">{v || "—"}</dd>
      </div>
    ))}
  </dl>
);
