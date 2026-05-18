"use client";

import { useCallback, useRef, useState } from "react";
import clsx from "clsx";
import {
  Upload,
  X,
  FileText,
  BookOpen,
  Headphones,
  ImageIcon,
  Check,
  Loader2,
} from "lucide-react";
import {
  uploadFile,
  deleteFile,
  resourceTypeFor,
  MAX_BYTES,
  type UploadKind,
  type UploadResult,
} from "@/lib/cloudinary";

interface FileUploaderProps {
  kind: UploadKind;
  bookId: string;
  /** Existing secure URL, if any */
  url?: string;
  publicId?: string;
  /** Called when an upload finishes (or a file is cleared). */
  onChange: (result: UploadResult | null) => void;
  disabled?: boolean;
}

const KIND_META: Record<
  UploadKind,
  { label: string; accept: string; icon: typeof Upload; hint: string }
> = {
  pdf: {
    label: "PDF",
    accept: "application/pdf",
    icon: FileText,
    hint: "Up to 200 MB",
  },
  epub: {
    label: "EPUB",
    accept: "application/epub+zip,.epub",
    icon: BookOpen,
    hint: "Up to 50 MB",
  },
  audio: {
    label: "Audio summary",
    accept: "audio/*",
    icon: Headphones,
    hint: "MP3, up to 100 MB",
  },
  cover: {
    label: "Cover image",
    accept: "image/*",
    icon: ImageIcon,
    hint: "JPG/PNG/WebP, up to 5 MB",
  },
};

export function FileUploader({
  kind,
  bookId,
  url,
  publicId,
  onChange,
  disabled,
}: FileUploaderProps) {
  const meta = KIND_META[kind];
  const Icon = meta.icon;
  const inputRef = useRef<HTMLInputElement>(null);

  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  const startUpload = useCallback(
    async (file: File) => {
      setError(null);
      setProgress(0);
      const ac = new AbortController();
      abortRef.current = ac;
      try {
        const result = await uploadFile({
          file,
          kind,
          bookId,
          onProgress: setProgress,
          signal: ac.signal,
        });
        onChange(result);
        setProgress(null);
      } catch (err: unknown) {
        if ((err as DOMException)?.name === "AbortError") {
          setError("Upload cancelled");
        } else {
          setError(err instanceof Error ? err.message : "Upload failed");
        }
        setProgress(null);
      } finally {
        abortRef.current = null;
      }
    },
    [kind, bookId, onChange],
  );

  function handleFile(file: File | undefined | null) {
    if (!file) return;
    if (file.size > MAX_BYTES[kind]) {
      setError(`Too large. Max ${Math.round(MAX_BYTES[kind] / (1024 * 1024))} MB.`);
      return;
    }
    void startUpload(file);
  }

  async function handleClear() {
    if (!publicId) {
      onChange(null);
      return;
    }
    if (!confirm("Remove this file? It will be deleted from storage.")) return;
    try {
      await deleteFile(publicId, resourceTypeFor(kind));
    } catch (err) {
      console.warn("[uploader] cloudinary delete failed; proceeding to clear", err);
    }
    onChange(null);
  }

  // ---- Render -------------------------------------------------------------

  if (url) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-sm border border-forest-600/30 bg-forest-50 px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <Check size={16} className="flex-shrink-0 text-forest-600" />
          <div className="min-w-0">
            <p className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-forest-600">
              {meta.label} uploaded
            </p>
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="block truncate text-xs text-ink-700 underline-offset-4 hover:underline"
            >
              {url.split("/").slice(-1)[0]}
            </a>
          </div>
        </div>
        <div className="flex flex-shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="rounded-sm border border-ink-500/25 px-2.5 py-1 text-[0.65rem] uppercase tracking-[0.15em] text-ink-700 hover:bg-parchment-100"
          >
            Replace
          </button>
          <button
            type="button"
            onClick={handleClear}
            className="rounded-sm p-1 text-oxblood-700 hover:bg-oxblood-50"
            aria-label="Remove"
          >
            <X size={14} />
          </button>
          <input
            ref={inputRef}
            type="file"
            accept={meta.accept}
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </div>
      </div>
    );
  }

  if (progress !== null) {
    return (
      <div className="rounded-sm border border-oxblood-600/30 bg-oxblood-50/50 p-4">
        <div className="mb-2 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm text-ink-700">
            <Loader2 size={14} className="animate-spin text-oxblood-700" />
            Uploading {meta.label}…
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-ink-700">{progress}%</span>
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-oxblood-700 hover:underline"
            >
              Cancel
            </button>
          </div>
        </div>
        <div className="h-1.5 overflow-hidden rounded-full bg-parchment-200">
          <div
            className="h-full bg-oxblood-600 transition-[width] duration-150"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    );
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        handleFile(e.dataTransfer.files?.[0]);
      }}
      className={clsx(
        "flex flex-col items-center gap-2 rounded-sm border border-dashed px-4 py-6 text-center transition-colors",
        isDragging
          ? "border-oxblood-600/60 bg-oxblood-50"
          : "border-ink-500/30 bg-parchment-50 hover:bg-parchment-100",
        disabled && "cursor-not-allowed opacity-50",
      )}
    >
      <Icon size={20} className="text-ink-500" />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="font-display text-base text-ink-800 underline-offset-4 hover:underline disabled:no-underline"
      >
        Drop {meta.label} or click to choose
      </button>
      <p className="font-mono text-[0.65rem] uppercase tracking-[0.15em] text-ink-500">
        {meta.hint}
      </p>
      <input
        ref={inputRef}
        type="file"
        accept={meta.accept}
        disabled={disabled}
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      {error && (
        <p className="mt-1 text-xs text-oxblood-700">{error}</p>
      )}
      {!bookId && (
        <p className="font-mono text-[0.6rem] uppercase tracking-[0.15em] text-oxblood-700">
          Save the book first to get an ID before uploading
        </p>
      )}
    </div>
  );
}
