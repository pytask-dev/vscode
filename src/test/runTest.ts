import * as path from "path";
import { runTests } from "@vscode/test-electron";
import * as fs from "fs";
import * as os from "os";

async function main() {
  try {
    // Create a temporary test workspace
    const testWorkspacePath = path.join(
      os.tmpdir(),
      `pytask-test-${Math.random().toString(36).substring(2)}`,
    );
    fs.mkdirSync(testWorkspacePath, { recursive: true });
    console.log(`Test workspace created at: ${testWorkspacePath}`);

    // The folder containing the Extension Manifest package.json
    const extensionDevelopmentPath = path.resolve(__dirname, "../../");

    // The path to the extension test script
    const extensionTestsPath = path.resolve(__dirname, "./providers/index");

    // Download VS Code, unzip it and run the integration test
    await runTests({
      extensionDevelopmentPath,
      extensionTestsPath,
      launchArgs: [
        testWorkspacePath,
        "--disable-extensions", // Disable other extensions
        "--disable-workspace-trust", // Disable workspace trust dialog
      ],
    });

    // Clean up the test workspace
    if (fs.existsSync(testWorkspacePath)) {
      fs.rmSync(testWorkspacePath, { recursive: true });
    }
    console.log(`Test workspace cleaned up: ${testWorkspacePath}`);
  } catch (err) {
    console.error("Failed to run tests");
    process.exit(1);
  }
}

main();
