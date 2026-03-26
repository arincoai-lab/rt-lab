import Link from "next/link";

const navItems = [
  { href: "/", label: "ホーム" },
  { href: "/tools", label: "ツール一覧" },
  { href: "/about", label: "サイトについて" },
];

export function SiteHeader() {
  return (
    <header className="site-header">
      <div className="shell header-inner">
        <Link href="/" className="brand">
          <span className="brand-mark">RT</span>
          <span>
            <strong>RT-Lab</strong>
            <small>放射線技師向けWebツール</small>
          </span>
        </Link>

        <nav className="site-nav" aria-label="主要ナビゲーション">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}>
              {item.label}
            </Link>
          ))}
        </nav>
      </div>
    </header>
  );
}
