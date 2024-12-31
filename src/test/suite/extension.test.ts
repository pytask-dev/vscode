import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { expect } from 'chai';
import { PyTaskProvider } from '../../extension';

suite('PyTask Extension Test Suite', function () {
  // Increase timeout for all tests
  this.timeout(10000);

  let testFilePath: string;

  suiteSetup(function () {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      throw new Error('No workspace folders found');
    }
    testFilePath = path.join(workspaceFolders[0].uri.fsPath, 'task_test.py');
  });

  setup(async function () {
    // Increase timeout for setup
    this.timeout(10000);

    // Create a test task file before each test
    const testFileContent = `
def task_one():
    pass

def task_two():
    pass

def not_a_task():
    pass
`;
    fs.writeFileSync(testFilePath, testFileContent);

    // Wait for the extension to activate and file to be indexed
    await new Promise((resolve) => setTimeout(resolve, 3000));
  });

  teardown(function () {
    this.timeout(5000);
    // Clean up test file after each test
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  });

  test('Extension should be present', async function () {
    this.timeout(5000);
    const extension = vscode.extensions.getExtension('undefined_publisher.pytask-vscode');
    assert.ok(extension, 'Extension should be present');
    await extension?.activate();
  });

  test('Should find task functions in Python files', async function () {
    this.timeout(10000);

    // Get the PyTask explorer view
    const provider = new PyTaskProvider();
    const treeView = vscode.window.createTreeView('pytaskExplorer', {
      treeDataProvider: provider,
    });

    try {
      // Get the tree items
      const items = await provider.getChildren();

      // Verify we found the correct number of tasks
      expect(items.length).to.equal(2, 'Should find exactly 2 tasks');

      // Verify task names
      const taskNames = items.map((item) => item.label);
      expect(taskNames).to.include('task_one', 'Should find task_one');
      expect(taskNames).to.include('task_two', 'Should find task_two');
      expect(taskNames).to.not.include('not_a_task', 'Should not find not_a_task');
    } finally {
      treeView.dispose();
    }
  });

  test('Should update when task file changes', async function () {
    this.timeout(10000);

    // Add a new task to the file
    const updatedContent =
      fs.readFileSync(testFilePath, 'utf8') + '\ndef task_three():\n    pass\n';
    fs.writeFileSync(testFilePath, updatedContent);

    // Wait for the file watcher to detect changes
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // Get the tree view items
    const provider = new PyTaskProvider();
    const treeView = vscode.window.createTreeView('pytaskExplorer', {
      treeDataProvider: provider,
    });

    try {
      const items = await provider.getChildren();

      // Verify the new task is included
      expect(items.length).to.equal(3, 'Should find exactly 3 tasks after adding task_three');
      const taskNames = items.map((item) => item.label);
      expect(taskNames).to.include('task_three', 'Should find the newly added task_three');
    } finally {
      treeView.dispose();
    }
  });
});
