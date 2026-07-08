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
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-line px-4 py-3 text-center text-xs text-steel">
          Unaffiliated, non-commercial fan project. Sprites served by Pokémon Showdown.
        </footer>
      </body>
    </html>
  );
}
