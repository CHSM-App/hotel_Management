; Inno Setup script for the Hotel Manager Windows build.
; CI: iscc /DAppVersion=1.2.3 flutter_frontend\windows\installer.iss
; Per-user install (no UAC) so it can update silently; VC++ runtime is
; installed only when missing (bare Windows 10 boxes).

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

[Setup]
; Never change AppId — Inno uses it to upgrade in place.
AppId={{B7E2A4C1-3D58-4F96-8A0E-6C91D5F23B74}
AppName=Hotel Manager
AppVersion={#AppVersion}
AppPublisher=Vengurla Tech
DefaultDirName={autopf}\Hotel Manager
DefaultGroupName=Hotel Manager
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
ArchitecturesAllowed=x64
ArchitecturesInstallIn64BitMode=x64
OutputDir=..\build\windows\dist
OutputBaseFilename=HotelManagerSetup
SetupIconFile=runner\resources\app_icon.ico
Compression=lzma2
SolidCompression=yes
WizardStyle=modern
CloseApplications=force

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\build\windows\x64\runner\Release\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs
Source: "vc_redist.x64.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall

[Icons]
Name: "{group}\Hotel Manager"; Filename: "{app}\hotel_manager.exe"
Name: "{autodesktop}\Hotel Manager"; Filename: "{app}\hotel_manager.exe"; Tasks: desktopicon

[Run]
Filename: "{tmp}\vc_redist.x64.exe"; Parameters: "/install /quiet /norestart"; StatusMsg: "Installing Microsoft Visual C++ Runtime..."; Check: VCRedistNeedsInstall; Flags: waituntilterminated
Filename: "{app}\hotel_manager.exe"; Description: "{cm:LaunchProgram,Hotel Manager}"; Flags: nowait postinstall

[Code]
function VCRedistNeedsInstall: Boolean;
var
  Installed: Cardinal;
begin
  Result := not (RegQueryDWordValue(HKLM64,
    'SOFTWARE\Microsoft\VisualStudio\14.0\VC\Runtimes\X64', 'Installed', Installed)
    and (Installed = 1));
end;
