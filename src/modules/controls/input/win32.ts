/**
 * Dünne Schicht über die Windows-API (user32/kernel32) per koffi.
 * Enthält bewusst keine Logik. Die steckt in foreground.ts und sequence.ts und ist dort testbar.
 * Kein Lesen von Spielspeicher, kein Einschleusen in den Spielprozess: nur Fenster abfragen und Tasten senden.
 */
import type { Hwnd, WindowApi } from './foreground.js';
import type { Key } from './keys.js';

const INPUT_KEYBOARD = 1;
const KEYEVENTF_EXTENDEDKEY = 0x0001;
const KEYEVENTF_KEYUP = 0x0002;
const KEYEVENTF_SCANCODE = 0x0008;
const VK_MENU = 0x12;
const SW_RESTORE = 9;
const GW_OWNER = 4;
const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x80;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;

export interface Win32 extends Omit<WindowApi, 'sleep'> {
  sendKey(key: Key, up: boolean): void;
}

let shared: Promise<Win32> | null = null;
/** Einmal pro Prozess laden: koffi-Typen dürfen nicht doppelt angelegt werden (Controls und Mining nutzen das). */
export function loadWin32(): Promise<Win32> {
  shared ??= createWin32();
  shared.catch(() => (shared = null));
  return shared;
}

async function createWin32(): Promise<Win32> {
  if (process.platform !== 'win32') throw new Error('Der Windows-Treiber läuft nur unter Windows');
  const koffi = (await import('koffi')).default;
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');

  // Feste Breiten statt "long", damit die Strukturen exakt dem Windows-Layout entsprechen (INPUT = 40 Byte auf x64)
  koffi.struct('KEYBDINPUT', { wVk: 'uint16', wScan: 'uint16', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr_t' });
  koffi.struct('MOUSEINPUT', { dx: 'int32', dy: 'int32', mouseData: 'uint32', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr_t' });
  koffi.struct('HARDWAREINPUT', { uMsg: 'uint32', wParamL: 'uint16', wParamH: 'uint16' });
  koffi.union('INPUT_UNION', { mi: 'MOUSEINPUT', ki: 'KEYBDINPUT', hi: 'HARDWAREINPUT' });
  const INPUT = koffi.struct('INPUT', { type: 'uint32', u: 'INPUT_UNION' });
  const INPUT_SIZE = koffi.sizeof(INPUT);
  koffi.proto('bool __stdcall EnumWindowsProc(uintptr_t hwnd, intptr_t lParam)');

  const SendInput = user32.func('uint32 __stdcall SendInput(uint32 cInputs, INPUT *pInputs, int cbSize)');
  const GetForegroundWindow = user32.func('uintptr_t __stdcall GetForegroundWindow()');
  const SetForegroundWindow = user32.func('bool __stdcall SetForegroundWindow(uintptr_t hWnd)');
  const EnumWindows = user32.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t lParam)');
  const IsWindowVisible = user32.func('bool __stdcall IsWindowVisible(uintptr_t hWnd)');
  const IsIconic = user32.func('bool __stdcall IsIconic(uintptr_t hWnd)');
  const ShowWindow = user32.func('bool __stdcall ShowWindow(uintptr_t hWnd, int nCmdShow)');
  const GetWindow = user32.func('uintptr_t __stdcall GetWindow(uintptr_t hWnd, uint32 uCmd)');
  const GetWindowLongPtrW = user32.func('intptr_t __stdcall GetWindowLongPtrW(uintptr_t hWnd, int nIndex)');
  const GetWindowThreadProcessId = user32.func('uint32 __stdcall GetWindowThreadProcessId(uintptr_t hWnd, _Out_ uint32_t *pid)');
  const OpenProcess = kernel32.func('uintptr_t __stdcall OpenProcess(uint32 access, bool inherit, uint32 pid)');
  const QueryFullProcessImageNameW = kernel32.func(
    'bool __stdcall QueryFullProcessImageNameW(uintptr_t hProcess, uint32 flags, void *buf, _Inout_ uint32_t *size)',
  );
  const CloseHandle = kernel32.func('bool __stdcall CloseHandle(uintptr_t h)');

  const big = (v: unknown): Hwnd => BigInt(v as number | bigint);

  function send(ki: { wVk: number; wScan: number; dwFlags: number }) {
    const input = { type: INPUT_KEYBOARD, u: { ki: { ...ki, time: 0, dwExtraInfo: 0 } } };
    // Rückgabe 0: von Windows blockiert (z. B. anderer Desktop wie UAC-Abfrage oder Sperrbildschirm)
    if (SendInput(1, input, INPUT_SIZE) !== 1) throw new Error('Windows hat den Tastendruck abgelehnt (SendInput)');
  }

  return {
    sendKey(key, up) {
      let flags = KEYEVENTF_SCANCODE;
      if (key.extended) flags |= KEYEVENTF_EXTENDEDKEY;
      if (up) flags |= KEYEVENTF_KEYUP;
      send({ wVk: 0, wScan: key.scan, dwFlags: flags });
    },

    unlockForeground() {
      send({ wVk: VK_MENU, wScan: 0, dwFlags: 0 });
      send({ wVk: VK_MENU, wScan: 0, dwFlags: KEYEVENTF_KEYUP });
    },

    foreground: () => big(GetForegroundWindow()),

    processName(hwnd) {
      const pid = [0];
      GetWindowThreadProcessId(hwnd, pid);
      if (!pid[0]) return '';
      const h = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid[0]);
      if (!big(h)) return '';
      try {
        const buf = Buffer.alloc(1024 * 2);
        const size = [1024];
        if (!QueryFullProcessImageNameW(h, 0, buf, size)) return '';
        const path = buf.toString('utf16le', 0, size[0] * 2);
        return path.slice(path.lastIndexOf('\\') + 1);
      } finally {
        CloseHandle(h);
      }
    },

    topLevelWindows() {
      const all: Hwnd[] = [];
      EnumWindows((h: unknown) => {
        all.push(big(h));
        return true;
      }, 0);
      return all.filter(
        (h) =>
          IsWindowVisible(h) &&
          !big(GetWindow(h, GW_OWNER)) &&
          (Number(GetWindowLongPtrW(h, GWL_EXSTYLE)) & WS_EX_TOOLWINDOW) === 0,
      );
    },

    isMinimized: (hwnd) => !!IsIconic(hwnd),
    restore: (hwnd) => void ShowWindow(hwnd, SW_RESTORE),
    setForeground: (hwnd) => !!SetForegroundWindow(hwnd),
  };
}
