import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface TaskDefinition {
  name: string;
  lineNumber: number;
}

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

    for (const folder of workspaceFolders) {
      const taskFiles = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, '**/task_*.py'),
        '{**/node_modules/**,**/.venv/**,**/.git/**,**/.pixi/**,**/venv/**,**/__pycache__/**}'
      );

      for (const taskFile of taskFiles) {
        const relativePath = path.relative(folder.uri.fsPath, taskFile.fsPath);
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
            const fullPath = path.join(folder.uri.fsPath, currentPath);

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
        const taskFunctions = this.findTaskFunctions(content);
        const moduleItem = new ModuleItem(
          fileName,
          taskFunctions.map((task) => new TaskItem(task.name, taskFile.fsPath, task.lineNumber)),
          taskFile.fsPath
        );

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
    }

    // Sort everything
    const sortItems = (items: TreeItemType[]) => {
      items.sort((a, b) => {
        // Folders come before modules
        if (a instanceof FolderItem && !(b instanceof FolderItem)) return -1;
        if (!(a instanceof FolderItem) && b instanceof FolderItem) return 1;
        // Alphabetical sort within same type
        return a.label.localeCompare(b.label);
      });

      // Sort children recursively
      items.forEach((item) => {
        if (item instanceof FolderItem) {
          sortItems(item.children);
        } else if (item instanceof ModuleItem) {
          item.children.sort((a, b) => a.label.localeCompare(b.label));
        }
      });
    };

    const result = Array.from(rootItems.values());
    sortItems(result);
    return result;
  }

  private findTaskFunctions(content: string): TaskDefinition[] {
    const tasks: TaskDefinition[] = [];
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const match = line.match(/def\s+(task_\w+)\s*\(/);
      if (match) {
        tasks.push({
          name: match[1],
          lineNumber: i + 1,
        });
      }
    }

    return tasks;
  }
}

export function activate(context: vscode.ExtensionContext) {
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
}

export function deactivate() {}
