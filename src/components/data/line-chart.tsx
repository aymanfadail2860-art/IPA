"use client";

import { Table2 } from "lucide-react";
import { useId, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * LineChart — calm, no 3D or gradients, one series here (max four, §3.6). Every chart
 * has a heading that says what is shown and an accessible data table behind "Vis data".
 */
export function LineChart({
  title,
  description,
  data,
  unit = "%",
  max = 100,
}: {
  title: string;
  description?: string;
  data: readonly { label: string; value: number }[];
  unit?: string;
  max?: number;
}) {
  const [showData, setShowData] = useState(false);
  const tableId = useId();
  const width = 560;
  const height = 200;
  const padding = { top: 16, right: 16, bottom: 28, left: 36 };
  const innerWidth = width - padding.left - padding.right;
  const innerHeight = height - padding.top - padding.bottom;
  const x = (index: number) => padding.left + (data.length === 1 ? innerWidth / 2 : (index / (data.length - 1)) * innerWidth);
  const y = (value: number) => padding.top + innerHeight - (value / max) * innerHeight;
  const path = data.map((point, index) => `${index === 0 ? "M" : "L"}${x(index)},${y(point.value)}`).join(" ");
  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((fraction) => Math.round(max * fraction));

  return (
    <figure className="rounded-lg border border-border-subtle bg-surface-raised p-5">
      <div className="mb-3 flex items-start justify-between gap-4">
        <figcaption>
          <p className="text-heading-3 text-fg-primary">{title}</p>
          {description ? <p className="text-caption text-fg-secondary">{description}</p> : null}
        </figcaption>
        <Button variant="ghost" size="sm" aria-expanded={showData} aria-controls={tableId} onClick={() => setShowData((v) => !v)}>
          <Table2 aria-hidden />
          {showData ? "Skjul data" : "Vis data"}
        </Button>
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="h-auto w-full" role="img" aria-label={`${title}. Se data i tabellen.`}>
        {gridLines.map((value) => (
          <g key={value}>
            <line x1={padding.left} x2={width - padding.right} y1={y(value)} y2={y(value)} stroke="var(--border-subtle)" />
            <text x={padding.left - 8} y={y(value) + 4} textAnchor="end" fontSize="11" fill="var(--text-tertiary)">
              {value}
            </text>
          </g>
        ))}
        <path d={path} fill="none" stroke="var(--brand-primary)" strokeWidth="2" strokeLinejoin="round" />
        {data.map((point, index) => (
          <g key={point.label}>
            <circle cx={x(index)} cy={y(point.value)} r="3.5" fill="var(--surface-raised)" stroke="var(--brand-primary)" strokeWidth="2" />
            <text x={x(index)} y={height - 8} textAnchor="middle" fontSize="11" fill="var(--text-tertiary)">
              {point.label}
            </text>
          </g>
        ))}
      </svg>

      <div id={tableId} hidden={!showData} className="mt-4">
        <table className="w-full text-body">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="border-b border-border-subtle text-label text-fg-secondary">
              <th scope="col" className="py-2 text-left">Periode</th>
              <th scope="col" className="py-2 text-right">Værdi</th>
            </tr>
          </thead>
          <tbody>
            {data.map((point) => (
              <tr key={point.label} className="border-b border-border-subtle last:border-0">
                <td className="py-1.5">{point.label}</td>
                <td className="tabular py-1.5 text-right">
                  {point.value} {unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </figure>
  );
}
