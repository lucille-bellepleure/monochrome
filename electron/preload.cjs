const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    addTorrent: (magnetURI) => ipcRenderer.invoke('torrent:add', magnetURI),
    selectFile: (infoHash, filePath) => ipcRenderer.invoke('torrent:select-file', infoHash, filePath),
    getProgress: (infoHash) => ipcRenderer.invoke('torrent:progress', infoHash),
    destroyTorrent: (infoHash) => ipcRenderer.invoke('torrent:destroy', infoHash)
});
