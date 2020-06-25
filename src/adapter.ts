import Adapter = require('socket.io-adapter')
import _debug = require('debug')
import Errors = require('common-errors')
import Bluebird = require('bluebird')
import Transport from './transport'
import type { Namespace } from 'socket.io'

const debug = _debug('socket.io-adapter-amqp:adapter')

/**
 *
 */
export class AMQPAdapter extends Adapter {
  public transport: Transport
  public routingKey: string
  public namespace: Namespace

  /**
   * @param {Namespace} namespace
   * @param {Transport} transport
   */
  constructor(namespace: SocketIO.Namespace, transport: Transport) {
    if (transport instanceof Transport === false) {
      throw new Errors.ArgumentError('transport')
    }

    super(namespace)

    this.namespace = namespace
    this.transport = transport
    this.routingKey = Transport.makeRoutingKey(namespace.name)

    transport.bindRoutingKey(this.routingKey)
    transport.adapters.set(namespace.name, this)
    debug('#%s: namespace %s was created', transport.serverId, namespace.name)

    this.setupConnectionListeners()
  }

  private setupConnectionListeners(): void {
    const { namespace: { server } } = this

    if (server.httpServer) {
      if (server.httpServer.listening) {
        this.onListen()
      }

      server.httpServer.once('close', this.onClose.bind(this))
      server.httpServer.once('listening', this.onListen.bind(this))
    }
  }

  private async onListen(): Promise<void> {
    try {
      await this.transport.connect()
    } catch (e) {
      debug('failed to connect to amqp transport', e)
    }
  }

  private async onClose(): Promise<void> {
    try {
      await this.transport.close()
    } catch (e) {
      debug('failed to close connection to amqp transport', e)
    }
  }

  /**
   * @param packet
   * @param options
   * @param fromAnotherNode
   */
  async broadcast(packet: SocketIO.Packet, options: SocketIO.BroadcastOptions, fromAnotherNode = false): Promise<boolean> {
    debug('broadcasting', packet, options, fromAnotherNode)

    super.broadcast(packet, options)

    // if broadcasting from local node, need to broadcast to another nodes
    // else means that message came from amqp and already broadcasted
    if (fromAnotherNode === false) {
      const routingKey = Transport.makeRoutingKey(packet.nsp || '/')
      const message: SocketIO.Message = [this.transport.serverId, packet, options]

      if (options.rooms.length) {
        await Bluebird.map(options.rooms, (room: any) => (
          this.transport.publish(Transport.makeRoutingKey(routingKey, room), message)
        ))
        return true
      }

      debug('publishing to %s', routingKey, message)
      return this.transport.publish(routingKey, message)
    }

    return true
  }

  /**
   * @param routingKey
   * @param message
   */
  async processMessage(routingKey: string, message: SocketIO.Message): Promise<boolean> {
    if (routingKey.startsWith(this.routingKey) === false) {
      debug(
        '#%s: ignore different routing keys %s and %s',
        this.transport.serverId,
        routingKey,
        this.routingKey
      )

      return true
    }

    const args = message
    const [messageServerId, packet, options] = args

    if (messageServerId === this.transport.serverId) {
      debug('#%s: ignore same server id %s', this.transport.serverId, messageServerId)
      return true
    }

    if (packet && packet.nsp === undefined) {
      packet.nsp = '/'
    }

    if (!packet || packet.nsp !== this.nsp.name) {
      debug('#%s: ignore different namespace', this.transport.serverId)
      return false
    }

    return this.broadcast(packet, options, true)
  }

  /**
   * Subscribe client to room messages
   *
   * @param {String} id
   * @param {String} room
   * @param {Function} [callback]
   */
  async add(id: string, room: string, callback?: () => void): Promise<void> {
    debug('#%s: adding %s to %s ', this.transport.serverId, id, room)
    super.add(id, room)

    try {
      await this.transport.bindRoutingKey(Transport.makeRoutingKey(this.nsp.name, room))
    } catch (error) {
      if (this.listenerCount('error')) {
        this.emit('error', error)
      } else {
        debug('addAll failed', error)
      }
    }

    if (callback) setImmediate(callback)
  }

  /**
   * Subscribe client to room messages
   *
   * @param {String} id
   * @param {String[]} rooms
   * @param {Function} [callback]
   */
  async addAll(id: string, rooms: string[], callback?: () => void): Promise<void> {
    debug('#%s: adding %s to %s ', this.transport.serverId, id, rooms)
    super.addAll(id, rooms)

    const promises = Bluebird.map(rooms, async (room) => {
      try {
        await this.transport.bindRoutingKey(Transport.makeRoutingKey(this.nsp.name, room))
      } catch (error) {
        if (this.listenerCount('error')) {
          this.emit('error', error)
        } else {
          debug('addAll failed', error)
        }
      }

      return true
    })

    if (callback) {
      await promises.then(() => callback()).catch(callback)
    }

    await promises
  }

  /**
   * Unsubscribe client from room messages.
   *
   * @param {String} id
   * @param {String} room
   */
  async del(id: string, room: string, callback?: () => void): Promise<void> {
    debug('#%s: removing %s from %s', this.transport.serverId, id, room)
    const hasRoom = this.rooms[room] !== undefined
    super.del(id, room)

    if (hasRoom && !this.rooms[room]) {
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

    if (callback) setImmediate(callback)
  }

  /**
   * Unsubscribe client completely
   *
   * @param {String} id
   */
  async delAll(id: string, callback?: () => void): Promise<void> {
    debug('#%s: removing %s from all rooms', this.transport.serverId, id)

    const rooms = this.sids[id]

    if (rooms) {
      try {
        await Bluebird.map(Object.keys(rooms), (room) => this.del(id, room))
        delete this.sids[id]
      } catch (error) {
        if (this.listenerCount('error')) {
          this.emit('error', error)
        } else {
          debug('failed to remove %s from rooms', id, error)
        }
      }
    }

    if (callback) setImmediate(callback)
  }
}

export default AMQPAdapter
