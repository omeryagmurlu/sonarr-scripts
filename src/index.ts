import 'dotenv/config'
import express from "express";
import { ThemeSong } from './plugins/ThemeSong';
import ash from 'express-async-handler';
import { IBasePlugin } from './base/BasePlugin';
import { NFOThumbRemover } from './plugins/NFOThumbRemover';
import { log, options } from './log';

options({
    level: 10,
    date: true
})

const plugins: IBasePlugin[] = [
    new ThemeSong(),
    new NFOThumbRemover(),
]

const PORT = process.env.PORT ?? 3000;

const app = express();
app.use(express.json());

for (const p of plugins) {
    app[p.method](`/${p.identifier}/:b64Payload`, ash(async (req, res) => {
        const params: Record<string, any> = JSON.parse(Buffer.from(req.params.b64Payload, 'base64').toString());
        
        await p.middleware(params, await req.body);
    
        res.end()
    }))
}

app.listen(PORT)
log('Listening on ' + PORT);

