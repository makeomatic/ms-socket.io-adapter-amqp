import { merge } from 'lodash'
import { AMQPTransport } from '@microfleet/transport-amqp'
import { Message as AMQPMessage, Queue, Consumer } from '@microfleet/amqp-coffee'
import _debug = require('debug')
import Errors = require('common-errors')
import is from '@sindresorhus/is'
import uid2 = require('uid2')
import { EventEmitter, once } from 'events'
import type { EncodedMessage, Message } from 'socket.io'
import type { AMQPAdapter } from './adapter'

const debug = _debug('socket.io-adapter-amqp:transport')

const kQueueBound = Symbol.for('socket.io:adapter:queue-bound')
const kExchangeCreated = Symbol.for('socket.io:adapter:exchange-created')

export type AMQPConfiguration = ConstructorParameters<typeof AMQPTransport>[0]

/**
 *
 */
export class Transport extends EventEmitter {
  public adapters: Map<string, AMQPAdapter> = new Map()
  public serverId = uid2(6)
  public transport: AMQPTransport
  public connecting = false

  private exchangeCreated = false
  private queue: Queue | null = null
  private consumer: Consumer | null = null

  /**
   * @returns {string}
   */
  static ROUTING_KEY_DELIMITER = '.'

  /**
   *
   */
  static essentialOptions = {
    exchangeArgs: {
      autoDelete: true,
      type: 'direct',
    },
    defaultQueueOpts: {
      autoDelete: true,
      exclusive: true,
    },
  }

  /**
   * @param options
   */
  constructor(options: AMQPConfiguration = {}) {
    super()
    this.transport = new AMQPTransport(merge({}, options, Transport.essentialOptions))
    this.router = this.router.bind(this)
  }

  async connect(): Promise<void> {
    this.connecting = true
    await this.transport.connect()
    const { queue, consumer } = await this.transport.createConsumedQueue(this.router)

    this.queue = queue
    this.consumer = consumer
    this.emit(kQueueBound)

    debug('#%s: adapter was created', this.serverId)
  }

  async close(): Promise<void> {
    debug('closing')
    this.connecting = false
    if (this.consumer) {
      await this.transport.closeConsumer(this.consumer)
    }
    await this.transport.close()
  }

  /**
   * @param message
   * @param raw
   */
  async router(message: Message, raw: AMQPMessage): Promise<any> {
    const routingKey: string = raw.routingKey || (raw.properties.headers && raw.properties.headers['routing-key']) || ''
    // expected that routingKey should be following pattern {namespace}.[{room}]
    const routingParts = routingKey.split(Transport.ROUTING_KEY_DELIMITER)
    debug('#%s: get message for %s - %j', this.serverId, routingKey, message)

    if (routingParts.length < 1) {
      debug('#%s: invalid routing key %s', this.serverId, routingKey)
      return
    }

    const [namespaceName] = routingParts
    const adapter = this.adapters.get(namespaceName)

    if (is.undefined(adapter)) {
      debug('#%s: invalid adapter for routing key %s', this.serverId, routingKey)
      return
    }

    return adapter.processMessage(routingKey, message)
  }

  /**
   * @param routingKey
   */
  async bindRoutingKey(routingKey: string): Promise<boolean> {
    if (this.queue === null) {
      debug(
        '[connecting: %s] #%s: trying to bind routing key %s, but queue is not ready yet',
        this.connecting,
        this.serverId,
        routingKey
      )

      await once(this, kQueueBound)
      return this.bindRoutingKey(routingKey)
    }

    await this.transport.bindExchange(this.queue, routingKey)
    debug('#%s: routing key %s is bound', this.serverId, routingKey)
    this.exchangeCreated = true
    this.emit(kExchangeCreated)
    return true
  }

  /**
   * @param routingKey
   */
  async unbindRoutingKey(routingKey: string): Promise<boolean> {
    if (this.queue === null) {
      debug(
        '#%s: trying to unbind routing key %s, but queue is not ready',
        this.serverId,
        routingKey
      )

      await once(this, kQueueBound)
      return this.unbindRoutingKey(routingKey)
    }

    await this.transport.unbindExchange(this.queue, routingKey)
    debug('#%s: routing key %s is unbinded', this.serverId, routingKey)
    return true
  }

  /**
   * @param routingKey
   * @param message
   */
  async publish(routingKey: string, message: EncodedMessage): Promise<boolean> {
    if (this.exchangeCreated === false) {
      debug(
        '#%s: trying to publish to %s, but exchange is not ready yet',
        this.serverId,
        routingKey
      )

      await once(this, kExchangeCreated)
    }

    debug('publishing to %s', routingKey)
    await this.transport.publish(routingKey, message)
    debug('#%s: publish to %s', this.serverId, routingKey)
    return true
  }

  /**
   * @param parts
   */
  static makeRoutingKey(...parts: string[]): string {
    for (const part of parts.values()) {
      if (is.string(part) === false) {
        throw new Errors.ArgumentError('part')
      }
    }

    return parts.join(Transport.ROUTING_KEY_DELIMITER)
  }
}

export default Transport
