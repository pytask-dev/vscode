import * as assert from 'assert';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { expect } from 'chai';
import { PyTaskProvider } from '../../extension';

suite('PyTask Extension Test Suite', function () {
  // Increase timeout for all tests
  this.timeout(5000);

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
    // Clean up test file after each test
    if (fs.existsSync(testFilePath)) {
      fs.unlinkSync(testFilePath);
    }
  });

  test('Extension should be present', async function () {
    const extension = vscode.extensions.getExtension('undefined_publisher.pytask-vscode');
    assert.ok(extension, 'Extension should be present');
    await extension?.activate();
  });

  test('Should find task functions in Python files', async function () {
    // Get the PyTask explorer view
    const provider = new PyTaskProvider();
    const treeView = vscode.window.createTreeView('pytaskExplorer', {
      treeDataProvider: provider,
    });

    try {
      // Get the tree items
      const items = await provider.getChildren();

      // Verify we found the correct number of modules
      expect(items.length).to.equal(1, 'Should find exactly 1 module');

      const moduleItem = items[0];
      expect(moduleItem.contextValue).to.equal('module', 'First item should be a module');
      expect(moduleItem.label).to.equal('task_test.py', 'Module should have correct name');

      // Verify tasks within the module
      const tasks = await provider.getChildren(moduleItem);
      expect(tasks.length).to.equal(2, 'Should find exactly 2 tasks in the module');

      // Verify task names
      const taskNames = tasks.map((item) => item.label);
      expect(taskNames).to.include('task_one', 'Should find task_one');
      expect(taskNames).to.include('task_two', 'Should find task_two');
      expect(taskNames).to.not.include('not_a_task', 'Should not find not_a_task');
    } finally {
      treeView.dispose();
    }
  });

  test('Should display empty task modules', async function () {
    const wsfolders = vscode.workspace.workspaceFolders;
    if (!wsfolders) {
      throw new Error('No workspace folders found');
    }

    // Create an empty task file
    const emptyTaskFile = path.join(wsfolders[0].uri.fsPath, 'task_empty.py');
    fs.writeFileSync(emptyTaskFile, '# Empty task file\n');

    try {
      const provider = new PyTaskProvider();
      const treeView = vscode.window.createTreeView('pytaskExplorer', {
        treeDataProvider: provider,
      });

      try {
        // Get the tree items
        const items = await provider.getChildren();

        // Verify we found both modules (empty and non-empty)
        expect(items.length).to.equal(2, 'Should find both task modules');

        // Find the empty module
        const emptyModule = items.find((item) => item.label === 'task_empty.py');
        expect(emptyModule).to.exist;
        expect(emptyModule!.contextValue).to.equal(
          'module',
          'Empty file should be shown as module'
        );

        // Verify empty module has no tasks
        const emptyModuleTasks = await provider.getChildren(emptyModule);
        expect(emptyModuleTasks.length).to.equal(0, 'Empty module should have no tasks');
      } finally {
        treeView.dispose();
      }
    } finally {
      // Clean up empty task file
      if (fs.existsSync(emptyTaskFile)) {
        fs.unlinkSync(emptyTaskFile);
      }
    }
  });

  test('Should update when task file changes', async function () {
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

      // Verify we still have one module
      expect(items.length).to.equal(1, 'Should find exactly 1 module');
      const moduleItem = items[0];
      expect(moduleItem.contextValue).to.equal('module', 'First item should be a module');

      // Get tasks under the module
      const tasks = await provider.getChildren(moduleItem);
      expect(tasks.length).to.equal(3, 'Should find exactly 3 tasks in the module');

      // Verify task names
      const taskNames = tasks.map((item) => item.label);
      expect(taskNames).to.include('task_one', 'Should find task_one');
      expect(taskNames).to.include('task_two', 'Should find task_two');
      expect(taskNames).to.include('task_three', 'Should find the newly added task_three');
    } finally {
      treeView.dispose();
    }
  });
});

