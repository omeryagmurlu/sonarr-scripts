export type PluginMethods = 'post' | 'put' | 'get';

export interface IBasePlugin {
    identifier: string;
    method: PluginMethods;

    middleware(params: Record<string, any>, data: any): Promise<void>
}

export abstract class BasePlugin<Params extends Record<string, any>, Data> implements IBasePlugin {
    abstract identifier: string;
    abstract method: PluginMethods;

    protected abstract validateParams(params: Record<string, any>): Params;
    protected abstract validateData(data: any): Data;
    protected abstract run(params: Params, data: Data): Promise<void>

    middleware(params: Record<string, any>, data: any) {
        return this.run(this.validateParams(params), this.validateData(data));
    }
}