[Version]
Class=IEXPRESS
SEDVersion=3
[Options]
PackagePurpose=InstallApp
ShowInstallProgramWindow=1
HideExtractAnimation=1
UseLongFileName=1
InsideCompressed=1
CAB_FixedSize=0
CAB_ResvCodeSigning=0
RebootMode=I
InstallPrompt=%InstallPrompt%
DisplayLicense=%DisplayLicense%
FinishMessage=%FinishMessage%
TargetName=%TargetName%
FriendlyName=%FriendlyName%
AppLaunched=%AppLaunched%
PostInstallCmd=%PostInstallCmd%
AdminQuietInstCmd=%AdminQuietInstCmd%
UserQuietInstCmd=%UserQuietInstCmd%
SourceFiles=SourceFiles
[Strings]
InstallPrompt=
DisplayLicense=
FinishMessage=
TargetName=C:\Users\samue\Downloads\1\LIVRE PARA O CODEX\chaotic-api-main\Chaotic.exe
FriendlyName=Chaotic Local
AppLaunched=powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File launcher.ps1
PostInstallCmd=<None>
AdminQuietInstCmd=
UserQuietInstCmd=
FILE0="start.bat"
FILE1="launch.vbs"
FILE2="launcher.ps1"
[SourceFiles]
SourceFiles0=C:\Users\samue\Downloads\1\LIVRE PARA O CODEX\chaotic-api-main\
[SourceFiles0]
%FILE0%=
%FILE1%=
%FILE2%=
