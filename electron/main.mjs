import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

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

app.whenReady().then(async () => {
    // Initialize torrent client in the background
    await initTorrentClient();
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

// Reliable public trackers to force peer discovery in Electron
const PUBLIC_TRACKERS = [
    'udp://zer0day.ch:1337/announce',
    'udp://tracker.publictracker.xyz:6969/announce',
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://open.demonii.com:1337/announce',
    'udp://open.stealth.si:80/announce',
    'udp://wepzone.net:6969/announce',
    'udp://tracker.torrent.eu.org:451/announce',
    'udp://tracker.qu.ax:6969/announce',
    'udp://tracker.peerfect.org:6969/announce',
    'udp://tracker.filemail.com:6969/announce',
    'udp://tracker.dler.org:6969/announce',
    'udp://tracker.corpscorp.online:80/announce',
    'udp://tracker.bittor.pw:1337/announce',
    'udp://tracker.auctor.tv:6969/announce',
    'udp://tracker.004430.xyz:1337/announce',
    'udp://tracker-udp.gbitt.info:80/announce',
    'udp://torrents.tmtime.dev:6969/announce',
    'udp://torrentclub.online:54123/announce',
    'udp://t.overflow.biz:6969/announce',
    'udp://retracker01-msk-virt.corbina.net:80/announce',
];

// IPC Handlers for WebTorrent
ipcMain.handle('torrent:add', async (event, magnetURI) => {
    console.log(`[Electron Main] 🧲 torrent:add called with magnetURI: ${magnetURI}`);
    const client = await initTorrentClient();
    console.log(`[Electron Main] 🔍 client instance:`, client ? 'Valid' : 'Null', client?.constructor?.name);

    return new Promise(async (resolve, reject) => {
        let isResolved = false;

        // 30-second timeout to prevent hanging on dead torrents and give DHT time to bootstrap
        const timeoutId = setTimeout(() => {
            if (!isResolved) {
                console.error(
                    `[Electron Main] ⏱️ Timeout: Failed to fetch torrent metadata within 30 seconds. No peers found or trackers blocked.`
                );
                reject(new Error('Timeout: No peers found for metadata'));
            }
        }, 30000);

        try {
            // Extract infoHash from magnet URI to check for duplicates
            const infoHashMatch = magnetURI.match(/btih:([a-zA-Z0-9]+)/i);
            const infoHash = infoHashMatch ? infoHashMatch[1].toLowerCase() : null;
            console.log(`[Electron Main] 🔍 Extracted infoHash: ${infoHash}`);

            // Use await to safely handle cases where client.get might unexpectedly return a Promise
            let torrent = infoHash ? await client.get(infoHash) : null;
            console.log(`[Electron Main] 🔍 client.get result:`, torrent ? 'Found existing' : 'Not found', typeof torrent);

            if (!torrent) {
                console.log(`[Electron Main] ➕ Attempting client.add...`);
                // Inject robust public trackers to maximize peer discovery resilience
                torrent = await client.add(magnetURI, { announce: PUBLIC_TRACKERS });
                console.log(
                    `[Electron Main] ✅ client.add returned. Type:`,
                    typeof torrent,
                    torrent ? 'Valid object' : 'Null/Undefined'
                );
            }

            // Safeguard: ensure we have a valid torrent object before attaching listeners
            console.log(
                `[Electron Main] 🔍 Final torrent check. Exists:`,
                !!torrent,
                `Has .on:`,
                typeof torrent?.on === 'function'
            );
            
            if (!torrent || typeof torrent.on !== 'function') {
                console.error(`[Electron Main] ❌ Torrent object is invalid:`, torrent);
                clearTimeout(timeoutId);
                reject(new Error('Failed to initialize or retrieve torrent instance'));
                return;
            }

            if (torrent.metadata) {
                clearTimeout(timeoutId);
                isResolved = true;
                resolve({
                    infoHash: torrent.infoHash,
                    name: torrent.name,
                    files: torrent.files.map((f) => ({ name: f.name, length: f.length, path: f.path })),
                });
                return;
            }

            torrent.on('metadata', () => {
                console.log(`[Electron Main] ✅ Metadata received for: ${torrent.name} (${torrent.infoHash})`);
                clearTimeout(timeoutId);
                isResolved = true;
                resolve({
                    infoHash: torrent.infoHash,
                    name: torrent.name,
                    files: torrent.files.map((f) => ({ name: f.name, length: f.length, path: f.path })),
                });
            });

            torrent.on('warning', (err) => {
                console.warn(`[Electron Main] ⚠️ Torrent warning:`, err.message || err);
            });

            torrent.on('error', (err) => {
                console.error(`[Electron Main] ❌ Torrent error:`, err.message || err);
                clearTimeout(timeoutId);
                if (!isResolved) {
                    isResolved = true;
                    reject(err);
                }
            });

            client.on('error', (err) => {
                console.error(`[Electron Main] ❌ WebTorrent client error:`, err);
                clearTimeout(timeoutId);
                if (!isResolved) {
                    isResolved = true;
                    reject(err);
                }
            });
        } catch (err) {
            console.error(`[Electron Main] ❌ Unexpected error in torrent:add:`, err);
            clearTimeout(timeoutId);
            reject(err);
        }
    });
});

ipcMain.handle('torrent:select-file', async (event, infoHash, filePath) => {
    console.log(`[Electron Main] 📁 torrent:select-file called for infoHash: ${infoHash}, filePath: ${filePath}`);
    const client = await initTorrentClient();
    const torrent = client.get(infoHash);
    if (!torrent) {
        console.error(`[Electron Main] ❌ Torrent not found for infoHash: ${infoHash}`);
        return null;
    }

    const targetFile = torrent.files.find(f => f.path === filePath);
    if (!targetFile) {
        console.error(`[Electron Main] ❌ File not found in torrent. Available files:`, torrent.files.map(f => f.path));
        return null;
    }

    // Deselect all files first
    torrent.files.forEach(f => f.deselect());
    
    // Select only the target file
    targetFile.select();
    console.log(`[Electron Main] ✅ File selected. Requesting blob URL...`);

    // Return a local URL to stream the file
    return new Promise((resolve) => {
        targetFile.getBlobURL((err, url) => {
            if (err) {
                console.error(`[Electron Main] ❌ getBlobURL failed:`, err);
                // Fallback to creating a local server if blob URL fails
                if (!torrent.server) {
                    torrent.createServer().listen(0, () => {
                        const port = torrent.server.address().port;
                        const serverUrl = `http://localhost:${port}${targetFile.path}`;
                        console.log(`[Electron Main] 🌐 Fallback server created at: ${serverUrl}`);
                        resolve(serverUrl);
                    });
                } else {
                    const port = torrent.server.address().port;
                    const serverUrl = `http://localhost:${port}${targetFile.path}`;
                    console.log(`[Electron Main] 🌐 Using existing server at: ${serverUrl}`);
                    resolve(serverUrl);
                }
            } else {
                console.log(`[Electron Main] ✅ Blob URL generated successfully: ${url}`);
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

ipcMain.handle('torrent:stats', async (event, infoHash) => {
    const client = await initTorrentClient();
    const torrent = client.get(infoHash);
    if (!torrent) {
        // console.log(`[Electron Main] ⚠️ Stats requested for unknown infoHash: ${infoHash}`);
        return null;
    }
    
    return {
        progress: torrent.progress,
        downloadSpeed: torrent.downloadSpeed,
        numPeers: torrent.numPeers,
        downloaded: torrent.downloaded
    };
});
