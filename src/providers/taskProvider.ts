import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

type TreeItemType = FolderItem | ModuleItem | TaskItem;

class FolderItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly children: (FolderItem | ModuleItem)[] = [],
    public readonly folderPath: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.Expanded);
    this.contextValue = 'folder';
    this.iconPath = new vscode.ThemeIcon('folder');
    this.tooltip = folderPath;
  }
}

class ModuleItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly children: TaskItem[] = [],
    public readonly filePath: string
  ) {
    super(label, vscode.TreeItemCollapsibleState.Collapsed);
    this.contextValue = 'module';
    this.iconPath = new vscode.ThemeIcon('symbol-file');
    this.tooltip = filePath;
    this.command = {
      command: 'vscode.open',
      title: 'Open Module File',
      arguments: [vscode.Uri.file(filePath)],
    };
  }
}

class TaskItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly filePath: string,
    public readonly lineNumber: number
  ) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = 'task';
    this.iconPath = new vscode.ThemeIcon('symbol-method');
    this.tooltip = `${this.label} - ${path.basename(this.filePath)}:${this.lineNumber}`;
    this.description = path.basename(this.filePath);
    this.command = {
      command: 'vscode.open',
      title: 'Open Task File',
      arguments: [
        vscode.Uri.file(this.filePath),
        {
          selection: new vscode.Range(
            new vscode.Position(this.lineNumber - 1, 0),
            new vscode.Position(this.lineNumber - 1, 0)
          ),
        },
      ],
    };
  }
}

export class PyTaskProvider implements vscode.TreeDataProvider<TreeItemType> {
  private _onDidChangeTreeData: vscode.EventEmitter<TreeItemType | undefined | null | void> =
    new vscode.EventEmitter<TreeItemType | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<TreeItemType | undefined | null | void> =
    this._onDidChangeTreeData.event;
  private fileSystemWatcher: vscode.FileSystemWatcher;

  constructor() {
    this.fileSystemWatcher = vscode.workspace.createFileSystemWatcher('**/task_*.py');

    this.fileSystemWatcher.onDidCreate(() => {
      this.refresh();
    });

    this.fileSystemWatcher.onDidChange(() => {
      this.refresh();
    });

    this.fileSystemWatcher.onDidDelete(() => {
      this.refresh();
    });
  }

