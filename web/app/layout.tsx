import type { Metadata, Viewport } from "next";
import { Header } from "@/components/shell";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "LoadTwin", template: "%s · LoadTwin" },
  description:
    "Capacity planning with a SimPy digital twin: verdicts, breach probability, cost-aware auto-sizing, load patterns and model validation.",
  icons: { icon: "/icon.svg" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9f9f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0d" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
