import type { Metadata, Viewport } from "next";

import { TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

import { inter, jetbrainsMono } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "Insurance Partners",
    template: "%s · Insurance Partners",
  },
  description: "AI-baseret platform til erhvervsforsikringsrådgivere.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#13294b",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="da" className={cn(inter.variable, jetbrainsMono.variable, "h-full")}>
      <body className="min-h-full">
        <TooltipProvider delayDuration={300}>{children}</TooltipProvider>
      </body>
    </html>
  );
}
