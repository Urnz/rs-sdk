using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

// Windows socket handles created by Bun are inheritable. An explicit HANDLE_LIST
// prevents workers from retaining the admin's listeners after the admin exits.
public sealed class RsSdkManagedProcess : IDisposable {
    private IntPtr process;
    private RsSdkManagedProcess(IntPtr handle) { process = handle; }
    public bool HasExited { get { return WaitForSingleObject(process, 0) == 0; } }
    public void Kill() { if (!HasExited && !TerminateProcess(process, 1)) throw new Win32Exception(Marshal.GetLastWin32Error()); }
    public void WaitForExit() { WaitForSingleObject(process, 0xffffffff); }
    public void Dispose() { if (process != IntPtr.Zero) { CloseHandle(process); process = IntPtr.Zero; } }

    public static RsSdkManagedProcess Start(string executable, string worker, string directory, string output, string error) {
        IntPtr input = IntPtr.Zero, stdout = IntPtr.Zero, stderr = IntPtr.Zero, attributes = IntPtr.Zero, handles = IntPtr.Zero;
        bool initialized = false;
        try {
            var security = new SecurityAttributes { length = Marshal.SizeOf<SecurityAttributes>(), inherit = true };
            input = Open("NUL", 0x80000000, 3, ref security);
            stdout = Open(output, 0x40000000, 2, ref security);
            stderr = Open(error, 0x40000000, 2, ref security);
            IntPtr size = IntPtr.Zero;
            InitializeProcThreadAttributeList(IntPtr.Zero, 1, 0, ref size);
            attributes = Marshal.AllocHGlobal(size);
            if (!InitializeProcThreadAttributeList(attributes, 1, 0, ref size)) throw new Win32Exception(Marshal.GetLastWin32Error());
            initialized = true;
            handles = Marshal.AllocHGlobal(IntPtr.Size * 3);
            Marshal.Copy(new[] { input, stdout, stderr }, 0, handles, 3);
            if (!UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x20002), handles, new IntPtr(IntPtr.Size * 3), IntPtr.Zero, IntPtr.Zero))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            var startup = new StartupInfoEx { attributes = attributes };
            startup.info.size = Marshal.SizeOf<StartupInfoEx>();
            startup.info.flags = 0x101; // STARTF_USESTDHANDLES | STARTF_USESHOWWINDOW
            startup.info.showWindow = 0;
            startup.info.input = input; startup.info.output = stdout; startup.info.error = stderr;
            ProcessInformation created;
            var command = new StringBuilder("\"" + executable + "\" --no-env-file \"" + worker + "\"");
            if (!CreateProcess(executable, command, IntPtr.Zero, IntPtr.Zero, true, 0x08080000, IntPtr.Zero, directory, ref startup, out created))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            CloseHandle(created.thread);
            return new RsSdkManagedProcess(created.process);
        } finally {
            if (initialized) DeleteProcThreadAttributeList(attributes);
            if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
            if (handles != IntPtr.Zero) Marshal.FreeHGlobal(handles);
            foreach (var handle in new[] { input, stdout, stderr }) if (handle != IntPtr.Zero && handle != new IntPtr(-1)) CloseHandle(handle);
        }
    }
    private static IntPtr Open(string path, uint access, uint disposition, ref SecurityAttributes security) {
        var handle = CreateFile(path, access, 7, ref security, disposition, 0x80, IntPtr.Zero);
        if (handle == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
        return handle;
    }
    [StructLayout(LayoutKind.Sequential)] private struct SecurityAttributes { public int length; public IntPtr descriptor; [MarshalAs(UnmanagedType.Bool)] public bool inherit; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct StartupInfo {
        public int size; public string reserved; public string desktop; public string title;
        public int x, y, width, height, xChars, yChars, fill, flags; public short showWindow, reservedSize;
        public IntPtr reservedPointer, input, output, error;
    }
    [StructLayout(LayoutKind.Sequential)] private struct StartupInfoEx { public StartupInfo info; public IntPtr attributes; }
    [StructLayout(LayoutKind.Sequential)] private struct ProcessInformation { public IntPtr process, thread; public uint processId, threadId; }
    [DllImport("kernel32.dll", EntryPoint = "CreateProcessW", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CreateProcess(string application, StringBuilder command, IntPtr processSecurity, IntPtr threadSecurity,
        [MarshalAs(UnmanagedType.Bool)] bool inherit, uint flags, IntPtr environment, string directory, ref StartupInfoEx startup, out ProcessInformation information);
    [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)] private static extern IntPtr CreateFile(string path, uint access, uint share, ref SecurityAttributes security, uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, int flags, ref IntPtr size);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
    [DllImport("kernel32.dll")] private static extern void DeleteProcThreadAttributeList(IntPtr list);
    [DllImport("kernel32.dll")] private static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool TerminateProcess(IntPtr handle, uint exitCode);
    [DllImport("kernel32.dll")] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool CloseHandle(IntPtr handle);
}
