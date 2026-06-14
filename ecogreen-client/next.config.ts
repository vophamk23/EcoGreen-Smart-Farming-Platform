import path from "node:path";

const nextConfig = {
  turbopack: {
    root: path.join(process.cwd()),
  },
  allowedDevOrigins: [
    "172.20.10.2", // phone hotspot
  ],
};

export default nextConfig;
