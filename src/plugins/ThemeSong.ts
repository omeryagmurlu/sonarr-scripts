import { ISeries, Sonarr } from "@jc21/sonarr-api";
import throttle from "lodash.throttle";
import { SonarrPlugin } from "../base/SonarrPlugin"
import { Download, Test } from "../interfaces/SonarrWebhook";
import { log } from "../log";
import http from 'https';
import { access } from 'fs/promises';
import { createWriteStream, constants } from 'fs';
import path from 'path'

const BACKOFF =  30 * 60 * 1000; // 30 minutes wait time for every ping

interface BaseSerie {
    path: string,
    title: string,
    tvdbId?: number | string
}

// currently uses plex, but this seems (somewhat) promising too: https://github.com/EOussama/anusic-api
export class ThemeSong extends SonarrPlugin {
    public identifier = 'theme-songs'
    private wm: Record<string, () => Promise<void>> = {}

    async onAny(event: Test, sonarr: Sonarr, url: string) {
        this.wm[url] = this.wm[url] || throttle(async () => {
            log('Downloading all theme songs');
            const shows = await sonarr.shows();
            log('Got show list from sonarr');

            await Promise.all(shows.map(async show => this.downloadShow(show)))
        }, BACKOFF);
        return this.wm[url]();
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
                log(`Can't download '${show.title}' theme song from ${addr}`);
                return;
            }
            const file = createWriteStream(pt);
            res.pipe(file);
            log(`Downloaded ${show.title} theme song`)
        })
    }
}