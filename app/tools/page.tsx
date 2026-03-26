import type { Metadata } from "next";

import { SectionHeading } from "@/components/section-heading";
import { ToolCard } from "@/components/tool-card";
import { tools } from "@/lib/site-data";

export const metadata: Metadata = {
  title: "ツール一覧",
  description:
    "DRL比較、MTF計測、NPS計測など、RT-Lab が提供する放射線技師向けブラウザツールの一覧です。",
};

export default function ToolsPage() {
  return (
    <section className="section">
      <div className="shell">
        <SectionHeading
          eyebrow="Tool Directory"
          title="用途から選べるツール一覧"
          description="入力形式、得られる結果、運用上の注意を整理したうえで、それぞれの既存ツールへ接続します。"
        />
        <div className="tool-grid">
          {tools.map((tool) => (
            <ToolCard key={tool.slug} tool={tool} />
          ))}
        </div>
      </div>
    </section>
  );
}
