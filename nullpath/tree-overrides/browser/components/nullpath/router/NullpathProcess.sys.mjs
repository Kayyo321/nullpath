/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/**
 * Minimal Win32 process helpers for the managed router and the shared
 * process registry (I2P-ROUTER-TOGGLE.md §5.5, §7.3).
 *
 * i2pd is launched with CreateProcessW directly, not Subprocess.sys.mjs:
 * Subprocess assigns children to a job object that is closed with the
 * launching process, which would stop the router when one profile exits while
 * others still use it. CREATE_BREAKAWAY_FROM_JOB keeps it independent, and the
 * router is tracked by PID + creation time instead.
 */

import { AppConstants } from "resource://gre/modules/AppConstants.sys.mjs";
import { ctypes } from "resource://gre/modules/ctypes.sys.mjs";

const IS_WIN = AppConstants.platform == "win";

const PROCESS_TERMINATE = 0x0001;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const STILL_ACTIVE = 259;
const CREATE_NEW_PROCESS_GROUP = 0x00000200;
const CREATE_UNICODE_ENVIRONMENT = 0x00000400;
const CREATE_BREAKAWAY_FROM_JOB = 0x01000000;
const CREATE_NO_WINDOW = 0x08000000;
const ERROR_ACCESS_DENIED = 5;

let win = null;

function api() {
  if (win) {
    return win;
  }
  if (!IS_WIN) {
    throw new Error("NullpathProcess is only implemented on Windows");
  }
  const { BOOL, DWORD, WORD, HANDLE, LPVOID, voidptr_t, char16_t } = {
    BOOL: ctypes.int,
    DWORD: ctypes.uint32_t,
    WORD: ctypes.uint16_t,
    HANDLE: ctypes.voidptr_t,
    LPVOID: ctypes.voidptr_t,
    voidptr_t: ctypes.voidptr_t,
    char16_t: ctypes.char16_t,
  };
  const LPWSTR = char16_t.ptr;
  const FILETIME = new ctypes.StructType("FILETIME", [
    { dwLowDateTime: DWORD },
    { dwHighDateTime: DWORD },
  ]);
  const STARTUPINFOW = new ctypes.StructType("STARTUPINFOW", [
    { cb: DWORD },
    { lpReserved: LPWSTR },
    { lpDesktop: LPWSTR },
    { lpTitle: LPWSTR },
    { dwX: DWORD },
    { dwY: DWORD },
    { dwXSize: DWORD },
    { dwYSize: DWORD },
    { dwXCountChars: DWORD },
    { dwYCountChars: DWORD },
    { dwFillAttribute: DWORD },
    { dwFlags: DWORD },
    { wShowWindow: WORD },
    { cbReserved2: WORD },
    { lpReserved2: voidptr_t },
    { hStdInput: HANDLE },
    { hStdOutput: HANDLE },
    { hStdError: HANDLE },
  ]);
  const PROCESS_INFORMATION = new ctypes.StructType("PROCESS_INFORMATION", [
    { hProcess: HANDLE },
    { hThread: HANDLE },
    { dwProcessId: DWORD },
    { dwThreadId: DWORD },
  ]);
  const k32 = ctypes.open("kernel32.dll");
  const abi = ctypes.winapi_abi;
  win = {
    FILETIME,
    STARTUPINFOW,
    PROCESS_INFORMATION,
    DWORD,
    OpenProcess: k32.declare("OpenProcess", abi, HANDLE, DWORD, BOOL, DWORD),
    CloseHandle: k32.declare("CloseHandle", abi, BOOL, HANDLE),
    GetExitCodeProcess: k32.declare(
      "GetExitCodeProcess",
      abi,
      BOOL,
      HANDLE,
      DWORD.ptr
    ),
    GetProcessTimes: k32.declare(
      "GetProcessTimes",
      abi,
      BOOL,
      HANDLE,
      FILETIME.ptr,
      FILETIME.ptr,
      FILETIME.ptr,
      FILETIME.ptr
    ),
    QueryFullProcessImageNameW: k32.declare(
      "QueryFullProcessImageNameW",
      abi,
      BOOL,
      HANDLE,
      DWORD,
      LPWSTR,
      DWORD.ptr
    ),
    TerminateProcess: k32.declare(
      "TerminateProcess",
      abi,
      BOOL,
      HANDLE,
      ctypes.uint32_t
    ),
    CreateProcessW: k32.declare(
      "CreateProcessW",
      abi,
      BOOL,
      LPWSTR, // lpApplicationName
      LPWSTR, // lpCommandLine (must be writable)
      LPVOID,
      LPVOID,
      BOOL,
      DWORD,
      LPVOID,
      LPWSTR, // lpCurrentDirectory
      STARTUPINFOW.ptr,
      PROCESS_INFORMATION.ptr
    ),
  };
  return win;
}

