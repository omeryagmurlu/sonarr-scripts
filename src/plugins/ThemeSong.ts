import { ISeries, Sonarr } from "@jc21/sonarr-api";
import { SonarrPlugin } from "../base/sonarr"
import { Download, Grab, Rename, Test } from "../base/sonarr/SonarrWebhook";
import { log, trace, warn } from "../log";
import { access, mkdir } from 'fs/promises';
import { createWriteStream, constants } from 'fs';
import path from 'path'
import fetch from 'node-fetch';
import { Filebacked } from "../persistence";

interface BaseSerie {
    path: string,
    title: string,
    tvdbId?: number | string
}

class LocalError extends Error {}

type Persistence = Record<string, boolean>;

interface Resource {
    filename: string,
    dir?: string,
    readable: NodeJS.ReadableStream
}

// currently uses plex, but this seems (somewhat) promising too: https://github.com/EOussama/anusic-api
export class ThemeSong extends SonarrPlugin<Persistence> {
    constructor(
        identifier = 'theme-songs'
    ) { super(identifier) }
    async onGrab(event: Grab, sonarr: Sonarr, p: Filebacked<Persistence>) {}
    async onRename(event: Rename, sonarr: Sonarr, p: Filebacked<Persistence>) {}
    async onTest(event: Test, sonarr: Sonarr, p: Filebacked<Persistence>) {}

    async onAny(event: Test, sonarr: Sonarr, p: Filebacked<Persistence>) {
        log('Downloading all theme songs');
        const shows = await sonarr.shows();
        log(`Got show list from sonarr, total: ${shows.length}`);

        await Promise.all(shows.map(async show => this.downloadShow(show, await p.get()).catch(e => warn(e.message))))
    }

    async onDownload(event: Download, _: any, p: Filebacked<Persistence>) {
        log(`Downloading ${event.series.title} songs`);
        await this.downloadShow(event.series, await p.get())
    }

    async downloadShow(show: BaseSerie, persistence: Persistence) {
        if (typeof show.tvdbId === 'undefined') {
            return; // we don't know what this is
        }

        const showPath = show.path;

        if (persistence[show.tvdbId]) {
            return;
        }

        const plex = await this.fromPlex(show);
        if (await this.write(showPath, plex[0])) {
            persistence[show.tvdbId] = true
            trace(`Downloaded ${show.title} theme song from plex`)
        }
    }

    async write(showPath: string, { dir, filename, readable }: Resource): Promise<boolean> {
        let pt: string;
        if (dir) {
            await mkdir(path.join(showPath, dir), { recursive: true })
            pt = path.join(showPath, dir, filename)
        } else {
            pt = path.join(showPath, filename)
        }

        const file = createWriteStream(pt);
        readable.pipe(file)
        return new Promise((res, rej) => {
            file.on('finish', () => res(true));
            file.on('error', (e) => {
                console.log(e)
                res(false)
            });
        })
    }

    async fromPlex(show: BaseSerie): Promise<Resource[]> {
        const addr = `https://tvthemes.plexapp.com/${show.tvdbId}.mp3`;

        const resp = await fetch(addr);
        if (resp.status >= 400) {
            throw new LocalError(`Can't download '${show.title}' theme song from ${addr}`);
        }

        return [{
            filename: 'theme.mp3',
            readable: resp.body
        }];
    }
}