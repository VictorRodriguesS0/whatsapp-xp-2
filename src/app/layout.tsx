import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import type { ReactNode } from "react";

import { ThemeProvider, themeBootstrapScript } from "@/components/theme/theme-provider";

import "./globals.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist",
});

export const metadata: Metadata = {
  title: "XP Atendimento",
  description: "Central interna de atendimento da XP Eletrônicos.",
  applicationName: "XP Atendimento",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/xp-16.png", sizes: "16x16", type: "image/png" },
      { url: "/icons/xp-32.png", sizes: "32x32", type: "image/png" },
    ],
    apple: [{ url: "/icons/xp-180.png", sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: "XP Atendimento",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#eef2f6" },
    { media: "(prefers-color-scheme: dark)", color: "#050505" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html className={geist.variable} lang="pt-BR" suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeBootstrapScript }} />
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
