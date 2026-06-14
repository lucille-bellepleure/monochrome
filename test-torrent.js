const WebTorrent = require('webtorrent');

const client = new WebTorrent();

const magnetURI = 'magnet:?xt=urn:btih:6f29e90e3209c5e11aa197d98e4908257bbdfd91&dn=U2%20-%20The%20Joshua%20Tree%20(Super%20Deluxe)%202017';

const trackers = [
    'wss://tracker.openwebtorrent.com',
    'wss://tracker.btorrent.xyz',
    'wss://tracker.files.fm:7073/announce',
    'udp://tracker.opentrackr.org:1337/announce',
    'udp://tracker.openbittorrent.com:6969/announce',
    'udp://open.stealth.si:80/announce',
    'udp://tracker.torrent.eu.org:451/announce',
    'udp://exodus.desync.com:6969/announce'
];

console.log('🧲 Adding torrent...');
console.log(`Magnet: ${magnetURI}`);

client.add(magnetURI, { announce: trackers }, (torrent) => {
    console.log('✅ Torrent added!');
    console.log(`Info Hash: ${torrent.infoHash}`);
    
    torrent.on('metadata', () => {
        console.log('📄 Metadata received!');
        console.log(`Name: ${torrent.name}`);
        console.log(`Total Size: ${(torrent.length / 1024 / 1024).toFixed(2)} MB`);
        console.log(`Files: ${torrent.files.length}`);
    });

    torrent.on('download', (bytes) => {
        console.log(`⬇️  Downloading: ${(torrent.progress * 100).toFixed(1)}% | ` +
                    `Speed: ${(torrent.downloadSpeed / 1024 / 1024).toFixed(2)} MB/s | ` +
                    `Peers: ${torrent.numPeers}`);
    });

    torrent.on('done', () => {
        console.log('🎉 Download complete!');
        client.destroy();
    });

    torrent.on('error', (err) => {
        console.error('❌ Torrent error:', err.message);
    });
});

client.on('error', (err) => {
    console.error('❌ Client error:', err.message);
});

// Timeout after 60 seconds if nothing happens
setTimeout(() => {
    if (client.torrents.length > 0 && !client.torrents[0].done) {
        console.log('⏱️  Test timed out after 60 seconds.');
        console.log(`Current progress: ${(client.torrents[0].progress * 100).toFixed(1)}%`);
        console.log(`Current peers: ${client.torrents[0].numPeers}`);
    }
    client.destroy();
    process.exit(0);
}, 60000);