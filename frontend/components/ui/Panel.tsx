import type { ReactNode } from "react";

type PanelProps = {
  children: ReactNode;
  className?: string;
  muted?: boolean;
};

export function Panel({ children, className = "", muted = false }: PanelProps) {
  const legacy = muted ? "soft-panel-muted" : "soft-panel";
  const modern = muted ? "ui-panel-muted" : "ui-panel";
  return <div className={[legacy, modern, className].filter(Boolean).join(" ")}>{children}</div>;
}
