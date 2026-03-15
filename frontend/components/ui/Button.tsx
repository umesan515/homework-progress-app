import type { ButtonHTMLAttributes, ReactNode } from "react";

type ButtonVariant = "secondary" | "danger";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  children: ReactNode;
};

const variantClassName: Record<ButtonVariant, string> = {
  secondary: "ui-btn-secondary",
  danger: "ui-btn-danger",
};

export function Button({ variant = "secondary", className = "", children, type = "button", ...props }: ButtonProps) {
  return (
    <button
      type={type}
      className={[variantClassName[variant], className].filter(Boolean).join(" ")}
      {...props}
    >
      {children}
    </button>
  );
}
