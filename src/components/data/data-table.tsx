"use client";

import { ArrowDown, ArrowUp, ArrowUpDown, MoreHorizontal } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

import type { TableDensity } from "./density-toggle";

export interface DataTableColumn<Row> {
  id: string;
  header: string;
  cell: (row: Row) => ReactNode;
  /** When set, the column is sortable by this value. */
  sortValue?: (row: Row) => string | number;
  align?: "left" | "right";
  /** Visually hidden header, e.g. for an avatar column. */
  srOnlyHeader?: boolean;
  className?: string;
}

export interface DataTableRowAction<Row> {
  label: string;
  onSelect: (row: Row) => void;
}

/**
 * DataTable (docs/04-ui-ux-design.md §3.6): sticky header, no zebra — air and fine
 * dividers, sortable columns, two densities, row actions in a menu on the right and an
 * empty state. Below the tablet breakpoint the table becomes a list of cards (§19).
 */
export function DataTable<Row>({
  caption,
  columns,
  rows,
  getRowId,
  getRowLabel,
  density = "comfortable",
  rowActions,
  emptyState,
  className,
}: {
  caption: string;
  columns: readonly DataTableColumn<Row>[];
  rows: readonly Row[];
  getRowId: (row: Row) => string;
  /** Used in accessible names for row actions, e.g. "Handlinger for Bagerhuset ApS". */
  getRowLabel: (row: Row) => string;
  density?: TableDensity;
  rowActions?: readonly DataTableRowAction<Row>[];
  emptyState: ReactNode;
  className?: string;
}) {
  const [sort, setSort] = useState<{ id: string; direction: "asc" | "desc" } | null>(null);

  const sortedRows = useMemo(() => {
    if (!sort) return rows;
    const column = columns.find((entry) => entry.id === sort.id);
    if (!column?.sortValue) return rows;
    const factor = sort.direction === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const left = column.sortValue!(a);
      const right = column.sortValue!(b);
      if (typeof left === "number" && typeof right === "number") return (left - right) * factor;
      return String(left).localeCompare(String(right), "da") * factor;
    });
  }, [rows, columns, sort]);

  if (rows.length === 0) return <>{emptyState}</>;

  const cellPadding = density === "compact" ? "px-4 py-2" : "px-4 py-3.5";

  function toggleSort(id: string) {
    setSort((current) =>
      current?.id === id
        ? { id, direction: current.direction === "asc" ? "desc" : "asc" }
        : { id, direction: "asc" },
    );
  }

  function renderActions(row: Row) {
    if (!rowActions || rowActions.length === 0) return null;
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" aria-label={`Handlinger for ${getRowLabel(row)}`}>
            <MoreHorizontal aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {rowActions.map((action) => (
            <DropdownMenuItem key={action.label} onSelect={() => action.onSelect(row)}>
              {action.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return (
    <div className={cn("rounded-lg border border-border-subtle bg-surface-raised", className)}>
      {/* Tablet and up: a real table */}
      <div className="hidden max-h-[36rem] overflow-auto rounded-lg md:block">
        <table className="w-full border-collapse text-body">
          <caption className="sr-only">{caption}</caption>
          <thead className="sticky top-0 z-10 bg-surface-raised">
            <tr className="border-b border-border-subtle">
              {columns.map((column) => {
                const sorted = sort?.id === column.id ? sort.direction : null;
                return (
                  <th
                    key={column.id}
                    scope="col"
                    aria-sort={sorted === "asc" ? "ascending" : sorted === "desc" ? "descending" : undefined}
                    className={cn(
                      "px-4 py-2.5 text-left text-label whitespace-nowrap text-fg-secondary",
                      column.align === "right" && "text-right",
                    )}
                  >
                    {column.sortValue ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(column.id)}
                        className="inline-flex cursor-pointer items-center gap-1 rounded-sm hover:text-fg-primary"
                      >
                        {column.header}
                        {sorted === "asc" ? (
                          <ArrowUp className="size-3.5" aria-hidden />
                        ) : sorted === "desc" ? (
                          <ArrowDown className="size-3.5" aria-hidden />
                        ) : (
                          <ArrowUpDown className="size-3.5 opacity-50" aria-hidden />
                        )}
                      </button>
                    ) : (
                      <span className={cn(column.srOnlyHeader && "sr-only")}>{column.header}</span>
                    )}
                  </th>
                );
              })}
              {rowActions ? (
                <th scope="col" className="w-12 px-4 py-2.5">
                  <span className="sr-only">Handlinger</span>
                </th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {sortedRows.map((row) => (
              <tr key={getRowId(row)} className="border-b border-border-subtle last:border-b-0 hover:bg-surface-base">
                {columns.map((column) => (
                  <td
                    key={column.id}
                    className={cn(cellPadding, "align-middle", column.align === "right" && "text-right", column.className)}
                  >
                    {column.cell(row)}
                  </td>
                ))}
                {rowActions ? <td className={cn(cellPadding, "text-right")}>{renderActions(row)}</td> : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile: a list of cards */}
      <ul className="divide-y divide-border-subtle md:hidden" aria-label={caption}>
        {sortedRows.map((row) => (
          <li key={getRowId(row)} className="flex items-start justify-between gap-3 p-4">
            <dl className="min-w-0 flex-1 space-y-1.5">
              {columns.map((column, index) => (
                <div key={column.id} className={index === 0 ? "" : "flex items-baseline gap-2"}>
                  <dt className={index === 0 ? "sr-only" : "shrink-0 text-caption text-fg-tertiary"}>{column.header}</dt>
                  <dd className={index === 0 ? "font-medium" : "min-w-0 text-body"}>{column.cell(row)}</dd>
                </div>
              ))}
            </dl>
            {renderActions(row)}
          </li>
        ))}
      </ul>
    </div>
  );
}
