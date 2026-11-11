; Silver Skies Windows installer (Inno Setup 6).
; Built by .github/workflows/release.yml:
;   ISCC.exe /DAppVersion=<version> /O"<repo-root>" /F"SilverSkies-Setup-<version>" dist\windows\installer.iss
; Override the version with /DAppVersion; the default below is only a fallback.
#define AppVersion "0.0.0"

[Setup]
AppName=Silver Skies
AppVerName=Silver Skies {#AppVersion}
AppVersion={#AppVersion}
AppId=com.silverskies.desktop
DefaultDirName={autopf}\Silver Skies
DefaultGroupName=Silver Skies
OutputDir=..\..
OutputBaseFilename=SilverSkies-Setup-{#AppVersion}
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=lowest
WizardStyle=modern

[Files]
Source: "..\..\stage\silverskies.exe"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\..\stage\README.md"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{group}\Silver Skies"; Filename: "{app}\silverskies.exe"
Name: "{autodesktop}\Silver Skies"; Filename: "{app}\silverskies.exe"; Tasks: desktopicon

[Tasks]
Name: desktopicon; Description: "Create a &desktop shortcut"; Flags: unchecked

[Run]
Filename: "{app}\silverskies.exe"; Description: "Launch Silver Skies"; Flags: nowait postinstall skipifsilent
