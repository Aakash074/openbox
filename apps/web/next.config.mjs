import { config } from "dotenv";
import { resolve } from "node:path";
// Single .env at the repo root for every service.
config({ path: resolve(process.cwd(), "../..", process.env.OPENBOX_ENV_FILE ?? ".env") });

/** @type {import('next').NextConfig} */
export default {
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000",
    NEXT_PUBLIC_STORE_URL: process.env.NEXT_PUBLIC_STORE_URL ?? "http://localhost:5174",
  },
};
