/* eslint-disable @typescript-eslint/explicit-module-boundary-types */
declare module '@microfleet/transport-amqp' {
  export = AMQPTransport;

  class AMQPTransport<T = any> {
    public config: T;

    constructor(config: T);

    publishAndWait(route: string, message: any, options?: any): Promise<any>;
    publish(route: string, message: any, options?: any): Promise<any>;

    connect(): Promise<AMQPTransport>;
    close(): Promise<void>;

    createConsumedQueue(router: (message: Message, headers: Record<string, string>) => Promise<void>): Promise<void>;
    closeAllConsumers(): Promise<void>;
    bindExchange(queue: any, key: string): Promise<void>;
    unbindExchange(queue: any, key: string): Promise<void>;

    on(event: 'consumed-queue-reconnected', callback: (consumer: any, createdQueue: any) => void): void;

    static connect(config: any): Promise<AMQPTransport>;
  }
}
