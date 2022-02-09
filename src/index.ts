import 'dotenv/config'
import express from "express";
import { SonarrPlugin } from "./base/SonarrPlugin";
import { Download, Grab, Rename, SonarrWebhook, Test } from './interfaces/SonarrWebhook';
import { ThemeSong } from './plugins/ThemeSong';
import ash from 'express-async-handler';

const PLUGIN_LIST = [
    ThemeSong
]

const BASE_URL = process.env.BASE_URL;
const API_KEY = process.env.API_KEY;
const PORT = process.env.PORT ?? 3000;

const plugins: SonarrPlugin[] = PLUGIN_LIST.map(X => new X(
    (BASE_URL && API_KEY) ? { url: BASE_URL, apiKey: API_KEY } : null
));

const runPlugins = (plugins: SonarrPlugin[], url: string, apiKey: string, json: SonarrWebhook) => Promise.all(plugins.map(async p => {
    const hookSonarr = SonarrPlugin.getSonarr(url, apiKey);

    await p.onAny(json, hookSonarr, url)
    switch (json.eventType) {
        case "Download": return await p.onDownload(json as Download, hookSonarr, url)
        case "Grab": return await p.onGrab(json as Grab, hookSonarr, url)
        case "Rename": return await p.onRename(json as Rename, hookSonarr, url)
        case "Test": return await p.onTest(json as Test, hookSonarr, url)
    }
}))

const app = express();
app.use(express.json());
// app.use(ash(async () => {}))

interface B64Payload {
    apiKey: string,
    url: string
}
app.post('/sonarr/:b64Payload', ash(async (req, res) => {
    const { apiKey, url } = JSON.parse(Buffer.from(req.params.b64Payload, 'base64').toString()) as B64Payload;
    
    await runPlugins(plugins, url, apiKey, await req.body as SonarrWebhook);

    res.json(plugins.length)
}))

for (const p of plugins) {
    if (BASE_URL && API_KEY) {
        p.init()
        setInterval(() => p.scheduled(), 3000);
    }

    app.post(`/${p.identifier}/:b64Payload`, ash(async (req, res) => {
        const { apiKey, url } = JSON.parse(Buffer.from(req.params.b64Payload, 'base64').toString()) as B64Payload;
        
        await runPlugins([p], url, apiKey, await req.body as SonarrWebhook);
    
        res.json(1)
    }))
}

app.listen(PORT)
console.log('Listening on ' + PORT);

