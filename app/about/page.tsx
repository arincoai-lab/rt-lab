import type { Metadata } from "next";

import { SectionHeading } from "@/components/section-heading";
import { aboutPoints } from "@/lib/site-data";

export const metadata: Metadata = {
  title: "サイトについて",
  description:
    "RT-Lab の公開方針、対象ユーザー、データの扱い、初回公開の考え方をまとめています。",
};

export default function AboutPage() {
  return (
    <section className="section">
      <div className="shell page-stack">
        <SectionHeading
          eyebrow="About RT-Lab"
          title="RT-Labの立ち位置"
          description="まず使えることを大切にしながら、放射線技師向けツールを段階的に育てるための公開基盤です。"
        />

        <div className="detail-grid">
          {aboutPoints.map((point) => (
            <article className="panel" key={point}>
              <p>{point}</p>
            </article>
          ))}
        </div>

        <article className="panel">
          <p className="eyebrow">初回公開の考え方</p>
          <h2>まずは共通導線と安心感を整える</h2>
          <p className="panel-copy">
            既存の DRL比較、MTF計測、NPS計測ツールはすでに利用可能なため、初回ではそれらを壊さずに、
            サイト全体の案内、説明、デザイン基盤、メタデータを先に整えます。
          </p>
          <p className="panel-copy">
            将来的な全面再設計に備え、色・余白・影・角丸・見出しサイズなどはデザイントークンとして共通管理し、
            ブランド表現の見直しがしやすい構成にします。
          </p>
        </article>
      </div>
    </section>
  );
}
