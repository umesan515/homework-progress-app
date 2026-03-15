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
    <Link className={["ui-action-card", themeClassName, className].filter(Boolean).join(" ")} href={href}>
      <div className="ui-action-card-title">{title}</div>
      <div className="ui-action-card-desc">{description}</div>
      {children}
      <span className="ui-action-card-arrow">{cta}</span>
    </Link>
  );
}
