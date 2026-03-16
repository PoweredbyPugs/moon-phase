import { readFileSync, writeFileSync } from "fs";

const targetVersion = process.argv[2];
const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
const versions = JSON.parse(readFileSync("versions.json", "utf8"));

if (targetVersion) {
  manifest.version = targetVersion;
  versions[targetVersion] = manifest.minAppVersion;
  writeFileSync("manifest.json", JSON.stringify(manifest, null, "\t"));
  writeFileSync("versions.json", JSON.stringify(versions, null, "\t"));
} else {
  console.error("No target version provided.");
  process.exit(1);
}
