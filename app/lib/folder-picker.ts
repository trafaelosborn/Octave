import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export async function pickFolder(): Promise<string | null> {
  if (process.platform === 'win32') {
    const script = [
      'Add-Type -AssemblyName System.Windows.Forms',
      '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
      "$dialog.Description = 'Choose an Octave research workspace'",
      '$dialog.ShowNewFolderButton = $true',
      'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }',
    ].join('; ');
    return runPicker('powershell.exe', ['-NoProfile', '-STA', '-Command', script]);
  }
  if (process.platform === 'darwin') {
    return runPicker('osascript', ['-e', 'POSIX path of (choose folder with prompt "Choose an Octave research workspace")']);
  }
  return runPicker('zenity', ['--file-selection', '--directory', '--title=Choose an Octave research workspace']);
}

async function runPicker(command: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(command, args, { windowsHide: true });
    return stdout.trim() || null;
  } catch (error) {
    const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
    if (code === 1) return null;
    throw new Error('Could not open the system folder chooser. Paste the folder path instead.');
  }
}
