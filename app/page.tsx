import Link from "next/link";

import { PrivacyNotice } from "@/components/privacy-notice";
import { SectionHeading } from "@/components/section-heading";
import { ToolCard } from "@/components/tool-card";
import { siteHighlights, tools } from "@/lib/site-data";

export default function HomePage() {
  return (
    <>
      <section className="hero">
        <div className="shell hero-grid">
          <div>
            <p className="eyebrow">Radiological Technology Lab</p>
            <h1>放射線技師の実務に、そのまま使えるWebツールを。</h1>
            <p className="hero-copy">
              RT-Lab は、線量管理や画質評価の現場で使いやすいブラウザツールをまとめた公開基盤です。
              インストール不要、外部送信なし、無料を前提に、まず使えることを大切にしています。
            </p>
            <div className="hero-actions">
              <Link className="button button-primary" href="/tools">
                ツール一覧を見る
              </Link>
              <Link className="button button-secondary" href="/about">
                サイトの方針
              </Link>
            </div>
          </div>
          <div className="hero-panel panel">
            <p className="panel-label">初回公開の主軸</p>
            <ul className="hero-list">
              <li>DRL比較でCT線量の適正確認</li>
              <li>MTF計測で空間分解能を可視化</li>
              <li>NPS計測でノイズ特性を定量評価</li>
            </ul>
            <div className="metric-row">
              <div>
                <strong>3</strong>
                <span>公開ツール</span>
              </div>
              <div>
                <strong>100%</strong>
                <span>ブラウザ完結</span>
              </div>
              <div>
                <strong>0</strong>
                <span>保存前提機能</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="shell">
          <SectionHeading
            eyebrow="Core Value"
            title="現場導線を先に整えるサイト構成"
            description="説明だけで終わらず、入力条件や注意点まで含めてその場で使える状態を目指します。"
          />
          <div className="feature-grid">
            {siteHighlights.map((item) => (
              <article className="feature-card" key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="section section-contrast">
        <div className="shell">
          <SectionHeading
            eyebrow="Tools"
            title="公開中の主要ツール"
            description="既存ツール資産を活かしながら、共通UIと情報整理を先に進めています。"
          />
          <div className="tool-grid">
            {tools.map((tool) => (
              <ToolCard key={tool.slug} tool={tool} />
            ))}
          </div>
        </div>
      </section>

      <div className="shell">
        <PrivacyNotice />
      </div>
    </>
  );
}
