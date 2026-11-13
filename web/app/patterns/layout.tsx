import type { Metadata } from "next";

export const metadata: Metadata = { title: "Load patterns" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
