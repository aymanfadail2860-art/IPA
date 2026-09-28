import { Inter, JetBrains_Mono } from "next/font/google";

/*
 * Typography (docs/05-foundation-implementation.md): Inter for the interface and reading
 * text, JetBrains Mono for versions, ids and technical values. next/font downloads the
 * files at build time and serves them from the app's own origin — no request reaches
 * Google from the user's browser.
 */
export const inter = Inter({
  subsets: ["latin", "latin-ext"],
  variable: "--font-inter",
  display: "swap",
});

export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});
