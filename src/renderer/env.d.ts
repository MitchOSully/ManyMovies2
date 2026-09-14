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
      onFullScreen(cb: (on: boolean) => void): void
    }
  }
}