suite('Task Function Detection', () => {
  const provider = new PyTaskProvider();
  const dummyPath = '/test/task_test.py';

  test('Should find functions with task_ prefix', () => {
    const content = `
def task_one():
  pass

def task_two():
  pass

def not_a_task():
  pass
`;
    const tasks = provider.findTaskFunctions(dummyPath, content);
    expect(tasks).to.have.lengthOf(2, 'Should find exactly 2 tasks');
    expect(tasks[0].label).to.equal('task_one');
    expect(tasks[1].label).to.equal('task_two');
  });

  test('Should find functions with @task decorator', () => {
    const content = `
from pytask import task

@task
def function_one():
  pass

@task
def another_function():
  pass

def not_decorated():
  pass
`;
    const tasks = provider.findTaskFunctions(dummyPath, content);
    expect(tasks).to.have.lengthOf(2, 'Should find exactly 2 tasks');
    expect(tasks[0].label).to.equal('another_function');
    expect(tasks[1].label).to.equal('function_one');
  });

  test('Should find functions with @pytask.task decorator', () => {
    const content = `
import pytask

@pytask.task
def function_one():
  pass

@pytask.task()
def function_two():
  pass

@pytask.task(...)
def function_three():
  pass
`;
    const tasks = provider.findTaskFunctions(dummyPath, content);
    expect(tasks).to.have.lengthOf(3, 'Should find exactly 3 tasks');
    expect(tasks[0].label).to.equal('function_one');
    expect(tasks[1].label).to.equal('function_three');
    expect(tasks[2].label).to.equal('function_two');
  });

  test('Should handle mixed task definitions', () => {
    const content = `
from pytask import task
import pytask

def task_one():
  pass

@task
def function_two():
  pass

@pytask.task
def function_three():
  pass

def not_a_task():
  pass
`;
    const tasks = provider.findTaskFunctions(dummyPath, content);
    expect(tasks).to.have.lengthOf(3, 'Should find exactly 3 tasks');
    expect(tasks[0].label).to.equal('function_three');
    expect(tasks[1].label).to.equal('function_two');
    expect(tasks[2].label).to.equal('task_one');
  });

  test('Should not find tasks without proper imports', () => {
    const content = `
# Missing imports

@task
def not_a_task1():
  pass

@pytask.task
def not_a_task2():
  pass

def task_one():
  pass
`;
    const tasks = provider.findTaskFunctions(dummyPath, content);
    expect(tasks).to.have.lengthOf(1, 'Should only find the task_ prefixed function');
    expect(tasks[0].label).to.equal('task_one');
  });

  test('Should handle complex import statements', () => {
    const content = `
from pytask import clean, task, collect
import pytask as pt

@task
def task_one():
  pass

@pt.task
def another_task():
  pass
`;
    const tasks = provider.findTaskFunctions(dummyPath, content);
    expect(tasks).to.have.lengthOf(2, 'Should find both tasks');
    expect(tasks[0].label).to.equal('another_task');
    expect(tasks[1].label).to.equal('task_one');
  });

  test('Should handle aliased task import', () => {
    const content = `
from pytask import task as t

@t
def my_task():
  pass

def not_a_task():
  pass
`;
    const tasks = provider.findTaskFunctions(dummyPath, content);
    expect(tasks).to.have.lengthOf(1, 'Should find task with aliased decorator');
    expect(tasks[0].label).to.equal('my_task');
  });

  test('Should handle multi-import statements', () => {
    const content = `
from pytask import Product, task

@task
def task_one():
  pass

def not_a_task():
  pass
`;
    const tasks = provider.findTaskFunctions(dummyPath, content);
    expect(tasks).to.have.lengthOf(1, 'Should find task with multi-import');
    expect(tasks[0].label).to.equal('task_one');
  });

  test('Should handle multi-line import statements', () => {
    const content = `
from pytask import (
  Product,
  task,
)

@task
def task_one():
  pass

def not_a_task():
  pass
`;
    const tasks = provider.findTaskFunctions(dummyPath, content);
    expect(tasks).to.have.lengthOf(1, 'Should find task with multi-line import');
    expect(tasks[0].label).to.equal('task_one');
  });

  test('Should set correct line numbers', () => {
    const content = `
from pytask import task

def task_one():  # line 4
  pass

@task
def decorated_task():  # line 8
  pass
`;
    const tasks = provider.findTaskFunctions(dummyPath, content);
    expect(tasks).to.have.lengthOf(2, 'Should find both tasks');
    expect(tasks[0].label).to.equal('decorated_task');
    expect(tasks[0].lineNumber).to.equal(8);
    expect(tasks[1].label).to.equal('task_one');
    expect(tasks[1].lineNumber).to.equal(4);
  });
});
