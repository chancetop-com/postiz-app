// @ts-check
import { PHASE_PRODUCTION_BUILD } from 'next/constants.js';
import { withSentryConfig } from '@sentry/nextjs';

const hasSentryAuthToken = Boolean(process.env.SENTRY_AUTH_TOKEN?.trim());

/** @type {import('next').NextConfig} */
const baseNextConfig = {
  // Plain Next output: the image starts the app with `next start` on 4200,
  // which needs the complete .next directory (including .next/static) and the
  // runtime dependencies, not a standalone server bundle.
  experimental: {
    proxyTimeout: 90_000,
  },
  // Document-Policy header for browser profiling
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Document-Policy',
            value: 'js-profiling',
          },
        ],
      },
    ];
  },
  reactStrictMode: false,
  transpilePackages: ['crypto-hash'],
  async redirects() {
    return [
      {
        source: '/api/uploads/:path*',
        destination:
          process.env.STORAGE_PROVIDER === 'local' ? '/uploads/:path*' : '/404',
        permanent: true,
      },
    ];
  },
  async rewrites() {
    return [
      {
        source: '/uploads/:path*',
        destination:
          process.env.STORAGE_PROVIDER === 'local'
            ? '/api/uploads/:path*'
            : '/404',
      },
    ];
  },
};

/** @type {Parameters<typeof withSentryConfig>[1]} */
const sentryOptions = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,

  // Sourcemap configuration optimized for monorepo
  sourcemaps: {
    disable: false,
    // More comprehensive asset patterns for monorepo
    assets: [
      '.next/static/**/*.js',
      '.next/static/**/*.js.map',
      '.next/server/**/*.js',
      '.next/server/**/*.js.map',
    ],
    ignore: [
      '**/node_modules/**',
      '**/*hot-update*',
      '**/_buildManifest.js',
      '**/_ssgManifest.js',
      '**/*.test.js',
      '**/*.spec.js',
    ],
    deleteSourcemapsAfterUpload: true,
  },

  // Release configuration
  release: {
    create: true,
    finalize: true,
    // Use git commit hash for releases in monorepo
    name:
      process.env.SENTRY_RELEASE ||
      process.env.VERCEL_GIT_COMMIT_SHA ||
      process.env.GITHUB_SHA ||
      undefined,
  },

  // NextJS specific optimizations for monorepo
  widenClientFileUpload: true,

  // Additional configuration
  telemetry: false,
  silent: process.env.NODE_ENV === 'production',
  debug: process.env.NODE_ENV === 'development',

  // Error handling for CI/CD
  errorHandler: (error) => {
    console.warn('Sentry build error occurred:', error.message);
    console.warn(
      'This might be due to missing Sentry environment variables or network issues'
    );
    // Don't fail the build if Sentry upload fails in monorepo context
    return;
  },
};

/** @type {import('next').NextConfig} */
const sentryNextConfig = {
  ...baseNextConfig,
  productionBrowserSourceMaps: true,
  // Custom webpack config to ensure sourcemaps are generated properly
  webpack: (config, { dev, isServer }) => {
    // Enable sourcemaps for both client and server in production
    if (!dev) {
      config.devtool = isServer ? 'source-map' : 'hidden-source-map';
    }

    return config;
  },
};

/** @type {import('next').NextConfig} */
const defaultNextConfig = {
  ...baseNextConfig,
  productionBrowserSourceMaps: false,
  experimental: {
    ...baseNextConfig.experimental,
    serverSourceMaps: false,
    turbopackSourceMaps: false,
  },
};

// Only generate production sourcemaps and wrap with Sentry when uploading to Sentry
/** @param {string} phase */
export default function nextConfig(phase) {
  if (hasSentryAuthToken) return withSentryConfig(sentryNextConfig, sentryOptions);
  return phase === PHASE_PRODUCTION_BUILD ? defaultNextConfig : baseNextConfig;
}
