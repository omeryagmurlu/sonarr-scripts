import fetch, { RequestInfo, RequestInit, Response } from 'node-fetch'
import { access } from 'fs/promises';
import { constants } from 'fs';

export class Completer<T = void> {
    public readonly promise: Promise<T>;
    public complete!: (value: (PromiseLike<T> | T)) => void;
    private reject!: (reason?: any) => void;

    public constructor() {
        this.promise = new Promise<T>((resolve, reject) => {
            this.complete = resolve;
            this.reject = reject;
        })
    }
}

interface Cache<T> {
    resp: T,
    ttl: number
}
export const cachedFetch = <T = Response>(timeout = 1000 * 60 * 60 * 24, render: (r: Response) => T) => {
    const cache: Record<string, Cache<T>> = {};
    
    return async (url: string, init?: RequestInit): Promise<T> => {
        const entry = cache[url];
        if (entry) {
            if (Date.now() < entry.ttl) {
                return entry.resp;
            }
        }
    
        const resp = await fetch(url, init)
        cache[url] = {
            resp: render(resp),
            ttl: Date.now() + timeout
        }
    
        return cache[url].resp;
    }
}

export const aFetch = (abortTime: number) => (url: RequestInfo, init: RequestInit | undefined = {}): Promise<Response> => {
    const controller = new AbortController();
    const timeout = setTimeout(() => {
        controller.abort();
    }, abortTime);

    try {
        return fetch(url, { ...init, signal: controller.signal });
    } catch (e) {
        throw e;
    } finally {
        clearTimeout(timeout);
    }
}

export async function checkFileExists(file: string) {
    try {
        await access(file, constants.F_OK);
        return true;
    } catch (e) {
        return false;
    }
  }