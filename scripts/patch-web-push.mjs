import { readFileSync, writeFileSync, existsSync } from "fs";
import { createRequire } from "module";

const require = createRequire(import.meta.url);

let target;
try {
  target = require.resolve("web-push/src/web-push-lib.js");
} catch {
  console.warn("patch-web-push: web-push not installed, skipping");
  process.exit(0);
}

if (!existsSync(target)) {
  console.warn("patch-web-push: missing", target);
  process.exit(0);
}

const original = readFileSync(target, "utf8");

if (
  original.includes("new URL(subscription.endpoint).origin") &&
  original.includes("new URL(requestDetails.endpoint)") &&
  !original.includes("url.parse(")
) {
  console.log("patch-web-push: already applied");
  process.exit(0);
}

let next = original;

if (next.includes("const url = require('url');\n")) {
  next = next.replace("const url = require('url');\n", "");
}

next = next.replace(
  /const parsedUrl = url\.parse\(subscription\.endpoint\);\s*const audience = parsedUrl\.protocol \+ '\/\/'\s*\+ parsedUrl\.host;/,
  "const audience = new URL(subscription.endpoint).origin;"
);

next = next.replace(
  /const urlParts = url\.parse\(requestDetails\.endpoint\);\s*httpsOptions\.hostname = urlParts\.hostname;\s*httpsOptions\.port = urlParts\.port;\s*httpsOptions\.path = urlParts\.path;/,
  [
    "const urlParts = new URL(requestDetails.endpoint);",
    "      httpsOptions.hostname = urlParts.hostname;",
    "      httpsOptions.port = urlParts.port ? Number(urlParts.port) : undefined;",
    "      httpsOptions.path = `${urlParts.pathname}${urlParts.search}`;",
  ].join("\n")
);

if (next === original || next.includes("url.parse(")) {
  console.error("patch-web-push: failed to patch url.parse usage");
  process.exit(1);
}

writeFileSync(target, next);
console.log("patch-web-push: patched", target);
