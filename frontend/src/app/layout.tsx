import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans } from "next/font/google";
import { ThemeSync } from "@/components/theme-toggle";
import { themeScript } from "@/lib/theme-script";
import "./globals.css";

const plex = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex",
  display: "swap",
});

export const metadata: Metadata = {
  title: { default: "Talaan", template: "%s · Talaan" },
  description: "Job application tracker.",
};

// viewport-fit=cover makes env(safe-area-inset-*) work. Zoom stays enabled.
export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={plex.variable} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-screen text-body"><ThemeSync />
        {children}
      </body>
    </html>
  );
}
