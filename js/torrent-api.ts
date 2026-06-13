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
        if (this.isElectron) {
            try {
                return await (window as any).electronAPI.addTorrent(magnetURI);
            } catch (error) {
                console.error('Failed to add torrent in Electron:', error);
                return null;
            }
        } else {
            console.warn('WebTorrent is not fully supported in browser/mobile environments without native plugins.');
            // Fallback: In a real implementation, you might use webtorrent in the browser
            // but it's limited to WebRTC peers only.
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
        if (this.isElectron) {
            try {
                return await (window as any).electronAPI.selectFile(infoHash, filePath);
            } catch (error) {
                console.error('Failed to select file for streaming:', error);
                return null;
            }
        } else {
            console.warn('File selection for streaming is only supported in Electron.');
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
                return await (window as any).electronAPI.getProgress(infoHash);
            } catch (error) {
                console.error('Failed to get torrent progress:', error);
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
        if (this.isElectron) {
            try {
                await (window as any).electronAPI.destroyTorrent(infoHash);
            } catch (error) {
                console.error('Failed to destroy torrent:', error);
            }
        }
    }

    /**
     * Search The Pirate Bay for a query
     * @param query The search query
     * @param category Optional category filter (e.g., 'audio')
     * @returns Promise resolving to search results
     */
    async searchTPB(query: string, category: string = 'audio'): Promise<any[]> {
        try {
            // Using a public TPB proxy API
            // Note: In production, you should use your own proxy or a reliable public one
            const url = `https://apibay.org/q.php?q=${encodeURIComponent(query)}&cat=${this.getTPBCategoryCode(category)}`;
            const response = await fetch(url);
            if (!response.ok) {
                throw new Error(`TPB API error: ${response.status}`);
            }
            const data = await response.json();
            return data.filter((item: any) => item.info_hash !== '0000000000000000000000000000000000000000');
        } catch (error) {
            console.error('Failed to search TPB:', error);
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