const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const http = require('http');

// Avoid GPU process crashes ("GPU process isn't usable. Goodbye.") on
// systems where Chromium's GPU sandbox fails (common on Linux/Wayland).
app.disableHardwareAcceleration();

let torrentClient = null;
let serverCreating = false;
let customStreamingServer = null;
let customStreamingServerPort = null;

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
            preload: path.join(__dirname, 'preload.cjs'),
        },
        icon: path.join(__dirname, '../assets/icon-only.png'),
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

// Reliable public trackers to force peer discovery in Electron
const PUBLIC_TRACKERS = [
    // WebSocket trackers (highly reliable in Electron/Node.js as they bypass UDP blocking)
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.webtorrent.dev',
    'wss://tracker.btorrent.xyz',
    'wss://tracker.files.fm:7073/announce',
    // UDP trackers (fallback)
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
    // Additional high-availability trackers from popular music torrents
    'udp://public.popcorn-tracker.org:6969/announce',
    'udp://exodus.desync.com:6969/announce',
    'udp://glotorrents.pw:6969/announce',
    'udp://tracker.coppersurfer.tk:6969/announce',
    'udp://torrent.gresille.org:80/announce',
    'udp://p4p.arenabg.com:1337/announce',
    'udp://tracker.internetwarriors.net:1337/announce',
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

            // Diagnostic: log peer discovery progress
            const diagInterval = setInterval(() => {
                console.log(
                    `[Electron Main] 📊 Diagnostic: peers=${torrent.numPeers}, ` +
                    `progress=${(torrent.progress * 100).toFixed(1)}%, ` +
                    `downloaded=${torrent.downloaded}, ` +
                    `downloadSpeed=${typeof torrent.downloadSpeed === 'function' ? torrent.downloadSpeed() : torrent.downloadSpeed}, ` +
                    `metadata=${!!torrent.metadata}, ` +
                    `ready=${torrent.ready}, ` +
                    `DHT=${client.dht ? 'enabled' : 'disabled'}`
                );
            }, 5000);

            torrent.on('metadata', () => {
                console.log(`[Electron Main] ✅ Metadata received for: ${torrent.name} (${torrent.infoHash})`);
                console.log(`[Electron Main] 📊 At metadata: peers=${torrent.numPeers}, DHT=${client.dht ? 'enabled' : 'disabled'}`);
                clearInterval(diagInterval);
                clearTimeout(timeoutId);
                isResolved = true;
                resolve({
                    infoHash: torrent.infoHash,
                    name: torrent.name,
                    files: torrent.files.map((f) => ({ name: f.name, length: f.length, path: f.path })),
                });
            });

            torrent.on('done', () => {
                console.log(`[Electron Main] ✅ Download complete for: ${torrent.name}`);
                clearInterval(diagInterval);
            });

            torrent.on('peer', (addr) => {
                console.log(`[Electron Main] 🤝 New peer connected: ${addr} (total: ${torrent.numPeers})`);
            });

            torrent.on('warning', (err) => {
                const msg = err.message || String(err);
                // Ignore benign WebTorrent warnings that clutter the console
                if (msg.includes('Connection ID missmatch') || msg.includes('failed verification')) {
                    return;
                }
                console.warn(`[Electron Main] ⚠️ Torrent warning:`, msg);
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
    const client = await initTorrentClient();
    let torrent = client.get(infoHash);
    
    // Ensure we have the resolved torrent object (in case it's wrapped in a Promise)
    if (torrent && typeof torrent.then === 'function') {
        torrent = await torrent;
    }
    
    if (!torrent) {
        console.error(`[Electron Main] ❌ Torrent not found in client: ${infoHash}`);
        return null;
    }

    // Safety check: ensure files array exists before calling .find()
    if (!torrent.files || !Array.isArray(torrent.files)) {
        console.error(`[Electron Main] ❌ Torrent files array is missing or invalid for ${infoHash}`);
        return null;
    }

    const targetFile = torrent.files.find((f) => f.path === filePath);
    if (!targetFile) {
        console.error(`[Electron Main] ❌ Target file not found. Requested: "${filePath}"`);
        console.error(`[Electron Main] 📂 Available files:`, torrent.files.map(f => f.path));
        return null;
    }
    
    console.log(`[Electron Main] 📁 Target file found: "${targetFile.path}" (${(targetFile.length / 1024 / 1024).toFixed(2)} MB)`);

    // 1. Deselect everything at the piece level to prevent downloading unwanted data
    torrent.deselect(0, torrent.pieces.length - 1, false);

    // 2. Also deselect every file (belt + suspenders approach)
    torrent.files.forEach((f) => f.deselect());

    // 3. Select only the target file for streaming
    targetFile.select();
    console.log(`[Electron Main] ✅ Target file selected for streaming.`);

    // Return a local URL to stream the file using a custom HTTP server
    return new Promise((resolve, reject) => {
        let settled = false;
        const timeout = setTimeout(() => {
            if (!settled) {
                settled = true;
                console.error(`[Electron Main] ❌ Timeout waiting for torrent streaming server to start.`);
                reject(new Error('Timeout waiting for torrent streaming server to start'));
            }
        }, 5000);

        const getStreamUrl = (port) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            // Encode each path segment individually to preserve the '/' separators
            const encodedPath = targetFile.path.split('/').map(encodeURIComponent).join('/');
            resolve(`http://localhost:${port}/${torrent.infoHash}/${encodedPath}`);
        };

        const attemptServerCreation = () => {
            // 1. If our custom server exists and is listening, reuse it
            if (customStreamingServer && customStreamingServer.listening) {
                console.log(`[Electron Main] ✅ Custom streaming server already exists and is listening on port ${customStreamingServerPort}, reusing it.`);
                getStreamUrl(customStreamingServerPort);
                return;
            }

            // 2. If another request is currently in the middle of creating the server, wait for it
            if (serverCreating) {
                console.log('[Electron Main] ⏳ Server is being created by another request, waiting...');
                const checkInterval = setInterval(() => {
                    if (!serverCreating && customStreamingServer && customStreamingServer.listening) {
                        clearInterval(checkInterval);
                        console.log(`[Electron Main] ✅ Waited server is ready and listening on port ${customStreamingServerPort}, using it.`);
                        getStreamUrl(customStreamingServerPort);
                    }
                }, 50);
                
                // Safety: clear interval and reject if we approach the main timeout
                setTimeout(() => {
                    if (!settled) {
                        clearInterval(checkInterval);
                        settled = true;
                        reject(new Error('Timeout waiting for pending server creation'));
                    }
                }, 4500);
                return;
            }

            // 3. We are the first to create it
            console.log('[Electron Main] 🏗️ Creating new custom streaming server...');
            serverCreating = true;
            try {
                const server = http.createServer((req, res) => {
                    // Parse URL: /infoHash/encoded/path
                    const urlParts = req.url.split('/').filter(Boolean);
                    if (urlParts.length < 2) {
                        res.writeHead(400, { 'Access-Control-Allow-Origin': '*' });
                        res.end('Bad Request');
                        return;
                    }

                    const reqInfoHash = urlParts[0];
                    const encodedFilePath = urlParts.slice(1).join('/');
                    const decodedFilePath = decodeURIComponent(encodedFilePath);

                    console.log(`[Electron Main] 🌐 Server received request: ${req.method} ${req.url}`);
                    console.log(`[Electron Main] 🔍 Decoded path: ${decodedFilePath}`);

                    // Handle CORS preflight requests
                    if (req.method === 'OPTIONS') {
                        res.writeHead(204, {
                            'Access-Control-Allow-Origin': '*',
                            'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
                            'Access-Control-Allow-Headers': 'Range, Content-Type'
                        });
                        res.end();
                        return;
                    }

                    // Find the torrent
                    const t = client.torrents.find(t => t.infoHash === reqInfoHash);
                    if (!t) {
                        res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
                        res.end('Torrent not found');
                        return;
                    }

                    // Find the file
                    const file = t.files.find(f => f.path === decodedFilePath);
                    if (!file) {
                        console.error(`[Electron Main] ❌ File not found in torrent. Requested: "${decodedFilePath}"`);
                        res.writeHead(404, { 'Access-Control-Allow-Origin': '*' });
                        res.end('File not found');
                        return;
                    }

                    // Simple MIME type detection
                    const ext = file.name.split('.').pop().toLowerCase();
                    const mimeTypes = {
                        'mp3': 'audio/mpeg',
                        'flac': 'audio/flac',
                        'wav': 'audio/wav',
                        'ogg': 'audio/ogg',
                        'm4a': 'audio/mp4',
                        'aac': 'audio/aac',
                        'mp4': 'video/mp4',
                        'mkv': 'video/x-matroska',
                        'jpg': 'image/jpeg',
                        'jpeg': 'image/jpeg',
                        'png': 'image/png'
                    };
                    const contentType = mimeTypes[ext] || 'application/octet-stream';

                    // Handle Range requests
                    const range = req.headers.range;
                    const fileSize = file.length;

                    if (range) {
                        const parts = range.replace(/bytes=/, '').split('-');
                        const start = parseInt(parts[0], 10);
                        const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
                        const chunkSize = (end - start) + 1;

                        console.log(`[Electron Main] 📦 Serving range: ${start}-${end} (${chunkSize} bytes)`);

                        res.writeHead(206, {
                            'Access-Control-Allow-Origin': '*',
                            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
                            'Accept-Ranges': 'bytes',
                            'Content-Length': chunkSize,
                            'Content-Type': contentType
                        });

                        const stream = file.createReadStream({ start, end });
                        stream.pipe(res);
                        stream.on('error', (err) => {
                            console.error(`[Electron Main] ❌ Stream error:`, err);
                            res.end();
                        });
                    } else {
                        console.log(`[Electron Main] 📦 Serving full file: ${fileSize} bytes`);
                        res.writeHead(200, {
                            'Access-Control-Allow-Origin': '*',
                            'Content-Length': fileSize,
                            'Accept-Ranges': 'bytes',
                            'Content-Type': contentType
                        });

                        const stream = file.createReadStream();
                        stream.pipe(res);
                        stream.on('error', (err) => {
                            console.error(`[Electron Main] ❌ Stream error:`, err);
                            res.end();
                        });
                    }
                });

                server.on('error', (err) => {
                    console.error(`[Electron Main] ❌ Custom streaming server error:`, err);
                });

                server.listen(0, () => {
                    serverCreating = false;
                    customStreamingServer = server;
                    customStreamingServerPort = server.address().port;
                    if (!settled) {
                        console.log(`[Electron Main] ✅ New custom streaming server listening on port ${customStreamingServerPort}`);
                        getStreamUrl(customStreamingServerPort);
                    }
                });
            } catch (err) {
                serverCreating = false;
                console.error('[Electron Main] ❌ Failed to create custom streaming server:', err);
                settled = true;
                clearTimeout(timeout);
                reject(err);
            }
        };

        attemptServerCreation();
    });
});

