using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

namespace ChaoticLauncherApp
{
    internal static class Program
    {
        [STAThread]
        private static void Main()
        {
            var executableDirectory = AppDomain.CurrentDomain.BaseDirectory;
            var launcherPath = Path.Combine(executableDirectory, "launcher.ps1");

            if (!File.Exists(launcherPath))
            {
                ShowError("Arquivo launcher.ps1 nao encontrado na pasta do jogo. Coloque o executavel junto dos arquivos do projeto.");
                return;
            }

            try
            {
                var projectRootHint = executableDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
                var arguments = string.Format(
                    "-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{0}\" -ProjectRootHint \"{1}\"",
                    launcherPath,
                    projectRootHint
                );

                var processInfo = new ProcessStartInfo
                {
                    FileName = "powershell.exe",
                    Arguments = arguments,
                    UseShellExecute = false,
                    CreateNoWindow = true,
                    WindowStyle = ProcessWindowStyle.Hidden,
                    WorkingDirectory = executableDirectory,
                };

                Process.Start(processInfo);
            }
            catch (Exception error)
            {
                ShowError("Falha ao iniciar o launcher: " + error.Message);
            }
        }

        private static void ShowError(string message)
        {
            MessageBox.Show(message, "Chaotic Launcher", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }
}
