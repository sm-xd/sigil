import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Fraunces, IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { Nav } from "@/components/Nav";
import { Providers } from "@/components/Providers";
import "./globals.css";

// Self-hosted at build. Fraunces is the variable face with its optical-size axis on; the Plex families carry only the three permitted weights.
const fraunces = Fraunces({ subsets: ["latin"], weight: "variable", axes: ["opsz"], variable: "--font-fraunces", display: "swap" });
const plexSans = IBM_Plex_Sans({ subsets: ["latin"], weight: ["400", "500", "600"], variable: "--font-plex-sans", display: "swap" });
const plexMono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "500"], variable: "--font-plex-mono", display: "swap" });

export const metadata: Metadata = { title: "Sigil — capital at risk, not opinions", description: "Staked, machine-testable claims about what an agent skill does." };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${fraunces.variable} ${plexSans.variable} ${plexMono.variable}`}>
      <body>
        <Providers>
          <Nav />
          <main className="mx-auto max-w-page px-5 pb-24 md:px-8">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
