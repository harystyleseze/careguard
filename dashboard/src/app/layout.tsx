import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { fetchProfile } from "../lib/fetchProfile";

export async function generateMetadata(): Promise<Metadata> {
  const profile = await fetchProfile();
  const { recipient } = profile;

  const title = `${recipient.name}'s CareGuard`;
  const description = "AI agent that autonomously manages elderly healthcare spending on Stellar";
  const ogImage = recipient.avatar || "/icon-512.png";

export const metadata: Metadata = {
  title: "CareGuard - AI Healthcare Agent",
  description:
    "AI agent that autonomously manages elderly healthcare spending on Stellar",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased"
    >
      <body className="min-h-full flex flex-col overflow-x-hidden bg-slate-50 text-slate-900">
        {children}
        <Toaster />
      </body>
    </html>
  );
}
