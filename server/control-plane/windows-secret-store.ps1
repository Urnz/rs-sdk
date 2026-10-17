$ErrorActionPreference = 'Stop'
# Private pipe protocol: never accept a credential in arguments, environment, or a file.
try {
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    if ($request.target -notmatch '^rs-sdk/v1/[a-f0-9]{64}/[a-z0-9-]{1,64}$') { throw 'Invalid credential target.' }
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class RsCredential {
    [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)]
    public struct Credential {
        public uint Flags, Type;
        public string TargetName, Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint BlobSize;
        public IntPtr Blob;
        public uint Persist, AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias, UserName;
    }
    [DllImport("advapi32.dll", EntryPoint="CredWriteW", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern bool Write(ref Credential credential, uint flags);
    [DllImport("advapi32.dll", EntryPoint="CredReadW", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern bool Read(string target, uint type, uint flags, out IntPtr credential);
    [DllImport("advapi32.dll", EntryPoint="CredDeleteW", CharSet=CharSet.Unicode, SetLastError=true)]
    public static extern bool Delete(string target, uint type, uint flags);
    [DllImport("advapi32.dll", EntryPoint="CredFree")]
    public static extern void Free(IntPtr credential);
}
'@
    switch ($request.operation) {
        'set' {
            $bytes = [Text.Encoding]::UTF8.GetBytes([string]$request.value)
            if ($bytes.Length -lt 1 -or $bytes.Length -gt 2560) { throw 'Invalid secret length.' }
            $pointer = [Runtime.InteropServices.Marshal]::AllocHGlobal($bytes.Length)
            try {
                [Runtime.InteropServices.Marshal]::Copy($bytes, 0, $pointer, $bytes.Length)
                $credential = [RsCredential+Credential]::new()
                $credential.Type = 1; $credential.TargetName = $request.target
                $credential.BlobSize = $bytes.Length; $credential.Blob = $pointer
                $credential.Persist = 2; $credential.UserName = 'rs-sdk'
                if (-not [RsCredential]::Write([ref]$credential, 0)) { throw 'Credential write failed.' }
            } finally {
                [Array]::Clear($bytes, 0, $bytes.Length)
                for ($i = 0; $i -lt $credential.BlobSize; $i++) { [Runtime.InteropServices.Marshal]::WriteByte($pointer, $i, 0) }
                [Runtime.InteropServices.Marshal]::FreeHGlobal($pointer)
            }
            [Console]::Out.Write('{"ok":true}')
        }
        { $_ -in 'get', 'status' } {
            $pointer = [IntPtr]::Zero
            if (-not [RsCredential]::Read($request.target, 1, 0, [ref]$pointer)) {
                if ([Runtime.InteropServices.Marshal]::GetLastWin32Error() -ne 1168) { throw 'Credential read failed.' }
                [Console]::Out.Write('{"configured":false}')
                break
            }
            try {
                $credential = [Runtime.InteropServices.Marshal]::PtrToStructure($pointer, [type][RsCredential+Credential])
                if ($request.operation -eq 'status') { [Console]::Out.Write('{"configured":true}') }
                else {
                    $bytes = [byte[]]::new($credential.BlobSize)
                    [Runtime.InteropServices.Marshal]::Copy($credential.Blob, $bytes, 0, $bytes.Length)
                    try { [Console]::Out.Write((@{configured=$true;value=[Text.Encoding]::UTF8.GetString($bytes)} | ConvertTo-Json -Compress)) }
                    finally { [Array]::Clear($bytes, 0, $bytes.Length) }
                }
            } finally { [RsCredential]::Free($pointer) }
        }
        'delete' {
            if (-not [RsCredential]::Delete($request.target, 1, 0) -and [Runtime.InteropServices.Marshal]::GetLastWin32Error() -ne 1168) { throw 'Credential delete failed.' }
            [Console]::Out.Write('{"ok":true}')
        }
        default { throw 'Invalid operation.' }
    }
} catch {
    # Native/provider details may contain sensitive data. Only this bounded error crosses the pipe.
    [Console]::Error.Write('Windows credential store operation failed.')
    exit 1
}
