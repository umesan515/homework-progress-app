import Link from "next/link";
import type { ReactNode } from "react";

type ActionCardProps = {
  href: string;
  title: string;
  description: string;
  themeClassName: string;
  cta?: string;
  className?: string;
  children?: ReactNode;
};

export function ActionCard({
  href,
  title,
  description,
  themeClassName,
  cta = "開く",
  className = "",
  children,
}: ActionCardProps) {
  return (
    <Link
      className={["home-action-card", "ui-action-card", themeClassName, className]
        .filter(Boolean)
        .join(" ")}
      href={href}
    >
      <div className="home-action-card-title ui-action-card-title">{title}</div>
      <div className="home-action-card-desc ui-action-card-desc">{description}</div>
      {children}
      <span className="home-action-card-arrow ui-action-card-arrow">{cta}</span>
    </Link>
  );
}
