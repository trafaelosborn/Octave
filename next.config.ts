import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  output: 'standalone',
  outputFileTracingExcludes: {
    '*': [
      './desktop/app/out/**/*',
      './desktop/app/runtime/**/*',
    ],
  },
  poweredByHeader: false,
};

export default nextConfig;
