import { useEffect, useState, type ReactNode } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Search } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  EmptyState,
  ErrorState,
  Input,
  Loading,
  Pagination,
  Td,
  Th,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import type { Paged } from "@/types";

export interface Column<T> {
  key: string;
  header: ReactNode;
  render: (row: T) => ReactNode;
  sortKey?: string;
  className?: string;
}

export function useDebounced<T>(value: T, ms = 350) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return v;
}

interface Props<T> {
  queryKey: unknown[];
  fetcher: (
    q: Record<string, string | number | undefined>,
  ) => Promise<Paged<T>>;
  columns: Column<T>[];
  filters?: Record<string, string | undefined>;
  toolbar?: ReactNode;
  searchable?: boolean;
  defaultSort?: string;
  empty?: ReactNode;
  rowKey?: (r: T) => string;
  onRowClick?: (r: T) => void;
  pageSize?: number;
}

/** Server-driven table: search, filters, sorting and pagination are all executed by the API. */
export function DataTable<T extends { id: string }>({
  queryKey,
  fetcher,
  columns,
  filters,
  toolbar,
  searchable = true,
  defaultSort,
  empty,
  onRowClick,
  pageSize = 20,
}: Props<T>) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [sort, setSort] = useState<string | undefined>(defaultSort);
  const debounced = useDebounced(search);
  const filterKey = JSON.stringify(filters ?? {});
  useEffect(() => setPage(1), [debounced, filterKey, sort]);

  const q = useQuery({
    queryKey: [
      ...queryKey,
      { page, search: debounced, sort, filters: filterKey },
    ],
    queryFn: () =>
      fetcher({
        page,
        limit: pageSize,
        search: debounced || undefined,
        sort,
        ...(filters ?? {}),
      }),
    placeholderData: keepPreviousData,
  });

  const toggleSort = (k: string) =>
    setSort((s) => (s === k ? `-${k}` : s === `-${k}` ? undefined : k));

  return (
    <div className="rounded-lg border border-slate-200 bg-white shadow-sm">
      {(searchable || toolbar) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 p-3">
          {searchable && (
            <div className="relative min-w-52 flex-1 sm:max-w-xs">
              <Search
                className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
                aria-hidden
              />
              <Input
                aria-label={t("common.search")}
                placeholder={t("common.search")}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="ps-9"
              />
            </div>
          )}
          {toolbar}
        </div>
      )}
      {q.isLoading ? (
        <Loading />
      ) : q.isError ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : !q.data?.items.length ? (
        (empty ?? <EmptyState />)
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max border-collapse">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <Th key={c.key} className={c.className}>
                      {c.sortKey ? (
                        <button
                          className="inline-flex items-center gap-1 uppercase"
                          onClick={() => toggleSort(c.sortKey!)}
                          aria-label={t("common.sortBy")}
                        >
                          {c.header}
                          {sort === c.sortKey && <ArrowUp className="size-3" />}
                          {sort === `-${c.sortKey}` && (
                            <ArrowDown className="size-3" />
                          )}
                        </button>
                      ) : (
                        c.header
                      )}
                    </Th>
                  ))}
                </tr>
              </thead>
              <tbody
                className={cn(
                  "divide-y divide-slate-100",
                  q.isFetching && "opacity-60",
                )}
              >
                {q.data.items.map((row) => (
                  <tr
                    key={row.id}
                    className={cn(
                      "hover:bg-slate-50",
                      onRowClick && "cursor-pointer",
                    )}
                    onClick={() => onRowClick?.(row)}
                    onKeyDown={(e) =>
                      onRowClick && e.key === "Enter" && onRowClick(row)
                    }
                    tabIndex={onRowClick ? 0 : undefined}
                  >
                    {columns.map((c) => (
                      <Td key={c.key} className={c.className}>
                        {c.render(row)}
                      </Td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={q.data.meta.page}
            totalPages={q.data.meta.totalPages}
            total={q.data.meta.total}
            onPage={setPage}
          />
        </>
      )}
    </div>
  );
}
