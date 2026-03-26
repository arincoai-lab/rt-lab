import Link from "next/link";

import type { ToolDefinition } from "@/lib/site-data";

type ToolCardProps = {
  tool: ToolDefinition;
};

export function ToolCard({ tool }: ToolCardProps) {
  return (
    <article className="tool-card">
      <div className="tool-card-top">
        <span className="tag">{tool.category}</span>
        <span className="status-pill">{tool.status}</span>
      </div>
      <h3>{tool.label}</h3>
      <p>{tool.description}</p>
      <ul className="mini-list">
        {tool.highlights.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
      <div className="tool-card-actions">
        <Link className="button button-secondary" href={`/tools/${tool.slug}`}>
          詳細を見る
        </Link>
        <Link className="button button-primary" href={tool.legacyHref}>
          ツールを開く
        </Link>
      </div>
    </article>
  );
}