  dispose() {
    this.fileSystemWatcher.dispose();
  }

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: TreeItemType): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TreeItemType): Promise<TreeItemType[]> {
    if (!element) {
      return this.buildFileTree();
    }

    if (element instanceof FolderItem) {
      return element.children;
    }

    if (element instanceof ModuleItem) {
      return element.children;
    }

    return [];
  }

  private async buildFileTree(): Promise<TreeItemType[]> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return [];
    }

    const rootItems = new Map<string, TreeItemType>();

    // Get all task modules across the workspace
    const taskFiles = await vscode.workspace.findFiles(
      '**/task_*.py',
      '{**/node_modules/**,**/.venv/**,**/.git/**,**/.pixi/**,**/venv/**,**/__pycache__/**}'
    );

    // Process each task module
    for (const taskFile of taskFiles) {
      const relativePath = path.relative(workspaceFolders[0].uri.fsPath, taskFile.fsPath);
      const dirPath = path.dirname(relativePath);
      const fileName = path.basename(taskFile.fsPath);

      // Create folder hierarchy
      let currentPath = '';
      let currentItems = rootItems;
      const pathParts = dirPath.split(path.sep);

      // Skip if it's in the root
      if (dirPath !== '.') {
        for (const part of pathParts) {
          currentPath = currentPath ? path.join(currentPath, part) : part;
          const fullPath = path.join(workspaceFolders[0].uri.fsPath, currentPath);

          if (!currentItems.has(currentPath)) {
            const newFolder = new FolderItem(part, [], fullPath);
            currentItems.set(currentPath, newFolder);
          }

          const folderItem = currentItems.get(currentPath);
          if (folderItem instanceof FolderItem) {
            currentItems = new Map(
              folderItem.children
                .filter((child) => child instanceof FolderItem)
                .map((child) => [path.basename(child.label), child as FolderItem])
            );
          }
        }
      }

      // Create module and its tasks
      const content = fs.readFileSync(taskFile.fsPath, 'utf8');
      const taskItems = this.findTaskFunctions(taskFile.fsPath, content);
      const moduleItem = new ModuleItem(fileName, taskItems, taskFile.fsPath);

      // Add module to appropriate folder or root
      if (dirPath === '.') {
        rootItems.set(fileName, moduleItem);
      } else {
        const parentFolder = rootItems.get(dirPath);
        if (parentFolder instanceof FolderItem) {
          parentFolder.children.push(moduleItem);
        }
      }
    }

    // Sort everything
    const result = Array.from(rootItems.values());

    // Sort folders and modules
    result.sort((a, b) => {
      // Folders come before modules
      if (a instanceof FolderItem && !(b instanceof FolderItem)) return -1;
      if (!(a instanceof FolderItem) && b instanceof FolderItem) return 1;
      // Alphabetical sort within same type
      return a.label.localeCompare(b.label);
    });

    return result;
  }

  findTaskFunctions(filePath: string, content: string): TaskItem[] {
    // Find out whether the task decorator is used in the file.

    // Booleans to track if the task decorator is imported as `from pytask import task`
    // and used as `@task` or `import pytask` and used as `@pytask.task`.
    let hasTaskImport = false;
    let taskAlias = 'task'; // default name for 'from pytask import task'
    let pytaskAlias = 'pytask'; // default name for 'import pytask'
    let hasPytaskImport = false;

    // Match the import statements
    // Handle various import patterns:
    // - from pytask import task
    // - from pytask import task as t
    // - from pytask import Product, task
    // - from pytask import (Product, task)
    const fromPytaskImport = content.match(
      /from\s+pytask\s+import\s+(?:\(?\s*(?:[\w]+\s*,\s*)*task(?:\s+as\s+(\w+))?(?:\s*,\s*[\w]+)*\s*\)?)/
    );
    const importPytask = content.match(/import\s+pytask(?:\s+as\s+(\w+))?\s*$/m);

    if (fromPytaskImport) {
      hasTaskImport = true;
      if (fromPytaskImport[1]) {
        taskAlias = fromPytaskImport[1];
      }
    }

    if (importPytask) {
      hasPytaskImport = true;
      // If there's an alias (import pytask as something), use it
      pytaskAlias = importPytask[1] || 'pytask';
    }

    // Find the tasks.
    const tasks: TaskItem[] = [];
    const lines = content.split('\n');

    let isDecorated = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Check for decorators
      if (line.startsWith('@')) {
        // Handle both @task and @pytask.task(...) patterns
        isDecorated =
          (hasTaskImport && line === `@${taskAlias}`) ||
          (hasPytaskImport && line.startsWith(`@${pytaskAlias}.task`));
        continue;
      }

      // Check for function definitions
      const funcMatch = line.match(/^def\s+(\w+)\s*\(/);
      if (funcMatch) {
        const funcName = funcMatch[1];
        // Add if it's a task_* function or has a task decorator
        if (funcName.startsWith('task_') || isDecorated) {
          tasks.push(new TaskItem(funcName, filePath, i + 1));
        }
        isDecorated = false; // Reset decorator flag
      }
    }

    // Sort the tasks by name.
    tasks.sort((a, b) => a.label.localeCompare(b.label));

    return tasks;
  }
}

export function activate(context: vscode.ExtensionContext): vscode.TreeView<TreeItemType> {
  const pytaskProvider = new PyTaskProvider();
  const treeView = vscode.window.createTreeView('pytaskExplorer', {
    treeDataProvider: pytaskProvider,
    showCollapseAll: true,
  });

  context.subscriptions.push(treeView);

  const refreshCommand = vscode.commands.registerCommand('pytask.refresh', () => {
    pytaskProvider.refresh();
  });

  context.subscriptions.push(refreshCommand, pytaskProvider);

  return treeView;
}
