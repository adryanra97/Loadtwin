/** Static export: the dashboard is plain files served by Vercel or by FastAPI in Docker. */
const config = {
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
  poweredByHeader: false,
  reactStrictMode: true,
};
export default config;
