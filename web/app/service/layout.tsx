import type { Metadata } from "next";

export const metadata: Metadata = { title: "Service" };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
