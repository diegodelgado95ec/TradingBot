declare module '@deriv/deriv-api' {
  export default class DerivAPI {
    constructor(options: { connection?: WebSocket; app_id?: number });
    authorize(token: string): Promise<any>;
    ping(): Promise<any>;
    ticksHistory(params: any): Promise<any>;
    subscribe(params: any): any;
  }
}
