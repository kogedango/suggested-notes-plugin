import fs from "node:fs";

function readJson(path) {
  return JSON.parse(fs.readFileSync(path, "utf8"));
}

const manifest = readJson("manifest.json");
const packageJson = readJson("package.json");
const packageLock = readJson("package-lock.json");
const versions = readJson("versions.json");
const releaseTag = process.env.RELEASE_TAG;
const version = manifest.version;
const problems = [];

if (!/^\d+\.\d+\.\d+$/.test(version)) {
  problems.push(`manifest version is not x.y.z: ${JSON.stringify(version)}`);
}
if (packageJson.version !== version) {
  problems.push(
    `package.json version ${packageJson.version} does not match manifest ${version}`,
  );
}
if (packageLock.packages?.[""]?.version !== version) {
  problems.push(
    `package-lock.json version ${packageLock.packages?.[""]?.version} does not match manifest ${version}`,
  );
}
if (versions[version] !== manifest.minAppVersion) {
  problems.push(
    `versions.json must map ${version} to ${manifest.minAppVersion}`,
  );
}
if (releaseTag && releaseTag !== version) {
  problems.push(
    `release tag ${releaseTag} does not match manifest version ${version}`,
  );
}

if (problems.length > 0) {
  throw new Error(`release metadata is inconsistent:\n- ${problems.join("\n- ")}`);
}

console.log(
  releaseTag
    ? `release metadata valid for ${releaseTag}`
    : `release metadata valid for ${version}`,
);
