import type { BroadcastOptions } from 'socket.io-adapter'
import { AdapterFactory } from './factory'
import { AMQPAdapter } from './adapter'
import { Transport } from './transport'

declare module 'socket.io' {
  export interface Packet {
    type: number
    nsp: string | undefined
    data: [event: string, ...args: any[]]
  }

  export type EncodeOptions<T> = {
    [K in keyof T]: T[K] extends Set<infer A> | undefined ? A[] : T[K]
  }

  export type Message = [string, Packet, BroadcastOptions]
  export type EncodedMessage = [string, Packet, EncodeOptions<BroadcastOptions>]

  export interface Broadcast extends Namespace {
    (packet: Packet, options: BroadcastOptions, fromAnotherNode: boolean): Promise<boolean>
  }

  export interface Namespace {
    readonly id: string
  }

  export interface Adapter {
    transport: Transport
    nsp: Namespace
  }
}

export { AdapterFactory, Transport, AMQPAdapter as Adapter }
export default AdapterFactory
