import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge must know the custom typography tokens (text-display, text-heading-1, …)
 * as font sizes. Otherwise it treats them as text colours and silently drops either the
 * size or the colour when both are combined in one className.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [
        {
          text: [
            "display",
            "heading-1",
            "heading-2",
            "heading-3",
            "body",
            "reading",
            "label",
            "caption",
            "mono",
          ],
        },
      ],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
