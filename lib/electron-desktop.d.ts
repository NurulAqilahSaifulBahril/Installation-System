export type UpdateStatus =
  | { state: "checking" }
  | { state: "available"; version: string }
  | { state: "not-available" }
  | { state: "downloading"; percent: number }
  | { state: "downloaded"; version: string }
  | { state: "error"; message: string };

export type ConnectionSettings = {
  url: string;
  database: string;
  hasToken: boolean;
};

export type SaveSettingsResult = { ok: true } | { ok: false; message: string };

declare global {
  interface Window {
    installationDesktop?: {
      isElectron: true;
      openExternal: (url: string) => void;
      getSettings: () => Promise<ConnectionSettings>;
      saveSettings: (settings: {
        url: string;
        database: string;
        token: string;
      }) => Promise<SaveSettingsResult>;
      checkForUpdates: () => Promise<void>;
      installUpdate: () => Promise<void>;
      onUpdateStatus: (callback: (status: UpdateStatus) => void) => () => void;
    };
  }
}
