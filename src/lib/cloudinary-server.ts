import "server-only";
import { v2 as cloudinary } from "cloudinary";

function configureCloudinary() {
  cloudinary.config({
    cloud_name: process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
}

export interface ServerUploadResult {
  secure_url: string;
  public_id: string;
  bytes?: number;
  format?: string;
  resource_type: "image" | "raw" | "video";
}

interface ServerUploadOptions {
  /** Direct URL to fetch from (Cloudinary will pull it server-to-server). */
  source_url: string;
  /** Public ID for the new asset, e.g. `${bookId}-pdf-${Date.now()}`. */
  public_id: string;
  /** Folder, e.g. `my-library/books/{bookId}/pdf`. */
  folder: string;
  /** Cloudinary resource type. */
  resource_type: "image" | "raw" | "video";
}

/**
 * Upload to Cloudinary by passing a URL — Cloudinary fetches the file
 * server-to-server. Useful for ingesting EPUB/PDF/cover from public-domain
 * sources (Gutenberg, Standard Ebooks) without proxying bytes through Vercel.
 */
export async function uploadFromUrl(
  options: ServerUploadOptions,
): Promise<ServerUploadResult> {
  configureCloudinary();
  const result = await cloudinary.uploader.upload(options.source_url, {
    folder: options.folder,
    public_id: options.public_id,
    resource_type: options.resource_type,
    use_filename: false,
    unique_filename: false,
    overwrite: false,
  });
  return {
    secure_url: result.secure_url,
    public_id: result.public_id,
    bytes: result.bytes,
    format: result.format,
    resource_type: options.resource_type,
  };
}
