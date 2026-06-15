const https = require('https');
const http = require('http');

const TRACKERS = [
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

const HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};

function buildMagnet(infoHash) {
    const magnet = `magnet:?xt=urn:btih:${infoHash}`;
    return magnet + '&' + TRACKERS.map(t => `tr=${encodeURIComponent(t)}`).join('&');
}

function sanitizeQuery(query) {
    // Replace all non-alphanumeric characters with spaces, collapse multiple spaces, and convert to lowercase
    return query.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function scoreResult(title, query, seeders) {
    const lowerTitle = title.toLowerCase();
    const queryWords = query.split(' ').filter(w => w.length > 0);
    let score = 0;
    
    if (queryWords.length === 0) {
        return seeders;
    }

    let matchedWords = 0;
    for (const word of queryWords) {
        if (lowerTitle.includes(word)) {
            matchedWords++;
        }
    }
    
    // Proportional score based on how many query words are found in the title
    const matchRatio = matchedWords / queryWords.length;
    if (matchRatio === 1) {
        score += 10000; // All words found (fuzzy exact match)
    } else if (matchRatio > 0) {
        score += Math.floor(5000 * matchRatio); // Partial match bonus
    }
    
    // Add seeders to score to prioritize popular torrents
    score += seeders;
    return score;
}

function fetchUrl(url) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        const req = protocol.get(url, { headers: HEADERS, timeout: 10000 }, (res) => {
            let data = '';
            res.on('data', chunk => data += chunk);
            res.on('end', () => {
                try {
                    resolve(JSON.parse(data));
                } catch (e) {
                    reject(new Error('Failed to parse JSON'));
                }
            });
        });
        req.on('error', reject);
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Request timeout'));
        });
    });
}

async function searchTorrents(query) {
    const sanitizedQuery = sanitizeQuery(query);
    
    // Check length after sanitization to avoid errors on queries that are just punctuation
    if (!sanitizedQuery || sanitizedQuery.length < 2) {
        throw new Error('Query too short');
    }

    const resultsDict = new Map();

    // 1. Query torrents-csv.com
    try {
        const url = `https://torrents-csv.com/service/search?q=${encodeURIComponent(sanitizedQuery)}`;
        const data = await fetchUrl(url);
        if (data && Array.isArray(data.torrents)) {
            for (const item of data.torrents) {
                const infoHash = item.infohash.toLowerCase();
                if (!resultsDict.has(infoHash)) {
                    resultsDict.set(infoHash, {
                        title: item.name,
                        magnet: buildMagnet(infoHash),
                        seeders: parseInt(item.seeders || 0, 10),
                        leechers: parseInt(item.leechers || 0, 10),
                        size: parseInt(item.size_bytes || 0, 10),
                        category: '100',
                        uploaded: '',
                    });
                }
            }
        }
    } catch (err) {
        console.error('[Torrent Proxy] torrents-csv.com error:', err.message);
    }

    // 2. Query apibay.org (TPB)
    try {
        const url = `https://apibay.org/q.php?q=${encodeURIComponent(sanitizedQuery)}&cat=100`;
        const data = await fetchUrl(url);
        if (Array.isArray(data)) {
            for (const item of data) {
                if (item.name === 'No results returned') continue;
                const infoHash = item.info_hash.toLowerCase();
                if (!resultsDict.has(infoHash)) {
                    resultsDict.set(infoHash, {
                        title: item.name,
                        magnet: buildMagnet(infoHash),
                        seeders: parseInt(item.seeders || 0, 10),
                        leechers: parseInt(item.leechers || 0, 10),
                        size: parseInt(item.size || 0, 10),
                        category: item.category || '100',
                        uploaded: item.added || '',
                    });
                }
            }
        }
    } catch (err) {
        console.error('[Torrent Proxy] apibay.org error:', err.message);
    }

    // Convert to array, score, and sort
    const results = Array.from(resultsDict.values()).map(item => {
        return {
            ...item,
            score: scoreResult(item.title, sanitizedQuery, item.seeders)
        };
    });

    results.sort((a, b) => b.score - a.score);

    // Limit to top 50 results and remove the score from the final output
    return results.slice(0, 50).map(({ score, ...rest }) => rest);
}

module.exports = { searchTorrents };