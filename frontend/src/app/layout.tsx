import type { Metadata } from "next";
import "../styles/globals.css";
import { Header } from "@/components/nav/Header";
import { Footer } from "@/components/nav/Footer";

export const metadata: Metadata = {
  title: "Commercial Auto Underwriting Copilot — Julio Contreras × The Hartford",
  description:
    "An end-to-end GenAI underwriting system: LangGraph on Vertex AI, hybrid RAG over real public carrier data, classical ML loss models, and a 3-track evaluation harness. Built as a portfolio piece for The Hartford's Applied AI team.",
  metadataBase: new URL("https://juliooo.com"),
  openGraph: {
    title: "Commercial Auto Underwriting Copilot",
    description:
      "GenAI underwriting copilot built for The Hartford's Applied AI Middle & Large Business team.",
    url: "https://juliooo.com/hartford",
    siteName: "juliooo.com",
    type: "website",
  },
  robots: { index: true, follow: true },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="dark">
      <body>
        <Header />
        <main className="min-h-[calc(100vh-7rem)]">{children}</main>
        <Footer />
      </body>
    </html>
  );
}
