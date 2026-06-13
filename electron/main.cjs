const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

// Avoid GPU process crashes ("GPU process isn't usable. Goodbye.") on
// systems where Chromium's GPU sandbox fails (common on Linux/Wayland).
app.disableHardwareAcceleration();

let torrentClient = null;

// Dynamically import WebTorrent (which is ESM-only in v2)
async function initTorrentClient() {
    if (!torrentClient) {
        const { default: WebTorrent } = await import('webtorrent');
        torrentClient = new WebTorrent();
    }
    return torrentClient;
}

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            preload: path.join(__dirname, 'preload.cjs')
        },
        icon: path.join(__dirname, '../assets/icon-only.png')
    });

    // Load the app
    if (process.env.NODE_ENV === 'development' || process.env.ELECTRON_IS_DEV) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, '../dist/index.html'));
    }

    mainWindow.on('closed', () => {
        mainWindow = null;
    });
}

app.whenReady().then(() => {
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        if (torrentClient) {
            torrentClient.destroy();
        }
        app.quit();
    }
});

// IPC Handlers for WebTorrent
ipcMain.handle('torrent:add', async (event, magnetURI) => {
    const client = await initTorrentClient();
    return new Promise((resolve, reject) => {
        client.add(magnetURI, (torrent) => {
            resolve({
                infoHash: torrent.infoHash,
                name: torrent.name,
                files: torrent.files.map(f => ({ name: f.name, length: f.length, path: f.path }))
            });
        });
        client.on('error', reject);
    });
});

ipcMain.handle('torrent:select-file', async (event, infoHash, filePath) => {
    const client = await initTorrentClient();
    const torrent = client.get(infoHash);
    if (!torrent) return null;

    const targetFile = torrent.files.find(f => f.path === filePath);
    if (!targetFile) return null;

    // Deselect all files first
    torrent.files.forEach(f => f.deselect());
    
    // Select only the target file
    targetFile.select();

    // Return a local URL to stream the file
    return new Promise((resolve) => {
        targetFile.getBlobURL((err, url) => {
            if (err) {
                // Fallback to creating a local server if blob URL fails
                if (!torrent.server) {
                    torrent.createServer().listen(0, () => {
                        const port = torrent.server.address().port;
                        resolve(`http://localhost:${port}${targetFile.path}`);
                    });
                } else {
                    const port = torrent.server.address().port;
                    resolve(`http://localhost:${port}${targetFile.path}`);
                }
            } else {
                resolve(url);
            }
        });
    });
});

ipcMain.handle('torrent:progress', async (event, infoHash) => {
    const client = await initTorrentClient();
    const torrent = client.get(infoHash);
    if (!torrent) return 0;
    return torrent.progress;
});

ipcMain.handle('torrent:destroy', async (event, infoHash) => {
    const client = await initTorrentClient();
    const torrent = client.get(infoHash);
    if (torrent) {
        torrent.destroy();
    }
});