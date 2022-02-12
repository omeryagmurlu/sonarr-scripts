import { Sonarr } from "@jc21/sonarr-api";
import { SonarrPlugin } from "../base/SonarrPlugin"
import { Download, Grab, Rename, Test } from "../interfaces/SonarrWebhook";
import { log, trace, warn } from "../log";
import http from 'https';
import { access } from 'fs/promises';
import { createWriteStream, constants } from 'fs';
import path from 'path'

interface BaseSerie {
    path: string,
    title: string,
    tvdbId?: number | string
}

// currently uses plex, but this seems (somewhat) promising too: https://github.com/EOussama/anusic-api
export class ThemeSong extends SonarrPlugin {
    async onGrab(event: Grab, sonarr: Sonarr, url: string) {}
    async onRename(event: Rename, sonarr: Sonarr, url: string) {}
    async onTest(event: Test, sonarr: Sonarr, url: string) {}
    
    identifier = 'theme-songs'

    async onAny(event: Test, sonarr: Sonarr, url: string) {
        log('Downloading all theme songs');
        const shows = await sonarr.shows();
        log(`Got show list from sonarr, total: ${shows.length}`);

        await Promise.all(shows.map(async show => this.downloadShow(show)))
    }

    async onDownload(event: Download) {
        await this.downloadShow(event.series)
    }

    async downloadShow(show: BaseSerie) {
        if (typeof show.tvdbId === 'undefined') {
            return; // we don't know what this is
        }

        const pt = path.join(show.path, 'theme.mp3');
        const addr = `https://tvthemes.plexapp.com/${show.tvdbId}.mp3`;

        if (
            !await (access(show.path, constants.F_OK).then(() => true).catch(() => false))
            || await (access(pt, constants.F_OK).then(() => true).catch(() => false))
        ) {
            return; // theme.mp3 already exists or path doesn't exist
        }
        
        http.get(addr, res => {
            if (res.statusCode! >= 400) {
                warn(`Can't download '${show.title}' theme song from ${addr}`);
                return;
            }
            const file = createWriteStream(pt);
            res.pipe(file);
            trace(`Downloaded ${show.title} theme song`)
        })
    }
}