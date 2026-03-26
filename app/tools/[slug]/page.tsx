import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { PrivacyNotice } from "@/components/privacy-notice";
import { ToolDetailHero } from "@/components/tool-detail-hero";
import { getTool, tools } from "@/lib/site-data";

type ToolPageProps = {
  params: Promise<{ slug: string }>;
};

export async function generateStaticParams() {
  return tools.map((tool) => ({ slug: tool.slug }));
}

export async function generateMetadata({
  params,
}: ToolPageProps): Promise<Metadata> {
  const { slug } = await params;
  const tool = getTool(slug);

  if (!tool) {
    return {};
  }

  return {
    title: tool.label,
    description: tool.description,
  };
}

export default async function ToolDetailPage({ params }: ToolPageProps) {
  const { slug } = await params;
  const tool = getTool(slug);

  if (!tool) {
    notFound();
  }

  return (
    <div className="shell page-stack">
      <ToolDetailHero tool={tool} />

      <section className="detail-grid">
        <article className="panel">
          <p className="eyebrow">誰向けか</p>
          <h2>想定ユーザー</h2>
          <p>{tool.audience}</p>
        </article>
        <article className="panel">
          <p className="eyebrow">何ができるか</p>
          <h2>主なアウトプット</h2>
          <ul className="detail-list">
            {tool.output.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </section>

      <section className="detail-grid">
        <article className="panel">
          <p className="eyebrow">入力</p>
          <h2>受け付けるデータ</h2>
          <ul className="detail-list">
            {tool.input.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
        <article className="panel">
          <p className="eyebrow">注意点</p>
          <h2>利用前に確認したいこと</h2>
          <ul className="detail-list">
            {tool.notices.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </article>
      </section>

      <section className="panel">
        <p className="eyebrow">利用導線</p>
        <h2>既存ツールで今すぐ使う</h2>
        <p className="panel-copy">
          初回リリースでは、既存の実装済みツール画面を活かして提供します。共通サイト基盤で説明や導線を整理しつつ、
          ツール本体は段階的に統合していきます。
        </p>
        <div className="hero-actions">
          <Link className="button button-primary" href={tool.legacyHref}>
            {tool.label}を開く
          </Link>
          {tool.sampleHref ? (
            <Link className="button button-secondary" href={tool.sampleHref}>
              サンプルを取得
            </Link>
          ) : null}
        </div>
      </section>

      <PrivacyNotice />
    </div>
  );
}
