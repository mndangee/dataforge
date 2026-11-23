import type { ProjectFsApi } from "../electron/preload/index.d.ts";

declare global {
  interface Window {
    /** preload `contextBridge` — Next 브라우저 단독 실행 시 없음 */
    electron?: {
      ipcRenderer?: {
        invoke: <T = unknown>(channel: string, ...args: unknown[]) => Promise<T>;
      };
    };
    api?: {
      projects: ProjectFsApi;
    };
  }
}

export {};
