import type { Metadata } from "next";
import { MissionControl } from "@/components/mission-control";
import { MockModeProvider } from "@/lib/mock-mode";
import "./globals.css";

export const metadata: Metadata = {
  title: "mrkrabs",
  description:
    "An AI agent that builds a $1M NASDAQ portfolio using Cala's verified knowledge graph.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <MockModeProvider>
          {children}
          <MissionControl />
        </MockModeProvider>
      </body>
    </html>
  );
}
