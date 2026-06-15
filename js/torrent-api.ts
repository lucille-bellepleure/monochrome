/**
 * Torrent API for Monochrome
 * Handles WebTorrent integration for desktop (Electron) and provides fallbacks for web/mobile.
 */

export interface TorrentFile {
    name: string;
    length: number;
    path: string;
}

export interface TorrentInfo {
    infoHash: string;
    name: string;
    files: TorrentFile[];
}

export class TorrentAPI {
    private isElectron: boolean;

    constructor() {
        // Check if running in Electron environment
        this.isElectron = typeof window !== 'undefined' && !!(window as any).electronAPI;
    }

    /**
     * Add a torrent via magnet URI
     * @param magnetURI The magnet URI to add
     * @returns Promise resolving to torrent info
     */ 
    async addTorrent(magnetURI: string): Promise<TorrentInfo | null> {
        console.log('[TorrentAPI] 🧲 addTorrent called with magnetURI:', magnetURI);
        if (this.isElectron) {
            try {
                console.log('[TorrentAPI] ⏳ Awaiting electronAPI.addTorrent IPC call...');
                const result = await (window as any).electronAPI.addTorrent(magnetURI);
                console.log('[TorrentAPI] ✅ electronAPI.addTorrent resolved successfully:', result);
                return result;
            } catch (error) {
                console.error('[TorrentAPI] ❌ Failed to add torrent in Electron:', error);
                return null;
            }
        } else {
            console.warn('[TorrentAPI] WebTorrent is not fully supported in browser/mobile environments without native plugins.');
            return null;
        }
    }

    /**
     * Select a specific file from a torrent for streaming
     * @param infoHash The info hash of the torrent
     * @param filePath The path of the file to select
     * @returns Promise resolving to a streamable URL (blob URL or local server URL)
     */
    async selectFileForStreaming(infoHash: string, filePath: string): Promise<string | null> {
        console.log(`[TorrentAPI] selectFileForStreaming called for infoHash: ${infoHash}, filePath: ${filePath}`);
        if (this.isElectron) {
            try {
                const url = await (window as any).electronAPI.selectFile(infoHash, filePath);
                console.log(`[TorrentAPI] selectFileForStreaming successful, URL: ${url}`);
                return url;
            } catch (error) {
                console.error('[TorrentAPI] Failed to select file for streaming:', error);
                return null;
            }
        } else {
            console.warn('[TorrentAPI] File selection for streaming is only supported in Electron.');
            return null;
        }
    }

    /**
     * Get the download progress of a torrent
     * @param infoHash The info hash of the torrent
     * @returns Promise resolving to progress (0.0 to 1.0)
     */
    async getProgress(infoHash: string): Promise<number> {
        if (this.isElectron) {
            try {
                const progress = await (window as any).electronAPI.getProgress(infoHash);
                // console.log(`[TorrentAPI] getProgress for ${infoHash}: ${(progress * 100).toFixed(2)}%`);
                return progress;
            } catch (error) {
                console.error('[TorrentAPI] Failed to get torrent progress:', error);
                return 0;
            }
        }
        return 0;
    }

    /**
     * Destroy a torrent and clean up resources
     * @param infoHash The info hash of the torrent to destroy
     */
    async destroyTorrent(infoHash: string): Promise<void> {
        console.log(`[TorrentAPI] destroyTorrent called for infoHash: ${infoHash}`);
        if (this.isElectron) {
            try {
                await (window as any).electronAPI.destroyTorrent(infoHash);
                console.log(`[TorrentAPI] destroyTorrent successful for ${infoHash}`);
            } catch (error) {
                console.error('[TorrentAPI] Failed to destroy torrent:', error);
            }
        }
    }

    /**
     * Get real-time stats for a torrent
     * @param infoHash The info hash of the torrent
     * @returns Promise resolving to stats object (progress, downloadSpeed, numPeers, downloaded)
     */
    async getStats(infoHash: string): Promise<any | null> {
        if (this.isElectron) {
            try {
                const stats = await (window as any).electronAPI.getTorrentStats(infoHash);
                return stats;
            } catch (error) {
                console.error('[TorrentAPI] Failed to get torrent stats:', error);
                return null;
            }
        }
        return null;
    }

    /**
     * Search The Pirate Bay for a query
     * @param query The search query
     * @param category Optional category filter (e.g., 'audio')
     * @returns Promise resolving to search results
     */
     async searchTPB(query: string, category: string = 'audio'): Promise<any[]> {
         console.log(`[TorrentAPI] 🔍 searchTPB called with query: "${query}", category: "${category}"`);
         if (this.isElectron) {
             try {
                 const results = await (window as any).electronAPI.searchTorrents(query);
                 // Normalize to match expected format (name, info_hash, seeders)
                 const normalizedResults = results.map((item: any) => {
                     const infoHashMatch = item.magnet ? item.magnet.match(/btih:([a-zA-Z0-9]+)/i) : null;
                     const infoHash = infoHashMatch ? infoHashMatch[1] : '';
                     return {
                         ...item,
                         name: item.title || item.name,
                         info_hash: infoHash,
                         seeders: item.seeders || 0
                     };
                 });
                 console.log(`[TorrentAPI] ✅ searchTPB returning ${normalizedResults.length} results via Electron`);
                 if (normalizedResults.length > 0) {
                     console.log(`[TorrentAPI] 🏆 Top result:`, normalizedResults[0]);
                 }
                 return normalizedResults;
             } catch (error) {
                 console.error('[TorrentAPI] ❌ Failed to search torrents via Electron:', error);
                 return [];
             }
         } else {
             console.warn('[TorrentAPI] Torrent search is only supported in Electron.');
             return [];
         }
     }

    /**
     * Get TPB category code
     */
    private getTPBCategoryCode(category: string): string {
        const categories: Record<string, string> = {
            'audio': '100', // Audio (all)
            'music': '101', // Music
            'video': '200', // Video (all)
            'movies': '201', // Movies
        };
        return categories[category] || '100';
    }

    /**
     * Check if the current environment supports full torrenting
     */
    isSupported(): boolean {
        return this.isElectron;
    }
}

// Export a singleton instance
export const torrentAPI = new TorrentAPI();