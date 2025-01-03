import * as vscode from "vscode";
import { activate as activateTaskProvider } from "./providers/taskProvider";

export function activate(context: vscode.ExtensionContext) {
  activateTaskProvider(context);
}

export function deactivate() {}
