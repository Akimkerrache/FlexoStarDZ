import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Archive,
  Download,
  History as HistoryIcon,
  Link as LinkIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Badge,
  Button,
  EmptyState,
  Loading,
  Modal,
  errorText,
} from "@/components/ui";
import { files as filesApi } from "@/services/api";
import { fmtBytes, fmtDate } from "@/lib/utils";
import { useAuth, useUi } from "@/stores";
import type { FileAsset } from "@/types";

export async function openDownload(id: string) {
  const { url } = await filesApi.downloadUrl(id);
  window.open(url, "_blank", "noopener,noreferrer");
}

function Versions({ file, onClose }: { file: FileAsset; onClose: () => void }) {
  const { t } = useTranslation();
  const toast = useUi((s) => s.toast);
  const q = useQuery({
    queryKey: ["file-versions", file.id],
    queryFn: () => filesApi.versions(file.id),
  });
  return (
    <Modal
      open
      onClose={onClose}
      title={t("files.versionsOf", { name: file.originalName })}
    >
      {q.isLoading ? (
        <Loading />
      ) : (
        <ul className="divide-y divide-slate-100">
          {q.data?.map((v) => (
            <li
              key={v.id}
              className="flex items-center justify-between gap-2 py-2 text-sm"
            >
              <div>
                <p className="font-medium">
                  v{v.version}{" "}
                  <span className="ltr-text font-normal text-slate-600">
                    {v.originalName}
                  </span>
                </p>
                <p className="text-xs text-slate-500">
                  {fmtDate(v.createdAt, true)} · {fmtBytes(v.sizeBytes)}
                </p>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  openDownload(v.id).catch((e) =>
                    toast("error", errorText(e, t)),
                  )
                }
              >
                <Download className="size-4" /> {t("files.download")}
              </Button>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/** Lists files (all versions are preserved). `onNewVersion` lets staff/owners upload a replacement without deleting the original. */
export function FileList({
  files,
  links,
  onNewVersion,
  onChanged,
}: {
  files: FileAsset[];
  links?: { url: string; label?: string; host?: string }[];
  onNewVersion?: (f: FileAsset) => void;
  onChanged?: () => void;
}) {
  const { t } = useTranslation();
  const toast = useUi((s) => s.toast);
  const user = useAuth((s) => s.user);
  const [versions, setVersions] = useState<FileAsset | null>(null);
  const qc = useQueryClient();
  const archive = useMutation({
    mutationFn: (id: string) => filesApi.archive(id),
    onSuccess: () => {
      toast("success", t("common.saved"));
      onChanged?.();
      void qc.invalidateQueries({ queryKey: ["files"] });
    },
    onError: (e) => toast("error", errorText(e, t)),
  });
  // Show only the latest version of each document; older versions stay reachable via history.
  const latest = Object.values(
    files.reduce<Record<string, FileAsset>>((acc, f) => {
      if (!acc[f.versionGroupId] || acc[f.versionGroupId].version < f.version)
        acc[f.versionGroupId] = f;
      return acc;
    }, {}),
  );
  if (!latest.length && !links?.length)
    return <EmptyState title={t("files.none")} />;
  return (
    <ul className="divide-y divide-slate-100">
      {links?.map((l) => (
        <li key={l.url} className="flex items-center gap-2 py-2.5 text-sm">
          <LinkIcon className="size-4 text-slate-400" />
          <a
            href={l.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ltr-text min-w-0 flex-1 truncate text-teal-700 hover:underline"
          >
            {l.label || l.url}
          </a>
          <Badge>{t("files.externalLink")}</Badge>
          {l.host && (
            <span className="ltr-text text-xs text-slate-500">{l.host}</span>
          )}
        </li>
      ))}
      {latest.map((f) => (
        <li
          key={f.id}
          className="flex flex-wrap items-center gap-2 py-2.5 text-sm"
        >
          <div className="min-w-0 flex-1">
            <p className="ltr-text truncate font-medium">{f.originalName}</p>
            <p className="text-xs text-slate-500">
              v{f.version} · {fmtBytes(f.sizeBytes)} · {fmtDate(f.createdAt)} ·{" "}
              {t(`fileCategory.${f.category}`, { defaultValue: f.category })}
            </p>
          </div>
          {f.accessClass === "internal" && (
            <Badge tone="bg-amber-100 text-amber-800">
              {t("files.internal")}
            </Badge>
          )}
          <Badge tone="bg-slate-100 text-slate-600">
            {t("files.notScanned")}
          </Badge>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              openDownload(f.id).catch((e) => toast("error", errorText(e, t)))
            }
          >
            <Download className="size-4" /> {t("files.download")}
          </Button>
          {f.version > 1 || onNewVersion ? (
            <Button
              size="sm"
              variant="ghost"
              aria-label={t("files.history")}
              title={t("files.history")}
              onClick={() => setVersions(f)}
            >
              <HistoryIcon className="size-4" />
            </Button>
          ) : null}
          {onNewVersion && (
            <Button size="sm" variant="ghost" onClick={() => onNewVersion(f)}>
              {t("files.newVersion")}
            </Button>
          )}
          {(user?.role === "admin" || user?.role === "manager") && (
            <Button
              size="sm"
              variant="ghost"
              aria-label={t("common.archive")}
              title={t("common.archive")}
              onClick={() => archive.mutate(f.id)}
            >
              <Archive className="size-4" />
            </Button>
          )}
        </li>
      ))}
      {versions && (
        <Versions file={versions} onClose={() => setVersions(null)} />
      )}
    </ul>
  );
}
