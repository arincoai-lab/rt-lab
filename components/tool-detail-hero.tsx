import Link from "next/link";

import type { ToolDefinition } from "@/lib/site-data";

type ToolDetailHeroProps = {
  tool: ToolDefinition;
};

export function ToolDetailHero({ tool }: ToolDetailHeroProps) {
  return (
    <section className="detail-hero panel">
      <div>
        <p className="eyebrow">{tool.category}</p>
        <h1>{tool.label}</h1>
        <p className="lead">{tool.summary}</p>
      </div>
      <div className="hero-actions">
        <Link className="button button-primary" href={tool.legacyHref}>
          既存ツールを開く
        </Link>
        {tool.sampleHref ? (
          <Link className="button button-secondary" href={tool.sampleHref}>
            サンプルCSV
          </Link>
        ) : null}
      </div>
    </section>
  );
}
