"use client";

import clsx from "clsx";
import { ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "ghost" | "outline" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-oxblood-600 text-parchment-50 hover:bg-oxblood-700 active:bg-oxblood-800 border-oxblood-700",
  ghost:
    "bg-transparent text-ink-800 hover:bg-parchment-100 border-transparent",
  outline:
    "bg-transparent text-ink-800 border-ink-500/30 hover:bg-parchment-100",
  danger:
    "bg-transparent text-oxblood-700 border-oxblood-600/40 hover:bg-oxblood-50",
};

const SIZES: Record<Size, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-6 py-3 text-base",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    { variant = "primary", size = "md", className, children, ...rest },
    ref,
  ) {
    return (
      <button
        ref={ref}
        className={clsx(
          "inline-flex items-center justify-center gap-2 rounded-sm border font-sans font-medium tracking-wide transition-colors disabled:cursor-not-allowed disabled:opacity-50",
          VARIANTS[variant],
          SIZES[size],
          className,
        )}
        {...rest}
      >
        {children}
      </button>
    );
  },
);
