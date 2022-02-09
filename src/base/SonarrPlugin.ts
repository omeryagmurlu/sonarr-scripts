import { Sonarr } from "@jc21/sonarr-api";
import { Download, Grab, Rename, SonarrWebhook, Test } from "../interfaces/SonarrWebhook";

export abstract class SonarrPlugin {
    private _sonarr?: Sonarr;
    constructor(obj: { url: string, apiKey: string } | null = null) {
        if (!obj) return;
        const { url, apiKey } = obj;
        this._sonarr = SonarrPlugin.getSonarr(url, apiKey);
    }

    get sonarr() {
        if (!this._sonarr) throw new Error('no sonarr instance available')
        return this._sonarr;
    }

    static getSonarr(url: string, apiKey: string) {
        return new Sonarr(new URL(url), apiKey);
    }

    public identifier: string = '__id__';

    async onGrab(event: Grab, sonarr: Sonarr, url: string) {}
    async onDownload(event: Download, sonarr: Sonarr, url: string) {}
    async onRename(event: Rename, sonarr: Sonarr, url: string) {}
    async onTest(event: Test, sonarr: Sonarr, url: string) {}
    async onAny(event: SonarrWebhook, sonarr: Sonarr, url: string) {}

    init() {}
    scheduled() {}
}