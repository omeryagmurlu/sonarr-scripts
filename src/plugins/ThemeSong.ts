import { ISeries, Sonarr } from "@jc21/sonarr-api";
import { SonarrPlugin } from "../base/sonarr"
import { Download, Grab, Rename, Test } from "../base/sonarr/SonarrWebhook";
import { error, log, trace, warn } from "../log";
import { mkdir, unlink } from 'fs/promises';
import { createWriteStream } from 'fs';
import path from 'path'
import fetch, { Response } from 'node-fetch';
import { Filebacked } from "../persistence";
import { aFetch, cachedFetch, checkFileExists, cleanFileName } from "../utils";
import { XMLParser } from "fast-xml-parser";
import { pRateLimit } from "../vendor/pRateLimiter";
import { pipeline } from 'stream/promises'

const DOWNLOAD_BACKDROP = String(process.env.PLUGIN_THEME_SONGS_DOWNLOAD_BACKDROP ?? false).toLowerCase() === "true";
const SKIP_EXISTING_FILES = String(process.env.PLUGIN_THEME_SONGS_SKIP_EXISTING_FILES ?? true).toLowerCase() === "true";
const DRY_RUN = String(process.env.PLUGIN_THEME_SONGS_DRY_RUN ?? false).toLowerCase() === "true";;

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
    name: string
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
    downloader: () => Promise<NodeJS.ReadableStream>
}

const xmlp = new XMLParser({ processEntities: false, allowBooleanAttributes: true, ignoreAttributes: false });
const timeFetch = aFetch(30 * 1000);

class ThemeSongError extends Error {}

export class ThemeSong extends SonarrPlugin<Persistence> {
    private cxmlFetch = cachedFetch<Promise<any>>(undefined, async (resp: Response) => xmlp.parse(await resp.text()));
    private cjFetch = cachedFetch<Promise<any>>(undefined, async (resp: Response) => await resp.json());

    private themesMoeLimit = pRateLimit({
        interval: 30 * 1000,
        rate: 7,
        concurrency: 2
    })
    private relationsLimit = pRateLimit({
        interval: 30 * 1000,
        rate: 5,
        concurrency: 2
    })
    private animethemesMoeLimit = pRateLimit({
        interval: 60 * 1000,
        rate: 5,
        concurrency: 1,
    })
    private themesMoeDigitalOceanLimit = pRateLimit({
        interval: 60 * 1000,
        rate: 15,
        concurrency: 5,
    })
    private fetchQueue = pRateLimit({ interval: 5 * 1000, rate: 1 })

    private downloadPressure = 0;
    private active: Record<string, true | undefined> = {}
    
    constructor(
        identifier = 'theme-songs'
    ) { super(identifier) }
    async onGrab(event: Grab, sonarr: Sonarr, p: Filebacked<Persistence>) {}
    async onRename(event: Rename, sonarr: Sonarr, p: Filebacked<Persistence>) {}
    async onTest(event: Test, sonarr: Sonarr, p: Filebacked<Persistence>) {}
    
    async onDownload(event: Download, _: any, p: Filebacked<Persistence>) {
        log(`Downloading ${event.series.title} songs`);
        await this.queue(event.series, async () => this.handleShow(event.series, await p.get()))
    }
    
    async onAny(event: Test, sonarr: Sonarr, p: Filebacked<Persistence>) {
        log('Downloading all theme songs');
        const shows = await sonarr.shows();
        log(`Got show list from sonarr, total: ${shows.length}`);

        const handled = (await Promise.all(shows.map(async show => 
            this.queue(show, async () => this.handleShow(show, await p.get()))
        ))).filter(x => x)

        log(`Done downloading media for ${handled.length} shows`)
        // await Promise.all(shows.map(async show => this.handleShow(show, await p.get()).catch(e => warn(e.message))))
    }

    async queue(show: BaseSerie, fn: () => Promise<void>) {
        if (this.active[show.title]) {
            return false;
        }
        this.active[show.title] = true;
        await fn();
        this.active[show.title] = undefined;
        return true;
    }

    async handleShow(show: BaseSerie, persistence: Persistence) {
        if (typeof show.tvdbId === 'undefined') {
            return; // we don't know what this is
        }

        if (persistence[show.tvdbId]) {
            return;
        }

        const handlers: [() => Promise<Resource[]>, string, boolean][] = [
            [() => this.fromAnimethemes(show), 'r/AnimeThemes', true],
            [() => this.fromPlex(show), 'Plex', false],
        ]

        for (const [handler, name, shouldPersist] of handlers) {
            try {
                const [succ, fail, total] = await this.downloadResources(await this.fetchQueue(handler), show.path)
                if (total !== 0) {
                    log(`Finished downloading for ${show.title} from ${name}: ${succ}/${fail}/${total}`)
                    if (fail !== 0) {
                        warn(`There were ${fail} errors, ${succ} succesful`)
                    } else if (!shouldPersist) {
                        trace(`${name} doesn't allow persistance.`)
                    } else if (DRY_RUN) {
                        trace('DRY_RUN: persisted ' + show.tvdbId)
                    } else {
                        persistence[show.tvdbId] = true
                    }
                    return;
                }
            } catch (e) {
                error(e)
            }
        }

        warn(`Can't find theme songs for '${show.title}'`);
    }

    async downloadResources(pres: Resource[], showPath: string) {
        const res = await Promise.all(pres.map(async res => {
            try {
                this.downloadPressure++
                const [pt, code] = await this.download(showPath, res);
                trace(`Downloaded${code === 1 ? ' (skipped existing file)' : ''} (pressure ${this.downloadPressure - 1}) ${pt}`)
                return true;
            } catch (e: any) {
                warn(e.message ? e.message : e)
                return false;
            } finally {
                --this.downloadPressure;
            }
        }))

        return [res.filter(x => x).length, res.filter(x => !x).length, pres.length] // succ/fail/total
    }

