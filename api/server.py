import requests
from flask import Flask, request, jsonify
from flask_cors import CORS

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Standard browser User-Agent to avoid being blocked by upstream APIs
HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
}

# Trackers to append to magnet links for better peer discovery
TRACKERS = [
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
]

def build_magnet(info_hash):
    magnet = f"magnet:?xt=urn:btih:{info_hash}"
    magnet += '&' + '&'.join([f'tr={t}' for t in TRACKERS])
    return magnet

@app.route('/')
def health():
    return jsonify({'status': 'ok'})

@app.route('/search')
def search():
    q = request.args.get('q', '')
    if len(q) < 2:
        return jsonify({'error': 'Query too short'}), 400
    
    results_dict = {}
    
    # 1. Query torrents-csv.com
    try:
        res_csv = requests.get(
            "https://torrents-csv.com/service/search",
            params={'q': q},
            headers=HEADERS,
            timeout=10
        )
        if res_csv.status_code == 200:
            data = res_csv.json()
            for item in data.get('torrents', []):
                info_hash = item['infohash'].lower()
                if info_hash not in results_dict:
                    results_dict[info_hash] = {
                        'title': item['name'],
                        'magnet': build_magnet(info_hash),
                        'seeders': int(item.get('seeders', 0)),
                        'leechers': int(item.get('leechers', 0)),
                        'size': int(item.get('size_bytes', 0)),
                        'category': '100',
                        'uploaded': '',
                    }
    except Exception as e:
        print(f"[API] torrents-csv.com error: {str(e)}")

    # 2. Query apibay.org (TPB)
    try:
        res_tpb = requests.get(
            "https://apibay.org/q.php",
            params={'q': q, 'cat': '100'},
            headers=HEADERS,
            timeout=10
        )
        if res_tpb.status_code == 200:
            data = res_tpb.json()
            if isinstance(data, list):
                for item in data:
                    if item.get('name') == 'No results returned':
                        continue
                    info_hash = item['info_hash'].lower()
                    if info_hash not in results_dict:
                        results_dict[info_hash] = {
                            'title': item['name'],
                            'magnet': build_magnet(info_hash),
                            'seeders': int(item.get('seeders', 0)),
                            'leechers': int(item.get('leechers', 0)),
                            'size': int(item.get('size', 0)),
                            'category': item.get('category', '100'),
                            'uploaded': item.get('added', ''),
                        }
    except Exception as e:
        print(f"[API] apibay.org error: {str(e)}")

    # Convert dict to list and sort by seeders descending
    results = list(results_dict.values())
    results.sort(key=lambda x: x['seeders'], reverse=True)
    
    # Limit to top 50 results
    results = results[:50]

    return jsonify({
        'query': q,
        'results': results,
        'total': len(results)
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=8080)
