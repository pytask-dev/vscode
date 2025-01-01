import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

interface TaskDefinition {
  name: string;
  lineNumber: number;
}

export class PyTaskProvider implements vscode.TreeDataProvider<TaskItem> {
  private _onDidChangeTreeData: vscode.EventEmitter<TaskItem | undefined | null | void> =
    new vscode.EventEmitter<TaskItem | undefined | null | void>();
  readonly onDidChangeTreeData: vscode.Event<TaskItem | undefined | null | void> =
    this._onDidChangeTreeData.event;
  private fileSystemWatcher: vscode.FileSystemWatcher;

  constructor() {
    // Create a file system watcher for Python files that start with task_
    this.fileSystemWatcher = vscode.workspace.createFileSystemWatcher('**/task_*.py');

    // Watch for file creation
    this.fileSystemWatcher.onDidCreate(() => {
      this.refresh();
    });

    // Watch for file changes
    this.fileSystemWatcher.onDidChange(() => {
      this.refresh();
    });

    // Watch for file deletion
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

  getTreeItem(element: TaskItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: TaskItem): Promise<TaskItem[]> {
    if (element) {
      return element.children;
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return [];
    }

    const moduleMap = new Map<string, TaskItem>();

    for (const folder of workspaceFolders) {
      const taskFiles = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, '**/task_*.py'),
        '{**/node_modules/**,**/.venv/**,**/.git/**,**/.pixi/**,**/venv/**,**/__pycache__/**}'
      );

      // Create module items for all task files
      for (const taskFile of taskFiles) {
        const fileName = path.basename(taskFile.fsPath);
        if (!moduleMap.has(fileName)) {
          moduleMap.set(
            fileName,
            new TaskItem(
              fileName,
              vscode.TreeItemCollapsibleState.Collapsed,
              taskFile.fsPath,
              undefined,
              [],
              'module'
            )
          );
        }

        // Add tasks if the file has any
        const content = fs.readFileSync(taskFile.fsPath, 'utf8');
        const taskFunctions = this.findTaskFunctions(content);
        const moduleItem = moduleMap.get(fileName)!;

        for (const task of taskFunctions) {
          moduleItem.children.push(
            new TaskItem(
              task.name,
              vscode.TreeItemCollapsibleState.None,
              taskFile.fsPath,
              task.lineNumber,
              [],
              'task'
            )
          );
        }
      }
    }

    // Convert map to sorted array
    return Array.from(moduleMap.values()).sort((a, b) => a.label.localeCompare(b.label));
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
          lineNumber: i + 1, // Convert to 1-based line number
        });
      }
    }

    return tasks;
  }
}

export class TaskItem extends vscode.TreeItem {
  constructor(
    public readonly label: string,
    public readonly collapsibleState: vscode.TreeItemCollapsibleState,
    public readonly filePath: string,
    public readonly lineNumber: number | undefined = undefined,
    public readonly children: TaskItem[] = [],
    public readonly itemType: 'module' | 'task' = 'task'
  ) {
    super(label, collapsibleState);

    if (itemType === 'task') {
      this.tooltip = `${this.label} - ${path.basename(this.filePath)}:${this.lineNumber}`;
      this.description = path.basename(this.filePath);
      this.command = {
        command: 'vscode.open',
        title: 'Open Task File',
        arguments: [
          vscode.Uri.file(this.filePath),
          {
            selection: new vscode.Range(
              new vscode.Position(this.lineNumber! - 1, 0),
              new vscode.Position(this.lineNumber! - 1, 0)
            ),
          },
        ],
      };
      this.contextValue = 'task';
      this.iconPath = new vscode.ThemeIcon('symbol-method');
    } else {
      // Module item
      this.tooltip = this.filePath;
      this.contextValue = 'module';
      this.iconPath = new vscode.ThemeIcon('symbol-file');
      this.command = {
        command: 'vscode.open',
        title: 'Open Module File',
        arguments: [vscode.Uri.file(this.filePath)],
      };
    }
  }
}

export function activate(context: vscode.ExtensionContext) {
  const pytaskProvider = new PyTaskProvider();
  const treeView = vscode.window.createTreeView('pytaskExplorer', {
    treeDataProvider: pytaskProvider,
    showCollapseAll: true,
  });

  // Add the tree view to the extension's subscriptions
  context.subscriptions.push(treeView);

  // Register a command to refresh the tree view
  const refreshCommand = vscode.commands.registerCommand('pytask.refresh', () => {
    pytaskProvider.refresh();
  });

  // Add the provider to subscriptions so it gets disposed properly
  context.subscriptions.push(refreshCommand, pytaskProvider);
}

export function deactivate() {}
