import { Sonarr } from "@jc21/sonarr-api";
import throttle from "lodash.throttle";
import { Download, Grab, Rename, SonarrWebhook, Test } from "./SonarrWebhook";
import { BasePlugin, PluginMethods } from "../BasePlugin";

const BACKOFF =  30 * 60 * 1000; // 30 minutes wait time for every ping

type SonarrPluginParams = {
    url: string,
    apiKey: string,
}

export abstract class SonarrPlugin extends BasePlugin<SonarrPluginParams, SonarrWebhook> {
    abstract onGrab(event: Grab, sonarr: Sonarr, url: string): Promise<void>
    abstract onDownload(event: Download, sonarr: Sonarr, url: string): Promise<void>
    abstract onRename(event: Rename, sonarr: Sonarr, url: string): Promise<void>
    abstract onTest(event: Test, sonarr: Sonarr, url: string): Promise<void>
    abstract onAny(event: SonarrWebhook, sonarr: Sonarr, url: string): Promise<void>
    
    method: PluginMethods = 'post';
    validateParams(params: any) {
        // TODO: validation
        return params as SonarrPluginParams
    }
    validateData(data: any) {
        // TODO: validation
        return data as SonarrWebhook
    }

    private wm: Record<string, (event: SonarrWebhook, sonarr: Sonarr, url: string) => Promise<void>> = {}
    private static ws: Record<string, Sonarr> = {};
    private static getSonarr(url: string, apiKey: string) {
        SonarrPlugin.ws[`${url} !&! ${apiKey}`] = SonarrPlugin.ws[`${url} !&! ${apiKey}`] || new Sonarr(new URL(url), apiKey);
        return new Sonarr(new URL(url), apiKey);
    }

    protected run = async ({ url, apiKey }: SonarrPluginParams, json: SonarrWebhook) => {
        const hookSonarr = SonarrPlugin.getSonarr(url, apiKey);
        this.wm[url] = this.wm[url] || throttle(this.onAny.bind(this), BACKOFF)

        await this.wm[url](json, hookSonarr, url)
        switch (json.eventType) {
            case "Download": return await this.onDownload(json as Download, hookSonarr, url)
            case "Grab": return await this.onGrab(json as Grab, hookSonarr, url)
            case "Rename": return await this.onRename(json as Rename, hookSonarr, url)
            case "Test": return await this.onTest(json as Test, hookSonarr, url)
        }
    }
}