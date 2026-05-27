/**
 * Next.js configuration for the Virtual Fashion Design Gallery.
 *
 * v1 keeps this file intentionally minimal: the gallery runs on the default
 * Node.js runtime and Vercel's stock Next.js build pipeline (Requirement 11.9).
 *
 * Cache headers (Requirement 9.5):
 *   Sketch images served from `/public/sketches/` are returned with
 *   `Cache-Control: public, max-age=3600, stale-while-revalidate=86400`
 *   so a same-session reload reuses the browser cache for at least 1 hour
 *   without issuing a full-body refetch, while still allowing the browser
 *   to revalidate stale entries in the background for up to a day.
 *
 * @type {import('next').NextConfig}
 */
const nextConfig = {
  async headers() {
    return [
      {
        source: '/images/shop/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=3600, stale-while-revalidate=86400',
          },
        ],
      },
      {
        source: '/sketches/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=3600, stale-while-revalidate=86400',
          },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
