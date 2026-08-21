const { existsSync, readFileSync } = require("node:fs");
const { resolve } = require("node:path");

function loadEnvironmentFile(filePath) {
  if (!existsSync(filePath)) return {};

  return Object.fromEntries(
    readFileSync(filePath, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#") && line.includes("="))
      .map((line) => {
        const separator = line.indexOf("=");
        const key = line.slice(0, separator).trim();
        let value = line.slice(separator + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        return [key, value];
      }),
  );
}

const appDirectory = __dirname;
const fileEnvironment = loadEnvironmentFile(resolve(appDirectory, ".env"));

module.exports = {
  apps: [
    {
      name: "fortune-relay-server",
      cwd: appDirectory,
      script: "src/server.js",
      instances: 1,
      exec_mode: "fork",
      autorestart: true,
      max_memory_restart: "350M",
      env: {
        NODE_ENV: "production",
        HOST: "127.0.0.1",
        PORT: "3000",
        TRUST_PROXY: "true",
        ...fileEnvironment,
      },
    },
  ],
};
