import { auth } from "./firebase/client";

export type UploadKind = "pdf" | "epub" | "audio" | "cover";

/** Maps upload kind → Cloudinary resource_type. */
export function resourceTypeFor(kind: UploadKind): "image" | "raw" | "video" {
  if (kind === "cover") return "image";
  if (kind === "audio") return "video"; // Cloudinary handles audio under "video"
  return "raw"; // pdf, epub
}

/** Max bytes per kind — spec §15 ceiling. */
export const MAX_BYTES: Record<UploadKind, number> = {
  pdf: 200 * 1024 * 1024,
  epub: 50 * 1024 * 1024,
  audio: 100 * 1024 * 1024,
  cover: 5 * 1024 * 1024,
};

export interface UploadResult {
  secure_url: string;
  public_id: string;
  bytes: number;
  duration?: number; // present for video/audio
  format?: string;
  resource_type: "image" | "raw" | "video";
}

interface SignResponse {
  signature: string;
  timestamp: number;
  api_key: string;
  cloud_name: string;
  folder: string;
  public_id?: string;
  resource_type: "image" | "raw" | "video";
  upload_url: string;
}

async function fetchSignature(
  folder: string,
  publicId: string,
  resourceType: "image" | "raw" | "video",
): Promise<SignResponse> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const token = await user.getIdToken();
  const res = await fetch("/api/upload/sign", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      folder,
      public_id: publicId,
      resource_type: resourceType,
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Could not sign upload");
  }
  return res.json();
}

export interface UploadOptions {
  file: File;
  kind: UploadKind;
  bookId: string;
  /** Optional progress callback (0–100). */
  onProgress?: (pct: number) => void;
  /** Optional AbortSignal so the caller can cancel. */
  signal?: AbortSignal;
}

/**
 * Uploads `file` directly from the browser to Cloudinary via a server-signed
 * request. Returns the persistent secure_url and public_id, ready to store on
 * the book document.
 */
export async function uploadFile({
  file,
  kind,
  bookId,
  onProgress,
  signal,
}: UploadOptions): Promise<UploadResult> {
  if (file.size > MAX_BYTES[kind]) {
    throw new Error(
      `File too large. Max for ${kind} is ${Math.round(
        MAX_BYTES[kind] / (1024 * 1024),
      )}MB.`,
    );
  }

  const folder = `my-library/books/${bookId}/${kind}`;
  const publicId = `${bookId}-${kind}-${Date.now()}`;
  const resourceType = resourceTypeFor(kind);

  const sig = await fetchSignature(folder, publicId, resourceType);

  const form = new FormData();
  form.append("file", file);
  form.append("api_key", sig.api_key);
  form.append("timestamp", String(sig.timestamp));
  form.append("signature", sig.signature);
  form.append("folder", sig.folder);
  if (sig.public_id) form.append("public_id", sig.public_id);

  return new Promise<UploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", sig.upload_url);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(Math.round((e.loaded / e.total) * 100));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    xhr.onabort = () => reject(new DOMException("Upload aborted", "AbortError"));
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        try {
          const err = JSON.parse(xhr.responseText);
          reject(new Error(err.error?.message ?? `Upload failed (${xhr.status})`));
        } catch {
          reject(new Error(`Upload failed (${xhr.status})`));
        }
        return;
      }
      try {
        const data = JSON.parse(xhr.responseText);
        resolve({
          secure_url: data.secure_url,
          public_id: data.public_id,
          bytes: data.bytes,
          duration: data.duration,
          format: data.format,
          resource_type: resourceType,
        });
      } catch {
        reject(new Error("Could not parse Cloudinary response"));
      }
    };
    if (signal) {
      signal.addEventListener("abort", () => xhr.abort());
    }
    xhr.send(form);
  });
}

/** Delete a file from Cloudinary by public_id (admin only). */
export async function deleteFile(
  publicId: string,
  resourceType: "image" | "raw" | "video",
): Promise<void> {
  const user = auth.currentUser;
  if (!user) throw new Error("Not signed in");
  const token = await user.getIdToken();
  const res = await fetch("/api/upload/delete", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ public_id: publicId, resource_type: resourceType }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? "Delete failed");
  }
}

/** Force-download URL for a Cloudinary asset.
 *
 * Cloudinary's fl_attachment:filename flag does NOT want a file extension or
 * special characters — it appends the right extension based on the resource's
 * format. A filename like "Foo Bar.pdf" produces a 400 because the dot breaks
 * URL parsing. We strip extensions and special chars to keep it safe. */
export function downloadUrl(secureUrl: string, filename?: string): string {
  if (!filename) {
    return secureUrl.replace("/upload/", "/upload/fl_attachment/");
  }
  // Strip extension, replace anything non-alphanumeric (besides _-) with _,
  // then URL-encode for the path segment.
  const clean = filename
    .replace(/\.[^./]+$/, "") // drop last extension
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80); // keep URLs sane
  const flag = clean
    ? `fl_attachment:${encodeURIComponent(clean)}`
    : "fl_attachment";
  return secureUrl.replace("/upload/", `/upload/${flag}/`);
}

// ---------------------------------------------------------------------------
// File-proxy URLs (Phase 5)
// ---------------------------------------------------------------------------

import { auth as _auth } from "./firebase/client";

/**
 * Build a same-origin URL for a book file, served through our /api/file proxy.
 * The user's Firebase ID token is appended as ?t=... so readers, audio
 * elements, etc. can authenticate without setting headers.
 *
 * Use this for: PDF reader, EPUB reader, audio player, download buttons.
 * Don't use the raw Cloudinary URL on the client anymore.
 */
export async function proxyFileUrl(
  bookId: string,
  kind: "pdf" | "epub" | "audio",
  options: { download?: boolean } = {},
): Promise<string> {
  const u = _auth.currentUser;
  if (!u) throw new Error("Not signed in");
  const token = await u.getIdToken();
  const dl = options.download ? "&dl=1" : "";
  return `/api/file/${bookId}/${kind}?t=${encodeURIComponent(token)}${dl}`;
}
