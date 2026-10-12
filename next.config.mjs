import { imageHosts } from './image-hosts.config.mjs';

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Source maps carry the original source (including the Uganda settings in
  // config/deployment.ts), so the neutral demo build leaves them out.
  productionBrowserSourceMaps: process.env.NEXT_PUBLIC_DEMO_MODE !== 'true',
  distDir: process.env.DIST_DIR || '.next',

  typescript: {
    ignoreBuildErrors: true,
  },

  eslint: {
    ignoreDuringBuilds: true,
  },

  images: {
    remotePatterns: imageHosts,
    minimumCacheTTL: 60,
    qualities: [75, 85, 100],
  }
};
export default nextConfig;