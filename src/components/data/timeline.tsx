import { formatDate, formatTime } from "@/lib/format";

/** Timeline — chronological list of events (case history, versions). */
export function Timeline({
  items,
  showTime = false,
}: {
  items: readonly { id?: string; at: string; text: string; detail?: string }[];
  showTime?: boolean;
}) {
  return (
    <ol className="relative space-y-4 border-l border-border-subtle pl-4">
      {items.map((item, index) => (
        <li key={item.id ?? `${item.at}-${index}`} className="relative">
          <span aria-hidden className="absolute top-1.5 -left-[1.3rem] size-2 rounded-full bg-border-strong" />
          <p className="text-body text-fg-primary">{item.text}</p>
          {item.detail ? <p className="text-caption text-fg-secondary">{item.detail}</p> : null}
          <p className="text-caption text-fg-tertiary">
            <time dateTime={item.at}>
              {formatDate(item.at)}
              {showTime ? ` · ${formatTime(item.at)}` : ""}
            </time>
          </p>
        </li>
      ))}
    </ol>
  );
}
