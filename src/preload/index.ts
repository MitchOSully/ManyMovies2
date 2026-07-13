import { contextBridge, ipcRenderer, webUtils } from 'electron'

contextBridge.exposeInMainWorld('api', {
  openFiles: (): Promise<string[]> => ipcRenderer.invoke('open-files'),
  expandPaths: (paths: string[]): Promise<string[]> => ipcRenderer.invoke('expand-paths', paths),
  pathForFile: (file: File): string => webUtils.getPathForFile(file),
  onAutoload: (cb: (paths: string[]) => void): void => {
    ipcRenderer.on('autoload', (_e, paths: string[]) => cb(paths))
  }
})
