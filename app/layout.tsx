import type { Metadata } from "next";

import { SiteFooter } from "@/components/site-footer";
import { SiteHeader } from "@/components/site-header";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "RT-Lab | 放射線技師向けWebツール",
    template: "%s | RT-Lab",
  },
  description:
    "放射線技師向けの無料Webツール集。DRL比較、MTF計測、NPS計測をブラウザ完結で提供します。",
  keywords: [
    "放射線技師",
    "DRL",
    "MTF",
    "NPS",
    "線量管理",
    "画質評価",
  ],
  openGraph: {
    title: "RT-Lab | 放射線技師向けWebツール",
    description:
      "インストール不要・外部送信なしで使える、放射線技師向けの実務ツールサイト。",
    type: "website",
    locale: "ja_JP",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>
        <SiteHeader />
        <main>{children}</main>
        <SiteFooter />
      </body>
    </html>
  );
}
