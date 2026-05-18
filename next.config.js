/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    // Externalize pdfjs-dist so its internal dynamic require() of pdf.worker.mjs
    // uses Node.js module resolution at runtime instead of Next.js bundle paths.
    serverComponentsExternalPackages: ["pdfjs-dist"],
    // Vercel's file tracer uses static analysis to figure out which node_modules
    // files to ship in each serverless function. The worker file is loaded by
    // a dynamic import inside pdfjs-dist that the tracer can't see, so the file
    // gets excluded from the function bundle. This explicitly tells the tracer
    // to include it for every route under /api/books/, which are the ones that
    // call PDF extraction (ai-fill, convert, generate-voice).
    outputFileTracingIncludes: {
      "/api/books/**": [
        "./node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs",
        "./node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs",
      ],
    },
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
