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
      return [];
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
      return [];
    }

    const tasks: TaskItem[] = [];
    for (const folder of workspaceFolders) {
      const taskFiles = await vscode.workspace.findFiles(
        new vscode.RelativePattern(folder, '**/task_*.py'),
        '**/node_modules/**'
      );

      for (const taskFile of taskFiles) {
        const content = fs.readFileSync(taskFile.fsPath, 'utf8');
        const taskFunctions = this.findTaskFunctions(content);

        for (const task of taskFunctions) {
          tasks.push(
            new TaskItem(
              task.name,
              vscode.TreeItemCollapsibleState.None,
              taskFile.fsPath,
              task.lineNumber
            )
          );
        }
      }
    }

    return tasks;
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
    public readonly lineNumber: number
  ) {
    super(label, collapsibleState);
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
    this.contextValue = 'task';
  }
}

export function activate(context: vscode.ExtensionContext) {
  const pytaskProvider = new PyTaskProvider();
  vscode.window.registerTreeDataProvider('pytaskExplorer', pytaskProvider);

  // Register a command to refresh the tree view
  const refreshCommand = vscode.commands.registerCommand('pytask.refresh', () => {
    pytaskProvider.refresh();
  });

  // Add the provider to subscriptions so it gets disposed properly
  context.subscriptions.push(refreshCommand, pytaskProvider);
}

export function deactivate() {}
