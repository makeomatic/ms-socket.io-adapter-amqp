import { Adapter, BroadcastOptions } from 'socket.io-adapter'
import _debug = require('debug')
import Errors = require('common-errors')
import Bluebird = require('bluebird')
import { Transport } from './transport'
import type { Server as httpServer } from 'http'
import type { Namespace, Message, Packet, EncodedMessage, EncodeOptions } from 'socket.io'

const debug = _debug('socket.io-adapter-amqp:adapter')

const broadcastOptsProto = Object.create({}, {
  except: {
    enumerable: true,
    writable: true,
    value: undefined
  },
  rooms: {
    enumerable: true,
    writable: true,
    value: undefined
  },
  flags: {
    enumerable: true,
    writable: true,
    value: undefined
  }
})

declare module 'http' {
  interface Server {
    [prop: symbol]: boolean
  }
}

/**
 *
 */
export class AMQPAdapter extends Adapter {
  public transport: Transport
  public routingKey: string
  public namespace: Namespace

  /**
   * @param namespace
   * @param transport
   */
  constructor(namespace: Namespace, transport: Transport) {
    debug('creating AMQPAdapter on %s using %s', namespace.name, transport.serverId)

    if (transport instanceof Transport === false) {
      throw new Errors.ArgumentError('transport')
    }

    super(namespace)

    this.namespace = namespace
    this.transport = transport
    this.routingKey = Transport.makeRoutingKey(namespace.name)

    debug('binding %s', this.routingKey)

    transport.bindRoutingKey(this.routingKey)
    transport.adapters.set(namespace.name, this)
    debug('#%s: namespace %s was created', transport.serverId, namespace.name)

    this.setupConnectionListeners()
  }

  private setupConnectionListeners(): void {
    const { namespace: { server } } = this

    // @ts-expect-error - must access private property to attach
    //  to error listeners
    const httpServer = server.httpServer as httpServer
    const connectionSymbol = Symbol.for(`@microfleet/socket.io-adapter::${this.transport.serverId}`)

    if (httpServer && !httpServer[connectionSymbol]) {
      httpServer.once('close', this.onClose.bind(this))
      httpServer[connectionSymbol] = true

      if (httpServer.listening) {
        this.onListen()
      } else {
        httpServer.once('listening', this.onListen.bind(this))
      }
    }
  }

  private async onListen(): Promise<void> {
    try {
      await this.transport.connect()
    } catch (e: any) {
      debug('failed to connect to amqp transport', e.message)
    }
  }

  private async onClose(): Promise<void> {
    try {
      await this.transport.close()
    } catch (e: any) {
      debug('failed to close connection to amqp transport', e.message)
    }
  }

  /**
   * @param packet
   * @param options
   * @param remote
   */
  async broadcast(packet: Packet, options: BroadcastOptions, remote = false): Promise<void> {
    debug('called super broadcast - %j | %j | %j', packet, options, remote)
    super.broadcast(packet, options)

    // will assign default opts
    debug('broadcasting - %j | %j | %j', packet, options, remote)

    // if broadcasting from local node, need to broadcast to another nodes
    // else means that message came from amqp and already broadcasted
    if (remote === false || options.flags?.local) {
      const routingKey = Transport.makeRoutingKey(packet.nsp || '/')
      const message: EncodedMessage = [this.transport.serverId, packet, this.encodeOptions(options)]

      if (options.rooms.size) {
        await Bluebird.map(options.rooms, async (room) => {
          await this.transport.publish(Transport.makeRoutingKey(routingKey, room), message)
        }, { concurrency: 10 })
      } else {
        await this.transport.publish(routingKey, message)
      }
    }
  }

  private encodeOptions(options: BroadcastOptions): EncodeOptions<BroadcastOptions> {
    const opts: EncodeOptions<BroadcastOptions> = Object.create(broadcastOptsProto)

    opts.flags = options.flags

    if (options.rooms) {
      opts.rooms = Array.from(options.rooms)
    }

    if (options.except) {
      opts.except = Array.from(options.except)
    }

    return opts
  }

  /**
   * @param routingKey
   * @param message
   */
  async processMessage(routingKey: string, message: Message): Promise<void> {
    debug('[%s] received %s - %j', this.transport.serverId, routingKey, message)

    if (routingKey.startsWith(this.routingKey) === false) {
      debug(
        '#%s: ignore different routing keys %s and %s',
        this.transport.serverId,
        routingKey,
        this.routingKey
      )
      return
    }

    const args = message
    const [messageServerId, packet, options] = args

    if (messageServerId === this.transport.serverId) {
      debug('#%s: ignore same server id %s', this.transport.serverId, messageServerId)
      return
    }

    if (packet && packet.nsp === undefined) {
      packet.nsp = '/'
    }

    if (!packet || packet.nsp !== this.nsp.name) {
      debug('#%s: ignore different namespace', this.transport.serverId)
      return
    }

    // AMQP serializes sets to objects
    if (!(options.except instanceof Set)) {
      options.except = new Set(options.except)
    }

    if (!(options.rooms instanceof Set)) {
      options.rooms = new Set(options.rooms)
    }

    return this.broadcast(packet, options, true)
  }

  /**
   * Subscribe client to room messages
   * @param id
   * @param room
   */
  async add(id: string, room: string): Promise<void> {
    debug('#%s: adding %s to %s ', this.transport.serverId, id, room)
    return this.addAll(id, new Set([room]))
  }

  /**
   * Subscribe client to room messages
   *
   * @param id
   * @param rooms
   */
  async addAll(id: string, rooms: Set<string>): Promise<void> {
    debug('#%s: adding %s to %s ', this.transport.serverId, id, rooms)
    await super.addAll(id, rooms)
    await Bluebird.map(rooms, async (room) => {
      try {
        await this.transport.bindRoutingKey(Transport.makeRoutingKey(this.nsp.name, room))
      } catch (error) {
        if (this.listenerCount('error')) {
          this.emit('error', error)
        } else {
          debug('addAll failed', error)
        }
      }
    })
  }

  /**
   * Unsubscribe client from room messages.
   * @param id
   * @param room
   */
  async del(id: string, room: string): Promise<void> {
    debug('#%s: removing %s from %s', this.transport.serverId, id, room)
    const hasRoom = this.rooms.has(room)
    await super.del(id, room)

    if (hasRoom && !this.rooms.has(room)) {
      try {
        await this.transport.unbindRoutingKey(Transport.makeRoutingKey(this.nsp.name, room))
      } catch (error) {
        if (this.listenerCount('error')) {
          this.emit('error', error)
        } else {
          debug('failed to remove %s from room %s', id, room, error)
        }
      }
    }
  }

  /**
   * Unsubscribe client completely
   * @param id
   */
  async delAll(id: string): Promise<void> {
    debug('#%s: removing %s from all rooms', this.transport.serverId, id)

    const rooms = this.sids.get(id)

    if (rooms) {
      try {
        await Bluebird.map(rooms, (room) => this.del(id, room))
        this.sids.delete(id)
      } catch (error) {
        if (this.listenerCount('error')) {
          this.emit('error', error)
        } else {
          debug('failed to remove %s from rooms', id, error)
        }
      }
    }
  }
}

export default AMQPAdapter
