import assert from "node:assert/strict";
import test from "node:test";

import { parseArgs, resolveTargetPackage } from "./bootstrap-npm-package.mjs";

test("parseArgs recognizes publish and skip-build flags", () => {
  assert.deepEqual(parseArgs(["@paperclipai/adapter-acpx-local", "--publish", "--skip-build"]), {
    help: false,
    selector: "@paperclipai/adapter-acpx-local",
    publish: true,
    skipBuild: true,
  });
});

test("parseArgs returns help mode", () => {
  assert.deepEqual(parseArgs(["--help"]), {
    help: true,
    selector: null,
    publish: false,
    skipBuild: false,
  });
});

test("resolveTargetPackage matches by package name or dir", () => {
  const packages = [
    { dir: "packages/a", name: "@paperclipai/a", pkg: {} },
    { dir: "packages/b", name: "@paperclipai/b", pkg: {} },
  ];

  assert.equal(resolveTargetPackage("@paperclipai/a", packages).dir, "packages/a");
  assert.equal(resolveTargetPackage("./packages/b", packages).name, "@paperclipai/b");
});
