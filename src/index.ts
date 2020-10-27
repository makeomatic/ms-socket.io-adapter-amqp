/* eslint-disable @typescript-eslint/no-namespace */
import type SocketIO from 'socket.io'
import type { Server as HttpServer } from 'http'

import AdapterFactory from './factory'
import AMQPAdapter from './adapter'
import Transport from './transport'

declare module 'socket.io' {
  interface BroadcastOptions {
    rooms: string[];
    except?: string[];
    flags?: {
      volatile: boolean;
      compress: boolean;
    }
  }

  export interface Packet {
    nsp: string | undefined
  }

  export type Message = [string, SocketIO.Packet, BroadcastOptions]

  export interface Broadcast extends SocketIO.Namespace {
    (packet: SocketIO.Packet, options: BroadcastOptions, fromAnotherNode: boolean): Promise<boolean>
  }

  export interface Namespace {
    id: string
    name: string
    broadcast: Broadcast
  }

  export interface Adapter {
    transport: Transport
  }

  export interface Server {
    httpServer?: HttpServer
  }
}

export { AdapterFactory, Transport, AMQPAdapter as Adapter }
export default AdapterFactory
