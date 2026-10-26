import { useRef, useState } from "react";
import { CheckCircle2, FileUp, RotateCcw, X, XCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useQuery } from "@tanstack/react-query";
import { Button, errorText } from "@/components/ui";
import { uploadFile, type UploadHandle, type UploadTarget } from "@/lib/upload";
import { fmtBytes } from "@/lib/utils";
import { settings } from "@/services/api";
import type { FileAsset } from "@/types";

interface Item {
  id: number;
  file: File;
  progress: number;
  status: "uploading" | "done" | "error";
  error?: string;
  handle?: UploadHandle;
}

let seq = 0;

export function useSettings() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: settings.get,
    staleTime: 5 * 60_000,
  });
}

/** File picker with per-file progress, cancel and retry. Bytes go straight to object storage. */
export function Uploader({
  target,
  onUploaded,
  disabled,
  disabledReason,
  multiple = true,
  label,
}: {
  target: UploadTarget;
  onUploaded: (f: FileAsset) => void;
  disabled?: boolean;
  disabledReason?: string;
  multiple?: boolean;
  label?: string;
}) {
  const { t } = useTranslation();
  const cfg = useSettings().data;
  const input = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<Item[]>([]);
  const patch = (id: number, p: Partial<Item>) =>
    setItems((xs) => xs.map((x) => (x.id === id ? { ...x, ...p } : x)));
  const notConfigured = cfg && !cfg.storageConfigured;

  const start = (it: Item) => {
    const handle = uploadFile(it.file, target, (progress) =>
      patch(it.id, { progress }),
    );
    patch(it.id, {
      status: "uploading",
      progress: 0,
      error: undefined,
      handle,
    });
    handle.promise
      .then((f) => {
        patch(it.id, { status: "done", progress: 100 });
        onUploaded(f);
      })
      .catch((e) =>
        patch(it.id, {
          status: "error",
          error:
            e?.name === "AbortError" ? t("upload.cancelled") : errorText(e, t),
        }),
      );
  };

  const add = (list: FileList | null) => {
    if (!list) return;
    for (const file of Array.from(list)) {
      const it: Item = { id: ++seq, file, progress: 0, status: "uploading" };
      if (cfg && file.size > cfg.maxUploadSizeMb * 1024 * 1024) {
        setItems((xs) => [
          ...xs,
          {
            ...it,
            status: "error",
            error: t("upload.tooLarge", { max: cfg.maxUploadSizeMb }),
          },
        ]);
        continue;
      }
      setItems((xs) => [...xs, it]);
      start(it);
    }
    if (input.current) input.current.value = "";
  };

  const off = disabled || !!notConfigured;
  return (
    <div className="space-y-2">
      <input
        ref={input}
        id="file-input"
        type="file"
        multiple={multiple}
        className="sr-only"
        disabled={off}
        onChange={(e) => add(e.target.files)}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          disabled={off}
          onClick={() => input.current?.click()}
        >
          <FileUp className="size-4" /> {label ?? t("upload.choose")}
        </Button>
        <span className="text-xs text-slate-500">
          {off
            ? notConfigured
              ? t("upload.notConfigured")
              : disabledReason
            : t("upload.hint", { max: cfg?.maxUploadSizeMb ?? "…" })}
        </span>
      </div>
      {items.length > 0 && (
        <ul className="space-y-2">
          {items.map((it) => (
            <li
              key={it.id}
              className="rounded-md border border-slate-200 p-2 text-sm"
            >
              <div className="flex items-center gap-2">
                {it.status === "done" ? (
                  <CheckCircle2 className="size-4 text-emerald-600" />
                ) : it.status === "error" ? (
                  <XCircle className="size-4 text-red-600" />
                ) : null}
                <span className="ltr-text flex-1 truncate">{it.file.name}</span>
                <span className="text-xs text-slate-500">
                  {fmtBytes(it.file.size)}
                </span>
                {it.status === "uploading" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t("upload.cancel")}
                    onClick={() => it.handle?.cancel()}
                  >
                    <X className="size-4" />
                  </Button>
                )}
                {it.status === "error" &&
                  !it.error?.includes(String(cfg?.maxUploadSizeMb ?? "")) && (
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t("common.retry")}
                      onClick={() => start(it)}
                    >
                      <RotateCcw className="size-4" />
                    </Button>
                  )}
              </div>
              {it.status === "uploading" && (
                <div
                  className="mt-1.5 h-1.5 overflow-hidden rounded bg-slate-100"
                  role="progressbar"
                  aria-valuenow={it.progress}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full bg-teal-600 transition-all"
                    style={{ width: `${it.progress}%` }}
                  />
                </div>
              )}
              {it.error && (
                <p role="alert" className="mt-1 text-xs text-red-600">
                  {it.error}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
