import type { ReactNode } from "react";

type PanelProps = {
  children: ReactNode;
  className?: string;
  muted?: boolean;
};

export function Panel({ children, className = "", muted = false }: PanelProps) {
  const base = muted ? "ui-panel-muted" : "ui-panel";
  return <div className={[base, className].filter(Boolean).join(" ")}>{children}</div>;
}