    async download(showPath: string, { dir, filename, downloader }: Resource): Promise<[string, number]> {
        if (DRY_RUN) {
            trace("DRY_RUN: Downloaded: '" + cleanFileName(filename) + "' to " + dir)
            return ['--DRY_RUN can\'t check path--', 0]
        }

        let pt: string;
        if (dir) {
            await mkdir(path.join(showPath, dir), { recursive: true })
            pt = path.join(showPath, dir, cleanFileName(filename))
        } else {
            pt = path.join(showPath, cleanFileName(filename))
        }

        if (SKIP_EXISTING_FILES && await checkFileExists(pt)) {
            return [pt, 1];
        }

        try {
            await pipeline([
                await downloader(),
                createWriteStream(pt)
            ])
            return [pt, 0];
        } catch (e) {
            try {
                await unlink(pt);
            } catch (ee) {}
            throw e;
        }
    }

    async fromAnimethemes(show: BaseSerie): Promise<Resource[]> {
        const isAnime = show.path.includes('anime') // IMPORTANT: .seriesType doesn't exist with webhook, user may need to configure this
        
        if (!isAnime) return []

        const animelistsURL = "https://raw.githubusercontent.com/Anime-Lists/anime-lists/master/anime-list.xml";
        const aList = (await this.cxmlFetch(animelistsURL))['anime-list'].anime as ScudleeAnimeListEntry[];

        const scudlees: ScudleeAnimeListEntry[] = aList.filter(x => x['@_tvdbid'] === String(show.tvdbId))
        if (scudlees.length === 0) {
            throw new ThemeSongError(`Can't convert '${show.title}' tvdb:${show.tvdbId} -> anidb ${animelistsURL}`)
        }

        let errors = 0;
        const results = await Promise.all(scudlees.map(async scudlee => {
            const anidb = scudlee["@_anidbid"]
            return this.fetchWithAnidb(anidb, show.title).catch(e => {
                warn(e)
                errors++;
                return []
            })
        }))
        
        if (errors >= scudlees.length) { // every anidb branch has resulted in an error, overall error
            throw new ThemeSongError(`No "'${show.title}' tvdb:${show.tvdbId} -> anidb ${animelistsURL}" conversion was able to fetch theme songs`)
        }

        trace(`Fetched from r/AnimeThemes: ${show.title}`)
        return results.flat()
    }

    async fetchWithAnidb(anidb: string, mainTitle: string) {
        const relationsURL = `https://relations.yuna.moe/api/ids?source=anidb&id=${anidb}`;
        const mal = (await this.relationsLimit(() => this.cjFetch(relationsURL)) as Relations)?.myanimelist;
        if (!mal) {
            throw new ThemeSongError(`Can't convert '${mainTitle}' anidb:${anidb} -> myanimelist ${relationsURL}`)
        }

        const themesMoeURL = `https://themes.moe/api/themes/${mal}`
        const themesMoe = (await (this.themesMoeLimit(() => fetch(themesMoeURL)).then(r => r.json())))[0] as ThemesMoeEntry
        if(!themesMoe) {
            throw new ThemeSongError(`Can't get '${mainTitle}'(anidb:${anidb}) themes from themesMoe: ${themesMoeURL}`)
        }

        const themes = await Promise.all(themesMoe.themes.map(async ({ mirror, ...theme }) => {
            const ur = `https://themes.moe/api/themes/${themesMoe.malID}/${theme.themeType}/audio`
            const link = await (this.themesMoeLimit(() => fetch(ur, { method: 'post' })).then(r => r.text()));
            return {
                ...theme,
                audioLink: link,
                videoLink: mirror.mirrorURL
            }
        }));

        trace(`Fetched with Anidb: ${anidb} (main: ${mainTitle})`)
        return [
            ...themes.map(({ themeType, themeName, audioLink }) => ({
                filename: `${themesMoe.name}: ${themeType} - ${themeName}.mp3`,
                dir: 'theme-music',
                downloader: async () => {
                    const resp = await this.themesMoeDigitalOceanLimit(() => timeFetch(audioLink));
                    if (resp.status >= 400) {
                        throw new ThemeSongError(`Can't download '${mainTitle}' (anidb:${anidb}) theme song '${themeType} - ${themeName}.mp3' from ${audioLink}`);
                    }
                    return resp.body
                }
            })),
            ...(DOWNLOAD_BACKDROP ? themes.map(({ themeType, themeName, videoLink }) => ({
                filename: `${themesMoe.name}: ${themeType} - ${themeName}.webm`,
                dir: 'backdrops',
                downloader: async () => {
                    const resp = await this.animethemesMoeLimit(() => timeFetch(videoLink));
                    if (resp.status >= 400) {
                        throw new ThemeSongError(`Can't download '${mainTitle}' (anidb:${anidb}) backdrop '${themeType} - ${themeName}.webm' from ${videoLink}`);
                    }
                    return resp.body
                }
            })) : [])
        ]
    }

    async fromPlex(show: BaseSerie): Promise<Resource[]> {
        // const isAnime = show.path.includes('anime') // for now skip animes
        
        // if (isAnime) return []
        
        const addr = `https://tvthemes.plexapp.com/${show.tvdbId}.mp3`;

        trace(`Fetched from Plex: ${show.title}`)
        return [{
            filename: 'theme.mp3',
            downloader: async () => {
                const resp = await fetch(addr);
                if (resp.status >= 400) {
                    throw new ThemeSongError(`Can't download '${show.title}' theme song from ${addr}`);
                }
                return resp.body
            }
        }];
    }
}
