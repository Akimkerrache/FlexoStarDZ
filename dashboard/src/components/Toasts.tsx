import { CheckCircle2, Info, XCircle, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useUi } from "@/stores";
import { cn } from "@/lib/utils";

export function Toasts() {
  const { toasts, dismiss } = useUi();
  const { t } = useTranslation();
  return (
    <div
      className="pointer-events-none fixed bottom-4 end-4 z-[60] flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2"
      aria-live="polite"
    >
      {toasts.map((x) => (
        <div
          key={x.id}
          role={x.kind === "error" ? "alert" : "status"}
          className={cn(
            "pointer-events-auto flex items-start gap-2 rounded-md border bg-white p-3 text-sm shadow-lg",
            x.kind === "error"
              ? "border-red-200"
              : x.kind === "success"
                ? "border-emerald-200"
                : "border-slate-200",
          )}
        >
          {x.kind === "error" ? (
            <XCircle className="mt-0.5 size-4 shrink-0 text-red-600" />
          ) : x.kind === "success" ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" />
          ) : (
            <Info className="mt-0.5 size-4 shrink-0 text-sky-600" />
          )}
          <p className="flex-1 text-slate-700">{x.text}</p>
          <button
            onClick={() => dismiss(x.id)}
            aria-label={t("common.close")}
            className="text-slate-400 hover:text-slate-700"
          >
            <X className="size-4" />
          </button>
        </div>
      ))}
    </div>
  );
}
