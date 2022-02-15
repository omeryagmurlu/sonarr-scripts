import { ISeries, Sonarr } from "@jc21/sonarr-api";
import { SonarrPlugin } from "../base/sonarr";
import { Grab, Download, Rename, Test, SonarrWebhook } from "../base/sonarr/SonarrWebhook";
import fg from 'fast-glob'; // can't use globby cause it's esm and typescript doesn't like esm yet
import fs from 'fs/promises';

import { XMLBuilder, XMLParser } from "fast-xml-parser";
import { log, trace } from "../log";

const xmlp = new XMLParser({ processEntities: false, allowBooleanAttributes: true, ignoreAttributes: false });
const xmlb = new XMLBuilder({ format: true, processEntities: false, suppressBooleanAttributes: false, ignoreAttributes: false });

export class NFOThumbRemover extends SonarrPlugin {
    constructor(
        identifier = 'nfo-thumb-remover'
    ) { super(identifier) }
    async onGrab(event: Grab, sonarr: Sonarr) {}
    async onRename(event: Rename, sonarr: Sonarr) {}
    async onTest(event: Test, sonarr: Sonarr) {}

    async onDownload(event: Download, sonarr: Sonarr) {
        log(`Processing NFO files in show '${event.series.title}' to remove <thumb>`);

        return this.removeThumb([event.series.path])
    }

    async onAny(event: SonarrWebhook, sonarr: Sonarr) {
        log('Processing all NFO files to remove <thumb>');

        const shows: ISeries[] = await sonarr.shows();
        log(`Got show list from sonarr, ${shows.length} shows`);

        return this.removeThumb(shows.map(x => x.path))
    }
    
    async removeThumb(shows: string[]) {
        const filePaths = (await Promise.all(shows.map((path) => fg(['**.nfo'], { cwd: path, absolute: true })))).flat();
        log(`Found ${filePaths.length} .nfo files across ${shows.length} shows`);
        if (filePaths.length === 0) return;
        
        const toWrite: [string, any][] = (await Promise.all(filePaths.map(async (p): Promise<[string, any] | null> => {
            const xmlInput = await fs.readFile(p, "utf-8");
            const obj = xmlp.parse(xmlInput);

            if (obj?.episodedetails?.thumb) {
                delete obj.episodedetails.thumb;
                return [p, obj]
            } else {
                return null;
            }
        }))).filter(<T>(x: T | null): x is T => !!x);
        log(`${toWrite.length} .nfo files contain <thumb>`);
        if (toWrite.length === 0) return;

        const updated = (await Promise.all(toWrite.map(([p, obj]) => {
            trace(`Removing <thumb> from ${p}`)
            const xmlOutput = xmlb.build(obj);
            fs.writeFile(p, xmlOutput);
        }))).length;
        log(`Removed <thumb> from ${updated} .nfo files`);
    }
}