function withProcess(pid, access, fn) {
  let w = api();
  let h = w.OpenProcess(access, 0, pid);
  if (h.isNull()) {
    return null;
  }
  try {
    return fn(h, w);
  } finally {
    w.CloseHandle(h);
  }
}

function creationTime(h, w) {
  let c = new w.FILETIME();
  let e = new w.FILETIME();
  let k = new w.FILETIME();
  let u = new w.FILETIME();
  if (!w.GetProcessTimes(h, c.address(), e.address(), k.address(), u.address())) {
    return 0;
  }
  return c.dwHighDateTime * 2 ** 32 + c.dwLowDateTime;
}

/** Quotes one argument for CommandLineToArgvW. */
function quoteArg(arg) {
  if (arg && !/[\s"]/.test(arg)) {
    return arg;
  }
  return '"' + arg.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, "$1$1") + '"';
}

export const NullpathProcess = {
  /** Process creation time (FILETIME as a number), or 0. */
  startTime(pid) {
    if (!IS_WIN) {
      return 0;
    }
    return (
      withProcess(pid, PROCESS_QUERY_LIMITED_INFORMATION, creationTime) ?? 0
    );
  },

  /**
   * True when `pid` is running and, if given, was created at `startTime`
   * (guards against PID reuse).
   */
  isAlive(pid, startTime = 0) {
    if (!IS_WIN || !pid) {
      return false;
    }
    return !!withProcess(pid, PROCESS_QUERY_LIMITED_INFORMATION, (h, w) => {
      let code = new w.DWORD();
      if (!w.GetExitCodeProcess(h, code.address()) || code.value != STILL_ACTIVE) {
        return false;
      }
      return !startTime || creationTime(h, w) == startTime;
    });
  },

  /** Full path of the process image, or null. */
  imagePath(pid) {
    if (!IS_WIN) {
      return null;
    }
    return withProcess(pid, PROCESS_QUERY_LIMITED_INFORMATION, (h, w) => {
      let buf = ctypes.char16_t.array(1024)();
      let len = new w.DWORD(1024);
      if (!w.QueryFullProcessImageNameW(h, 0, buf, len.address())) {
        return null;
      }
      return buf.readString().slice(0, len.value);
    });
  },

  kill(pid) {
    if (!IS_WIN) {
      return false;
    }
    return !!withProcess(pid, PROCESS_TERMINATE, (h, w) =>
      w.TerminateProcess(h, 1)
    );
  },

  /**
   * Starts `exe` with `args`, hidden and outside any job object.
   *
   * @returns {{pid: number, startTime: number}}
   */
  launchDetached(exe, args, cwd) {
    let w = api();
    let cmd = [exe, ...args].map(quoteArg).join(" ");
    let attempt = flags => {
      let si = new w.STARTUPINFOW();
      si.cb = w.STARTUPINFOW.size;
      let pi = new w.PROCESS_INFORMATION();
      let cmdBuf = ctypes.char16_t.array()(cmd);
      let ok = w.CreateProcessW(
        exe,
        cmdBuf,
        null,
        null,
        0,
        flags,
        null,
        cwd,
        si.address(),
        pi.address()
      );
      return { ok, pi, error: ok ? 0 : ctypes.winLastError };
    };
    let base = CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP | CREATE_UNICODE_ENVIRONMENT;
    let r = attempt(base | CREATE_BREAKAWAY_FROM_JOB);
    if (!r.ok && r.error == ERROR_ACCESS_DENIED) {
      // Our own job doesn't allow breakaway; the router then lives as long
      // as this process, which the panel reports on the next check.
      r = attempt(base);
    }
    if (!r.ok) {
      throw new Error(`CreateProcessW failed (${r.error})`);
    }
    let pid = r.pi.dwProcessId;
    let startTime = creationTime(r.pi.hProcess, w);
    w.CloseHandle(r.pi.hThread);
    w.CloseHandle(r.pi.hProcess);
    return { pid, startTime };
  },
};
