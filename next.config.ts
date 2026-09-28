import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The floating dev indicator overlaps the sidebar's collapse control. Build errors
  // are still shown in the error overlay.
  devIndicators: false,
  poweredByHeader: false,
};

export default nextConfig;
