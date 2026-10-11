/// <reference types="vite/client" />
export {}

declare global {
  interface Window {
    api?: {
      openFiles(): Promise<string[]>
      expandPaths(paths: string[]): Promise<string[]>
      mediaUrls(paths: string[]): Promise<string[]>
      pathForFile(file: File): string
      onAutoload(cb: (paths: string[]) => void): void
      setFullScreen(on: boolean): Promise<void>
      toggleFullScreen(): Promise<void>
      /** Full screen for the float window opened under `name`. */
      setFloatFullScreen(name: string, on: boolean): Promise<void>
      onFullScreen(cb: (on: boolean) => void): void
      /** A float window (by name) entered or left full screen. */
      onFloatFullScreen(cb: (name: string, on: boolean) => void): void
    }
  }
}
