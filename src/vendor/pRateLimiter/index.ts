// @ts-nocheck
// https://github.com/natesilva/p-ratelimit/tree/49f603fab899e9350fabf43341567f1c819b5990
export function pRateLimit(quotaManager: QuotaManager | Quota): <T>(fn: () => Promise<T>) => Promise<T> {
    if (!(quotaManager instanceof QuotaManager)) {
        return pRateLimit(new QuotaManager(quotaManager));
    }
    
    const queue = new Dequeue<Function>();
    let timerId: NodeJS.Timer = null;
    
    const next = () => {
        while (queue.length && quotaManager.start()) {
            queue.shift()();
        }
        
        if (queue.length && !quotaManager.activeCount && !timerId) {
            timerId = setTimeout(() => {
                timerId = null;
                next();
            }, 100);
        }
    };
    
    return <T>(fn: () => Promise<T>) => {
        return new Promise<T>((resolve, reject) => {
            let timerId: NodeJS.Timer = null;
            if (quotaManager.maxDelay) {
                timerId = setTimeout(() => {
                    timerId = null;
                    reject(new RateLimitTimeoutError('queue maxDelay timeout exceeded'));
                    next();
                }, quotaManager.maxDelay);
            }
            
            const run = () => {
                if (quotaManager.maxDelay) {
                    if (timerId) {
                        clearTimeout(timerId);
                    } else {
                        // timeout already fired
                        return;
                    }
                }
                
                fn()
                .then(val => {
                    quotaManager.end();
                    resolve(val);
                })
                .catch(err => {
                    quotaManager.end();
                    reject(err);
                })
                .then(() => {
                    next();
                });
            };
            
            queue.push(run);
            next();
        });
    };
}

export class RateLimitTimeoutError extends Error {}

export interface Quota {
    /** interval (sliding window) over which API calls are counted, in milliseconds */
    interval?: number;
    /** number of API calls allowed per interval */
    rate?: number;
    /** number of concurrent API calls allowed */
    concurrency?: number;
    /**
    * if a request is queued longer than this, it will be discarded and an error thrown
    * (default: 0, disabled)
    */
    maxDelay?: number;
    /**
    * (Redis only): if true, immediately begin processing requests using the full quota,
    * instead of waiting several seconds to discover other servers (default: false)
    */
    fastStart?: boolean;
}


/** keep track of API invocations, allowing or disallowing them based on our quota */
export class QuotaManager {
    protected _activeCount = 0;
    protected history = new Dequeue();
    
    constructor(protected _quota: Quota) {
        if (typeof _quota !== 'object') {
        console.warn(
            '[p-ratelimit QuotaManager] A QuotaManager was created with no quota.'
            );
            this._quota = {};
        }
        
        if (
            ('interval' in this._quota && !('rate' in this._quota)) ||
            ('rate' in this._quota && !('interval' in this._quota))
        ) {
            const msg =
            `[p-ratelimit QuotaManager] Invalid Quota: for a rate-limit quota, both ` +
            `interval and rate must be specified.`;
            throw new Error(msg);
        }
    }
    
    /** The current quota */
    get quota() {
        return Object.assign({}, this._quota);
    }
    
    /** The number of currently-active invocations */
    get activeCount() {
        return this._activeCount;
    }
    
    /** Max amount of time a queued request can wait before throwing a timeout error */
    get maxDelay() {
        return this._quota.maxDelay || 0;
    }
    
    /**
    * Log that an invocation started.
    * @returns true if the invocation was allowed, false if not (you can try again later)
    */
    start() {
        if (this._activeCount >= this._quota.concurrency) {
            return false;
        }
        
        if (this._quota.interval !== undefined && this._quota.rate !== undefined) {
            this.removeExpiredHistory();
            if (this.history.length >= this._quota.rate) {
                return false;
            }
            this.history.push(Date.now());
        }
        
        this._activeCount++;
        return true;
    }
    
    /** Log that an invocation ended */
    end() {
        this._activeCount--;
    }
    
    protected removeExpiredHistory() {
        const expired = Date.now() - this._quota.interval;
        while (this.history.length && this.history.peekFront() < expired) {
            this.history.shift();
        }
    }
}

interface Node<T> {
    value: T;
    prev: Node<T>;
    next: Node<T>;
}

export class Dequeue<T> {
    private _length = 0;
    private head: Node<T> = undefined;
    private tail: Node<T> = undefined;
    
    get length() {
        return this._length;
    }
    
    clear() {
        this.head = this.tail = undefined;
        this._length = 0;
    }
    
    push(value: T) {
        const newNode: Node<T> = {
            value,
            prev: this.tail,
            next: undefined
        };
        
        if (this._length) {
            this.tail.next = newNode;
            this.tail = newNode;
        } else {
            this.head = this.tail = newNode;
        }
        this._length++;
    }
    
    pop(): T {
        if (!this._length) {
            return undefined;
        }
        const result = this.tail;
        this.tail = this.tail.prev;
        this._length--;
        if (!this._length) {
            this.head = this.tail = undefined;
        }
        return result.value;
    }
    
    unshift(value: T) {
        const newNode: Node<T> = {
            value,
            prev: undefined,
            next: this.head
        };
        
        if (this._length) {
            this.head.prev = newNode;
            this.head = newNode;
        } else {
            this.head = this.tail = newNode;
        }
        
        this._length++;
    }
    
    shift(): T {
        if (!this._length) {
            return undefined;
        }
        const result = this.head;
        this.head = this.head.next;
        this._length--;
        if (!this._length) {
            this.head = this.tail = undefined;
        }
        return result.value;
    }
    
    peekFront(): T {
        if (this._length) {
            return this.head.value;
        }
        return undefined;
    }
    
    peekBack(): T {
        if (this._length) {
            return this.tail.value;
        }
        return undefined;
    }
}