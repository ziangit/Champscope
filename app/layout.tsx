import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { Barlow_Condensed, IBM_Plex_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const barlow = Barlow_Condensed({
  variable: "--font-barlow",
  weight: ["500", "600", "700"],
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  weight: ["400", "600"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Champscope",
  description: "VGC-first Pokémon Showdown replay scouting for the Champions era",
  // Hotlinked from the official Showdown client (we bundle no Pokémon assets).
  // gen6 over gen5: Floette fills 85% of that canvas vs 25%, so the tab icon
  // reads at 16px instead of vanishing.
  icons: { icon: "https://play.pokemonshowdown.com/sprites/gen6/floette.png" },
};

const NAV = [
  { href: "/scout", label: "Scout" },
  { href: "/teams", label: "Teams" },
  { href: "/match", label: "Match" },
  { href: "/watch", label: "Watch" },
] as const;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${barlow.variable} ${plexMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <header className="border-b border-line bg-card">
          <div className="mx-auto flex max-w-6xl items-baseline gap-8 px-4 py-3">
            <Link
              href="/"
              className="font-display text-2xl font-bold uppercase tracking-wide text-ink"
            >
              Champ<span className="text-accent">scope</span>
            </Link>
            <nav className="flex gap-5 font-display text-lg font-semibold uppercase tracking-wide text-steel">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href} className="hover:text-ink">
                  {n.label}
                </Link>
              ))}
            </nav>
            <a
              href="https://github.com/ziangit/Champscope"
              target="_blank"
              rel="noreferrer"
              className="ml-auto self-center text-steel hover:text-ink"
              title="Champscope on GitHub — stars appreciated!"
              aria-label="Champscope on GitHub"
            >
              <svg viewBox="0 0 16 16" width="22" height="22" fill="currentColor" aria-hidden>
                <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
              </svg>
            </a>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-line px-4 py-3 text-center text-xs text-steel">
          Unaffiliated, non-commercial fan project. Sprites served by Pokémon Showdown.
        </footer>
        <Analytics />
      </body>
    </html>
  );
}
