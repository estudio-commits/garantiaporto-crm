import { defineConfig } from "@playwright/test";
import chromium from "@sparticuz/chromium";
process.env.XDG_CACHE_HOME = "/tmp/porto-browser-cache";
export default defineConfig({
  testDir: "tests/browser",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:3100",
    headless: true,
    launchOptions: {
      executablePath: await chromium.executablePath(),
      args: chromium.args.filter((arg) => arg !== "--single-process"),
    },
  },
  webServer: {
    command: "npm run dev -- --port 3100",
    url: "http://127.0.0.1:3100",
    reuseExistingServer: false,
    timeout: 90000,
  },
});
