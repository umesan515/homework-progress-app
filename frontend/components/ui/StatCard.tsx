import type { ReactNode } from "react";

type StatCardProps = {
  label: string;
  value: ReactNode;
  description: string;
  className?: string;
};

export function StatCard({ label, value, description, className = "" }: StatCardProps) {
  return (
    <div className={["ui-stat-card", className].filter(Boolean).join(" ")}>
      <div className="ui-stat-card-label">{label}</div>
      <div className="ui-stat-card-value">{value}</div>
      <div className="ui-stat-card-sub">{description}</div>
    </div>
  );
}
