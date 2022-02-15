import { Filebacked, filebacked } from "../persistence";

import exitHook from 'async-exit-hook';

export type PluginMethods = 'post' | 'put' | 'get';

export interface IBasePlugin {
    identifier: string;
    method: PluginMethods;

    middleware(params: Record<string, any>, data: any): Promise<void>
}

export abstract class BasePlugin<Params extends Record<string, any>, Data, PSchema = void> implements IBasePlugin {
    abstract method: PluginMethods;
    private persistence!: Filebacked<PSchema>

    constructor(
        public identifier: string
    ) {
        this.persistence = filebacked(this.identifier, this.persistDefault());

        exitHook(callback => {
            this.persistence.flush().then(callback);
        })
    }

    protected persistDefault(): PSchema {
        return {} as PSchema;
    }
    protected abstract validateParams(params: Record<string, any>): Params;
    protected abstract validateData(data: any): Data;
    protected abstract run(params: Params, data: Data, persistent: Filebacked<PSchema>): Promise<void>

    middleware(params: Record<string, any>, data: any) {
        return this.run(this.validateParams(params), this.validateData(data), this.persistence);
    }
}