/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // pdfjs-dist contains an internal worker file (pdf.worker.mjs) that
    // Next.js's default bundling can't relocate correctly for Vercel
    // serverless functions. Listing it here tells Next.js to leave the
    // package as an external require() at runtime, so its own module
    // resolution finds the worker. Without this, the convert + generate-voice
    // endpoints throw "Cannot find module pdf.worker.mjs".
    serverComponentsExternalPackages: ["pdfjs-dist"],
  },
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "books.google.com" },
      { protocol: "https", hostname: "books.googleusercontent.com" },
      { protocol: "https", hostname: "covers.openlibrary.org" },
      { protocol: "https", hostname: "res.cloudinary.com" },
    ],
  },
};

module.exports = nextConfig;
