"use client";

import clsx from "clsx";
import { SelectHTMLAttributes, forwardRef, ReactNode } from "react";

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
  children: ReactNode;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(
  function Select({ label, hint, error, className, id, children, ...rest }, ref) {
    const selId = id ?? rest.name ?? Math.random().toString(36).slice(2);
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={selId}
            className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-600"
          >
            {label}
          </label>
        )}
        <select
          ref={ref}
          id={selId}
          className={clsx(
            "w-full appearance-none rounded-sm border bg-parchment-50 px-3 py-2 pr-8 text-sm text-ink-900 focus:outline-none focus:ring-1",
            "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2210%22 height=%226%22 viewBox=%220 0 10 6%22><path fill=%22%23555%22 d=%22M0 0l5 6 5-6z%22/></svg>')] bg-[length:10px_6px] bg-[right_0.7rem_center] bg-no-repeat",
            error
              ? "border-oxblood-600 focus:border-oxblood-700 focus:ring-oxblood-600/30"
              : "border-ink-500/25 focus:border-ink-700 focus:ring-ink-700/20",
            className,
          )}
          {...rest}
        >
          {children}
        </select>
        {error ? (
          <p className="text-xs text-oxblood-700">{error}</p>
        ) : hint ? (
          <p className="text-xs text-ink-500">{hint}</p>
        ) : null}
      </div>
    );
  },
);
