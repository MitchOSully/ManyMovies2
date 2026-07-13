import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('api', {
  openFiles: (): Promise<string[]> => ipcRenderer.invoke('open-files'),
  expandPaths: (paths: string[]): Promise<string[]> => ipcRenderer.invoke('expand-paths', paths),
  mediaUrls: (paths: string[]): Promise<string[]> => ipcRenderer.invoke('media-urls', paths),
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  onAutoload: (cb: (paths: string[]) => void): void => {
    ipcRenderer.on('autoload', (_e, paths: string[]) => cb(paths))
  }
})
