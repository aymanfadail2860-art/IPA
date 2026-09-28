import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";

export function InitialsAvatar({ initials, name, size = "md" }: { initials: string; name: string; size?: "sm" | "md" }) {
  return (
    <span
      aria-label={name}
      role="img"
      className={
        size === "sm"
          ? "inline-flex size-7 items-center justify-center rounded-full bg-brand-subtle text-caption font-semibold text-brand ring-2 ring-surface-raised"
          : "inline-flex size-9 items-center justify-center rounded-full bg-brand-subtle text-label font-semibold text-brand ring-2 ring-surface-raised"
      }
    >
      {initials}
    </span>
  );
}

/** AvatarStack — a row of avatars with access type on hover/focus. */
export function AvatarStack({ people }: { people: readonly { name: string; initials: string; access: string }[] }) {
  return (
    <ul className="flex -space-x-1" aria-label="Delt med">
      {people.map((person) => (
        <li key={person.name}>
          <Tooltip>
            <TooltipTrigger asChild>
              <span tabIndex={0} className="inline-flex rounded-full">
                <InitialsAvatar initials={person.initials} name={`${person.name}, ${person.access}`} size="sm" />
              </span>
            </TooltipTrigger>
            <TooltipContent>
              {person.name} · {person.access}
            </TooltipContent>
          </Tooltip>
        </li>
      ))}
    </ul>
  );
}