ipcMain.handle('torrent:progress', async (event, infoHash) => {
    const client = await initTorrentClient();
    const cleanInfoHash = String(infoHash).toLowerCase();
    const torrent = await client.get(cleanInfoHash);
    if (!torrent || !torrent.infoHash) return 0;
    return torrent.progress;
});

ipcMain.handle('torrent:stats', async (event, infoHash) => {
    console.log(`[Electron Main] 📊 getStats called with infoHash: "${infoHash}" (type: ${typeof infoHash})`);
    const client = await initTorrentClient();
    
    // Ensure infoHash is a clean, lowercase string
    const cleanInfoHash = String(infoHash).toLowerCase();
    const torrent = await client.get(cleanInfoHash);
    
    console.log(`[Electron Main] 📊 getStats raw torrent type:`, typeof torrent);
    console.log(`[Electron Main] 📊 getStats raw torrent constructor:`, torrent?.constructor?.name);
    console.log(`[Electron Main] 📊 getStats client.torrents count:`, client.torrents.length);
    console.log(`[Electron Main] 📊 getStats client.torrents infoHashes:`, client.torrents.map(t => t.infoHash));
    
    if (!torrent || !torrent.infoHash) {
        console.error(`[Electron Main] ❌ getStats: Invalid torrent object or missing infoHash for ${cleanInfoHash}`);
        return null;
    }
    
    console.log(`[Electron Main] 📊 getStats result: Found torrent ${torrent.infoHash}, peers=${torrent.numPeers}, progress=${torrent.progress}`);
    
    return {
        progress: Number(torrent.progress) || 0,
        downloadSpeed: Number(typeof torrent.downloadSpeed === 'function' ? torrent.downloadSpeed() : torrent.downloadSpeed) || 0,
        numPeers: Number(torrent.numPeers) || 0,
        downloaded: Number(torrent.downloaded) || 0,
    };
});

ipcMain.handle('torrent:destroy', async (event, infoHash) => {
    const client = await initTorrentClient();
    const cleanInfoHash = String(infoHash).toLowerCase();
    const torrent = await client.get(cleanInfoHash);
    if (torrent && torrent.infoHash) {
        torrent.destroy();
    }
});
