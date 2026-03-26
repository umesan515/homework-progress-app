import type { ReactNode } from "react";

type StatCardProps = {
  label: string;
  value: ReactNode;
  description: string;
  className?: string;
};

export function StatCard({ label, value, description, className = "" }: StatCardProps) {
  return (
    <div className={["info-card", "ui-stat-card", className].filter(Boolean).join(" ")}>
      <div className="info-card-label ui-stat-card-label">{label}</div>
      <div className="info-card-value ui-stat-card-value">{value}</div>
      <div className="info-card-sub ui-stat-card-sub">{description}</div>
    </div>
  );
}
