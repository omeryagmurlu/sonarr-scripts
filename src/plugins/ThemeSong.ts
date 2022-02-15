import { ISeries, Sonarr } from "@jc21/sonarr-api";
import { SonarrPlugin } from "../base/sonarr"
import { Download, Grab, Rename, Test } from "../base/sonarr/SonarrWebhook";
import { error, log, trace, warn } from "../log";
import { mkdir } from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path'
import fetch, { Response } from 'node-fetch';
import { Filebacked } from "../persistence";
import { cachedFetch } from "../utils";
import { XMLParser } from "fast-xml-parser";
import { pRateLimit } from "../vendor/pRateLimiter";

interface BaseSerie {
    path: string,
    title: string,
    tvdbId?: number | string
}

interface ScudleeAnimeListEntry {
    '@_anidbid': string,
    '@_tvdbid': string,
}

interface Relations {
    anidb: number,
    myanimelist: number,
}

interface ThemesMoeEntry {
    malID: number
    themes: Theme[]
}

interface Theme {
    themeName: string,
    themeType: string,
    mirror: { mirrorURL: string }
}

type Persistence = Record<string, boolean>;

interface Resource {
    filename: string,
    dir?: string,
    readable: NodeJS.ReadableStream
}

const xmlp = new XMLParser({ processEntities: false, allowBooleanAttributes: true, ignoreAttributes: false });
const cxmlFetch = cachedFetch<Promise<any>>(undefined, async (resp: Response) => xmlp.parse(await resp.text()));
const cjFetch = cachedFetch<Promise<any>>(undefined, async (resp: Response) => await resp.json());

const themesMoeLimit = pRateLimit({
    interval: 60,
    rate: 50,
    concurrency: 10
})
const animethemesMoeLimit = pRateLimit({
    interval: 60,
    rate: 20,
    concurrency: 2
})
const themesMoeDigitalOceanLimit = pRateLimit({
    interval: 60,
    rate: 60,
    concurrency: 10
})
const relationsLimit = pRateLimit({
    interval: 30,
    rate: 60,
    concurrency: 10
})
const writeLimit = pRateLimit({
    concurrency: 10
})

class ThemeSongError extends Error {}

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

        await Promise.all([shows[50], shows[52], shows[54]].map(async show => this.downloadShow(show, await p.get()).catch(e => error(e.message))))
        // await Promise.all(shows.map(async show => this.downloadShow(show, await p.get()).catch(e => error(e.message))))
    }

    async onDownload(event: Download, _: any, p: Filebacked<Persistence>) {
        log(`Downloading ${event.series.title} songs`);
        await this.downloadShow(event.series, await p.get())
    }

    async downloadShow(show: BaseSerie, persistence: Persistence) {
        if (typeof show.tvdbId === 'undefined') {
            return; // we don't know what this is
        }

        if (persistence[show.tvdbId]) {
            return;
        }

        const animedownCount = await this.downloadResources(this.fromAnimethemes(show), show.path)
        if (animedownCount !== 0) {
            trace(`Downloaded ${animedownCount} theme song(s) for ${show.title} from r/AnimeThemes`)
            persistence[show.tvdbId] = true
            return;
        }

        const plexCount = await this.downloadResources(this.fromPlex(show), show.path)
        if (plexCount !== 0) {
            trace(`Downloaded ${plexCount} theme song(s) for ${show.title} from r/AnimeThemes`)
            persistence[show.tvdbId] = true
            return;
        }

        error(`Can't find theme songs for '${show.title}'`);
    }

    async downloadResources(pres: Promise<Resource[]>, showPath: string) {
        const res = await pres.catch(e => {
            warn(e.message)
            return []
        })
        return (await Promise.all(res.map(res => this.write(showPath, res)))).length
    }

    async fromAnimethemes(show: BaseSerie): Promise<Resource[]> {
        const isAnime = show.path.includes('anime') // IMPORTANT: .seriesType doesn't exist with webhook, user may need to configure this
        
        if (!isAnime) return []

        const animelistsURL = "https://raw.githubusercontent.com/Anime-Lists/anime-lists/master/anime-list.xml";
        const aList = (await cxmlFetch(animelistsURL))['anime-list'].anime as ScudleeAnimeListEntry[];

        const scudlee: ScudleeAnimeListEntry | undefined = aList.find(x => x['@_tvdbid'] === String(show.tvdbId))
        if (!scudlee) {
            throw new ThemeSongError(`Can't convert '${show.title}' tvdb:${show.tvdbId} -> anidb ${animelistsURL}`)
        }
        const anidb = scudlee["@_anidbid"]

        const relationsURL = `https://relations.yuna.moe/api/ids?source=anidb&id=${anidb}`;
        const mal = (await relationsLimit(() => cjFetch(relationsURL)) as Relations).myanimelist;
        if (!mal) {
            throw new ThemeSongError(`Can't convert '${show.title}' anidb:${anidb} -> myanimelist ${relationsURL}`)
        }

        const themesMoeURL = `https://themes.moe/api/themes/${mal}`
        const themesMoe = (await (themesMoeLimit(() => fetch(themesMoeURL)).then(r => r.json()))) as ThemesMoeEntry[]
        if(!themesMoe || themesMoe.length !== 1) {
            throw new ThemeSongError(`Can't get '${show.title}' themes from themesMoe: ${themesMoeURL} : themesMoe.length: ${themesMoe.length}`)
        }
        const themes = await Promise.all(themesMoe[0].themes.map(async ({ mirror, ...theme }) => {
            const ur = `https://themes.moe/api/themes/${themesMoe[0].malID}/${theme.themeType}/audio`
            const link = await (themesMoeLimit(() => fetch(ur, { method: 'post' })).then(r => r.text()));
            return {
                ...theme,
                audioLink: link,
                videoLink: mirror.mirrorURL
            }
        }));

        return await Promise.all([
            ...themes.map(async ({ themeType, themeName, audioLink }) => ({
                filename: `${themeType} - ${themeName}.mp3`,
                dir: 'theme-music',
                readable: await (themesMoeDigitalOceanLimit(() => fetch(audioLink)).then(r => r.body))
            })),
            ...themes.map(async ({ themeType, themeName, videoLink }) => ({
                filename: `${themeType} - ${themeName}.webm`,
                dir: 'backdrops',
                readable: await (animethemesMoeLimit(() => fetch(videoLink)).then(r => r.body))
            }))
        ])
    }

    async write(showPath: string, { dir, filename, readable }: Resource): Promise<void> {
        let pt: string;
        if (dir) {
            await mkdir(path.join(showPath, dir), { recursive: true })
            pt = path.join(showPath, dir, filename)
        } else {
            pt = path.join(showPath, filename)
        }
        
        return writeLimit(() => new Promise((res, rej) => {
            trace(`Writing ${pt}`)
            const file = createWriteStream(pt);
            readable.pipe(file)
            file.on('finish', () => res());
            file.on('error', (e) => {
                error(e)
                rej(e)
            });
        }))
    }

    async fromPlex(show: BaseSerie): Promise<Resource[]> {
        const addr = `https://tvthemes.plexapp.com/${show.tvdbId}.mp3`;

        const resp = await fetch(addr);
        if (resp.status >= 400) {
            throw new ThemeSongError(`Can't download '${show.title}' theme song from ${addr}`);
        }

        return [{
            filename: 'theme.mp3',
            readable: resp.body
        }];
    }
}