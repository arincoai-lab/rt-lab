import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  async redirects() {
    return [
      {
        source: "/drl-comparison",
        destination: "/legacy/drl-comparison/",
        permanent: false,
      },
      {
        source: "/mtf-calculator",
        destination: "/legacy/mtf-calculator/",
        permanent: false,
      },
      {
        source: "/nps-calculator",
        destination: "/legacy/nps-calculator/",
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
