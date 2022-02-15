import { Sonarr } from "@jc21/sonarr-api";
import throttle from "lodash.throttle";
import { Download, Grab, Rename, SonarrWebhook, Test } from "./SonarrWebhook";
import { BasePlugin, PluginMethods } from "../BasePlugin";
import { Filebacked } from "../../persistence";

const BACKOFF =  30 * 60 * 1000; // 30 minutes wait time for every ping

type SonarrPluginParams = {
    url: string,
    apiKey: string,
}

export abstract class SonarrPlugin<Persistence = void> extends BasePlugin<SonarrPluginParams, SonarrWebhook, Persistence> {
    abstract onGrab(event: Grab, sonarr: Sonarr, persistence: Filebacked<Persistence>): Promise<void>
    abstract onDownload(event: Download, sonarr: Sonarr, persistence: Filebacked<Persistence>): Promise<void>
    abstract onRename(event: Rename, sonarr: Sonarr, persistence: Filebacked<Persistence>): Promise<void>
    abstract onTest(event: Test, sonarr: Sonarr, persistence: Filebacked<Persistence>): Promise<void>
    abstract onAny(event: SonarrWebhook, sonarr: Sonarr, persistence: Filebacked<Persistence>): Promise<void>
    
    method: PluginMethods = 'post';
    validateParams(params: any) {
        // TODO: validation
        return params as SonarrPluginParams
    }
    validateData(data: any) {
        // TODO: validation
        return data as SonarrWebhook
    }

    private wm: Record<string, (event: SonarrWebhook, sonarr: Sonarr, persistence: Filebacked<Persistence>) => Promise<void>> = {}
    private static ws: Record<string, Sonarr> = {};
    private static getSonarr(url: string, apiKey: string) {
        SonarrPlugin.ws[`${url} !&! ${apiKey}`] = SonarrPlugin.ws[`${url} !&! ${apiKey}`] || new Sonarr(new URL(url), apiKey);
        return new Sonarr(new URL(url), apiKey);
    }

    protected run = async ({ url, apiKey }: SonarrPluginParams, json: SonarrWebhook, persistence: Filebacked<Persistence>) => {
        const hookSonarr = SonarrPlugin.getSonarr(url, apiKey);
        this.wm[url] = this.wm[url] || throttle(this.onAny.bind(this), BACKOFF)

        await this.wm[url](json, hookSonarr, persistence)
        switch (json.eventType) {
            case "Download": return await this.onDownload(json as Download, hookSonarr, persistence)
            case "Grab": return await this.onGrab(json as Grab, hookSonarr, persistence)
            case "Rename": return await this.onRename(json as Rename, hookSonarr, persistence)
            case "Test": return await this.onTest(json as Test, hookSonarr, persistence)
        }
    }
}