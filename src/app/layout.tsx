import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { Noto_Sans_SC } from "next/font/google";
import "./globals.css";

const notoSansSC = Noto_Sans_SC({
  subsets: ["latin"],
  variable: "--font-noto-sans-sc",
  display: "swap"
});

export const metadata: Metadata = {
  title: "G&G PayOps · 运输结算中心",
  description: "G&G Transport driver trip, mileage, payroll, and Load allocation management system."
};

/* Tints the mobile browser chrome to match the navy sign-in cover */
export const viewport: Viewport = {
  themeColor: "#0c1f30"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="zh-CN"
      className={`${GeistSans.variable} ${GeistMono.variable} ${notoSansSC.variable}`}
      suppressHydrationWarning
    >
      <body suppressHydrationWarning>{children}</body>
    </html>
  );
}
