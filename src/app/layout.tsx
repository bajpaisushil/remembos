import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import type { ReactNode } from "react";
import { OnboardingDialog } from "@/components/data/OnboardingDialog";
import { AddSheet } from "@/components/shell/AddSheet";
import { AppBackdrop } from "@/components/shell/AppBackdrop";
import { DatabaseGate } from "@/components/shell/DatabaseGate";
import { Footer } from "@/components/shell/Footer";
import { GlobalDropOverlay } from "@/components/shell/GlobalDropOverlay";
import { LazyMounts } from "@/components/shell/LazyMounts";
import { Header } from "@/components/shell/Header";
import { EARLY_INSTALL_PROMPT_SCRIPT, LAUNCH_ACTION_SCRIPT } from "@/components/shell/launch";
import { MobileNav } from "@/components/shell/MobileNav";
import { Providers } from "@/components/shell/Providers";
import { THEME_INIT_SCRIPT } from "@/components/shell/theme";
import { Toaster } from "@/components/shell/Toaster";
import { APP_NAME, BASE_PATH } from "@/lib/config";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});

const DESCRIPTION =
  "Drop screenshots, PDFs, videos, voice notes and text — Remembos turns them into a private, searchable memory. " +
  "Reading, transcribing and search run entirely in your browser. No uploads, no account.";

/** Runs in <head> before first paint: theme class, early install prompt capture, `?action=` → `#upload`/`#paste`. */
const HEAD_SCRIPT = THEME_INIT_SCRIPT + EARLY_INSTALL_PROMPT_SCRIPT + LAUNCH_ACTION_SCRIPT;

export const metadata: Metadata = {
  title: {
    default: `${APP_NAME} — your private memory`,
    template: `%s · ${APP_NAME}`,
  },
  description: DESCRIPTION,
  applicationName: APP_NAME,
  manifest: `${BASE_PATH}/manifest.webmanifest`,
  icons: {
    icon: [{ url: `${BASE_PATH}/icons/icon-192.png`, sizes: "192x192", type: "image/png" }],
    apple: [{ url: `${BASE_PATH}/icons/apple-touch-icon.png`, sizes: "180x180", type: "image/png" }],
  },
  appleWebApp: {
    capable: true,
    title: APP_NAME,
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false, email: false, address: false },
  openGraph: {
    type: "website",
    siteName: APP_NAME,
    title: `${APP_NAME} — your private memory`,
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary",
    title: `${APP_NAME} — your private memory`,
    description: DESCRIPTION,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fbfbfd" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a12" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable}`}
    >
      <head>
        {/* Sets the light/dark class before first paint (no theme flash), keeps an early install prompt and
            turns home-screen shortcut URLs into in-page anchors before the app loads. */}
        <script dangerouslySetInnerHTML={{ __html: HEAD_SCRIPT }} />
      </head>
      <body className="min-h-dvh font-sans antialiased">
        <AppBackdrop />
        <Providers>
          <DatabaseGate>
            <a href="#main" className="skip-link">
              Skip to content
            </a>
            <div className="relative flex min-h-dvh flex-col">
              <Header />
              <main id="main" className="flex-1">
                {children}
              </main>
              <Footer />
            </div>
            <MobileNav />
            <GlobalDropOverlay />
            <AddSheet />
            <OnboardingDialog />
            <LazyMounts />
          </DatabaseGate>
          <Toaster />
        </Providers>
      </body>
    </html>
  );
}
