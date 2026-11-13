import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { Header } from "@/components/shell";
import "./globals.css";
import "./product.css";
import "./tool-polish.css";
import "./editorial.css";
import "./experience-system.css";
import "./typography.css";

const display = localFont({
  src: "./fonts/bricolage-grotesque.woff2",
  variable: "--font-display",
  weight: "200 800",
  display: "swap",
  adjustFontFallback: "Arial",
});
const serif = localFont({
  src: [
    { path: "./fonts/instrument-serif.woff2", style: "normal", weight: "400" },
    { path: "./fonts/instrument-serif-italic.woff2", style: "italic", weight: "400" },
  ],
  variable: "--font-serif",
  display: "swap",
  adjustFontFallback: "Times New Roman",
});
const ui = localFont({
  src: "./fonts/instrument-sans.woff2",
  variable: "--font-ui",
  weight: "400 700",
  display: "swap",
  adjustFontFallback: "Arial",
});

export const metadata: Metadata = {
  title: { default: "LoadTwin — Capacity Intelligence", template: "%s · LoadTwin" },
  description:
    "LoadTwin is a simulation-led capacity planning tool. Test peak traffic, compare server configurations, explore bottlenecks and understand SLA risk before deployment.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: "#061927",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${ui.variable} ${serif.variable}`}>
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
