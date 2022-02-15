import { readFile, access, writeFile, mkdir } from 'fs/promises';
import path from 'path';
import { log } from './log';
import { Completer } from './utils';

const DIR = process.env.DB_DIR ?? (() => {throw new Error("DB_DIR is not set")})() ;
const FLUSH_INTERVAL = 15 * 60 * 1000;

export interface Filebacked<Schema> {
    flush: () => Promise<void>
    get: () => Promise<Schema>
}

export const filebacked = <Schema>(name: string, def: Schema): Filebacked<Schema> => {
    let obj: Schema | undefined;
    let completer: Completer | undefined = undefined;

    const schedule = () => {
        setInterval(() => flush(), FLUSH_INTERVAL)
    }

    const flush = async () => {
        if (!obj) return;
        log(`Persistence: flushing ${name}`)
        return writeFile(path.join(DIR, name), JSON.stringify(obj))
    }

    return {
        get: async () => {
            if (completer) await completer.promise // if we started reading, wait for it to complete, don't rush again
            completer = new Completer();

            if (obj) {
                return obj;
            }
    
            const fp = path.join(DIR, name);

            await mkdir(DIR, { recursive: true })
            let str: string | undefined;
            try {
                log(`Persistence: reading file of ${name}`)
                await access(fp);
                str = await readFile(fp, "utf-8")
            } catch (e) {
            } finally {
                obj = JSON.parse(str ?? JSON.stringify(def)) as Schema
            }

            completer.complete()
            schedule()
    
            return obj;
        },
        flush
    }
}