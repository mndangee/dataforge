/// <reference path="./vite-env.d.ts" />
import { app, shell, BrowserWindow, ipcMain } from "electron";
import { join } from "path";
import { electronApp, optimizer, is } from "@electron-toolkit/utils";

import {
  flushProxyRequestHistory,
  initializeProxyRequestHistory,
  stopInterceptGatewayServer,
} from "./intercept-gateway";
import { applyMockProxyFromConfig, registerMockProxyIpc, stopMockProxyServer } from "./mock-proxy-server";
import { disableProxyConfigAfterCrashRecovery, registerProjectFsIpc } from "./project-fs";
import { restoreActiveProxyTakeover, restorePendingProxyTakeoverOnStartup } from "./proxy-port-takeover";

let quitCleanupStarted = false;
let quitCleanupFinished = false;
type StartupRecoveryNotice = { type: "success" | "error"; message: string };
let startupRecoveryNotice: StartupRecoveryNotice | null = null;
let startupInitialization: Promise<void> = Promise.resolve();
let mainWindow: BrowserWindow | null = null;
let startupWindow: BrowserWindow | null = null;
const hasSingleInstanceLock = app.requestSingleInstanceLock();

const STARTUP_SCREEN_HTML = `<!doctype html>
<html lang="ko">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'" />
    <style>
      * { box-sizing: border-box; }
      html, body { width: 100%; height: 100%; margin: 0; }
      body {
        display: flex;
        align-items: center;
        justify-content: center;
        background: #f7f9fc;
        color: #222;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "Malgun Gothic", sans-serif;
        user-select: none;
      }
      main { display: flex; flex-direction: column; align-items: center; gap: 18px; }
      .brand { font-size: 24px; font-weight: 750; letter-spacing: -0.5px; }
      .status { display: flex; align-items: center; gap: 10px; color: #667085; font-size: 13px; font-weight: 600; }
      .spinner {
        width: 18px;
        height: 18px;
        border: 2px solid #cfe0ff;
        border-top-color: #0057ff;
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
      }
      @keyframes spin { to { transform: rotate(360deg); } }
    </style>
  </head>
  <body>
    <main role="status" aria-live="polite">
      <div class="brand">DataForge</div>
      <div class="status"><span class="spinner" aria-hidden="true"></span><span>프로그램을 준비하고 있습니다</span></div>
    </main>
  </body>
</html>`;

function isAllowedExternalUrl(rawUrl: string): boolean {
  try {
    const protocol = new URL(rawUrl).protocol;
    return protocol === "https:" || protocol === "http:";
  } catch {
    return false;
  }
}

function createWindow(): void {
  startupWindow = new BrowserWindow({
    width: 360,
    height: 220,
    show: false,
    frame: false,
    resizable: false,
    backgroundColor: "#f7f9fc",
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  startupWindow.once("ready-to-show", () => startupWindow?.show());
  void startupWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(STARTUP_SCREEN_HTML)}`);

  // 메인 화면은 렌더링을 마친 뒤 표시해 시작 중 흰 화면이 노출되지 않게 합니다.
  mainWindow = new BrowserWindow({
    width: 1920,
    height: 1080,
    show: false,
    backgroundColor: "#fafafa",
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  mainWindow.on("closed", () => {
    startupWindow?.close();
    startupWindow = null;
    mainWindow = null;
  });

  mainWindow.once("ready-to-show", () => {
    startupWindow?.close();
    startupWindow = null;
    mainWindow?.show();
    mainWindow?.focus();
  });

  mainWindow.webContents.once("did-fail-load", () => {
    startupWindow?.close();
    startupWindow = null;
    mainWindow?.show();
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    if (isAllowedExternalUrl(details.url)) void shell.openExternal(details.url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, targetUrl) => {
    const currentUrl = mainWindow?.webContents.getURL();
    if (currentUrl && targetUrl === currentUrl) return;
    event.preventDefault();
    if (isAllowedExternalUrl(targetUrl)) void shell.openExternal(targetUrl);
  });

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env["ELECTRON_RENDERER_URL"]) {
    mainWindow.loadURL(process.env["ELECTRON_RENDERER_URL"]);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (startupWindow && !startupWindow.isDestroyed()) {
      startupWindow.show();
      startupWindow.focus();
      return;
    }
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(() => {
  // Set app user model id for windows
  electronApp.setAppUserModelId("com.electron");

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on("browser-window-created", (_, window) => {
    optimizer.watchWindowShortcuts(window);
  });

  // IPC test
  ipcMain.on("ping", () => console.log("pong"));

  /** IPC는 app.ready 이후에만 등록(Electron 버전에 따른 핸들러 유실 방지) */
  registerProjectFsIpc();
  registerMockProxyIpc();
  ipcMain.removeHandler("proxy:get-startup-recovery-notice");
  ipcMain.handle("proxy:get-startup-recovery-notice", async () => {
    await startupInitialization;
    const notice = startupRecoveryNotice;
    startupRecoveryNotice = null;
    return notice;
  });

  // 창은 즉시 표시하고, 디스크 기록 및 이전 서버 복구는 백그라운드에서 처리합니다.
  // 복구가 오래 걸리거나 실패해도 사용자는 빈 화면을 기다리지 않습니다.
  startupInitialization = (async () => {
    try {
      await initializeProxyRequestHistory();
      const crashRecovery = await restorePendingProxyTakeoverOnStartup();
      if (!crashRecovery.ok || crashRecovery.restored) {
        await disableProxyConfigAfterCrashRecovery().catch((error) => console.error("[startup-recovery] failed to disable proxy config:", error));
        if (!crashRecovery.ok) {
          console.error("[startup-recovery]", crashRecovery.error);
          startupRecoveryNotice = {
            type: "error",
            message: `프로젝트 서버를 자동으로 복구하지 못했습니다.\n\n${crashRecovery.error}\n\n프록시 설정에서 서버 폴더와 실행 방법을 확인한 뒤 다시 연결해 주세요.`,
          };
        } else {
          startupRecoveryNotice = { type: "success", message: "이전에 전환했던 프로젝트 서버를 원래 포트로 복구했습니다." };
        }
      } else {
        await applyMockProxyFromConfig();
      }
    } catch (error) {
      console.error("[startup] initialization failed:", error);
      startupRecoveryNotice = {
        type: "error",
        message: "시작 설정을 확인하는 중 오류가 발생했습니다. 앱은 계속 사용할 수 있으며, 연결 설정에서 상태를 다시 확인해 주세요.",
      };
    }
  })();
  createWindow();

  app.on("activate", function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (!mainWindow) createWindow();
  });
  });
}

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", (event) => {
  if (quitCleanupFinished) return;
  event.preventDefault();
  if (quitCleanupStarted) return;
  quitCleanupStarted = true;

  void (async () => {
    try {
      // 원래 포트를 복구하기 전에 DataForge가 점유한 포트와 관리 서버를 모두 정리한다.
      await stopInterceptGatewayServer();
      await stopMockProxyServer();
      await flushProxyRequestHistory();
      const restored = await restoreActiveProxyTakeover();
      if (!restored.ok) console.error("[app-quit] failed to restore the original project server:", restored.error);
    } catch (error) {
      console.error("[app-quit] proxy cleanup failed:", error);
    } finally {
      quitCleanupFinished = true;
      app.quit();
    }
  })();
});

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
