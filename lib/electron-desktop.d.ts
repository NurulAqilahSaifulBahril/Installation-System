export type UpdateStatus =
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "not-available" }
  | { state: "downloading"; percent: number }
  | { state: "downloaded"; version: string }
  | { state: "error"; message: string };

declare global {
  interface Window {
    installationDesktop?: {
      isElectron: true;
      openExternal: (url: string) => void;
      checkForUpdates: () => Promise<void>;
      installUpdate: () => Promise<void>;
      onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
    };
  }
}
