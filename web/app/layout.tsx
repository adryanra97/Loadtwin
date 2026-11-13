import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Header } from "@/components/shell";
import "./globals.css";
import "./product.css";
import "./tool-polish.css";

const display = localFont({
  src: "./fonts/bricolage-grotesque.woff2",
  variable: "--font-display",
  weight: "200 800",
  display: "swap",
  adjustFontFallback: "Arial",
});
const ui = localFont({
  src: "./fonts/instrument-sans.woff2",
  variable: "--font-ui",
  weight: "400 700",
  display: "swap",
  adjustFontFallback: "Arial",
});

export const metadata: Metadata = {
  title: { default: "LoadTwin", template: "%s · LoadTwin" },
  description:
    "LoadTwin is a simulation-led capacity planning tool. Test peak traffic, compare server configurations, explore bottlenecks and understand SLA risk before deployment.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0f131c" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable}`}>
      <body>
        <a className="skip" href="#main">
          Skip to content
        </a>
        <Header />
        <main id="main" tabIndex={-1}>
          {children}
        </main>
        <footer>
          LoadTwin runs a discrete-event simulation (SimPy) calibrated on your measurements. Results are estimates; confirm
          critical decisions with a load test. Your service settings stay in this browser.
        </footer>
      </body>
    </html>
  );
}
