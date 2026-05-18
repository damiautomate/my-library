"use client";

import clsx from "clsx";
import { InputHTMLAttributes, forwardRef, TextareaHTMLAttributes } from "react";

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input(
  { label, hint, error, className, id, ...rest },
  ref,
) {
  const inputId = id ?? rest.name ?? Math.random().toString(36).slice(2);
  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <label
          htmlFor={inputId}
          className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-600"
        >
          {label}
        </label>
      )}
      <input
        ref={ref}
        id={inputId}
        className={clsx(
          "w-full rounded-sm border bg-parchment-50 px-3 py-2 text-sm text-ink-900 placeholder:text-ink-500/70 focus:outline-none focus:ring-1",
          error
            ? "border-oxblood-600 focus:border-oxblood-700 focus:ring-oxblood-600/30"
            : "border-ink-500/25 focus:border-ink-700 focus:ring-ink-700/20",
          className,
        )}
        {...rest}
      />
      {error ? (
        <p className="text-xs text-oxblood-700">{error}</p>
      ) : hint ? (
        <p className="text-xs text-ink-500">{hint}</p>
      ) : null}
    </div>
  );
});

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  function Textarea(
    { label, hint, error, className, id, rows = 4, ...rest },
    ref,
  ) {
    const inputId = id ?? rest.name ?? Math.random().toString(36).slice(2);
    return (
      <div className="flex flex-col gap-1.5">
        {label && (
          <label
            htmlFor={inputId}
            className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-600"
          >
            {label}
          </label>
        )}
        <textarea
          ref={ref}
          id={inputId}
          rows={rows}
          className={clsx(
            "w-full rounded-sm border bg-parchment-50 px-3 py-2 text-sm text-ink-900 placeholder:text-ink-500/70 focus:outline-none focus:ring-1",
            error
              ? "border-oxblood-600 focus:border-oxblood-700 focus:ring-oxblood-600/30"
              : "border-ink-500/25 focus:border-ink-700 focus:ring-ink-700/20",
            className,
          )}
          {...rest}
        />
        {error ? (
          <p className="text-xs text-oxblood-700">{error}</p>
        ) : hint ? (
          <p className="text-xs text-ink-500">{hint}</p>
        ) : null}
      </div>
    );
  },
);
