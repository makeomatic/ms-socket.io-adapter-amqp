import { merge } from 'lodash'
import AMQPTransport = require('@microfleet/transport-amqp')
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

/**
 *
 */
export class Transport extends EventEmitter {
  public adapters: Map<string, AMQPAdapter> = new Map();
  public serverId = uid2(6);
  public transport: InstanceType<typeof AMQPTransport>;
  public connecting = false;

  private exchangeCreated = false;
  private queue: any = null;

  /**
   * @returns {string}
   */
  static ROUTING_KEY_DELIMITER = '.';

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
  };

  /**
   * @param {Object} options
   */
  constructor(options: any = {}) {
    super()
    this.transport = new AMQPTransport(merge({}, options, Transport.essentialOptions))
    this.router = this.router.bind(this)

    this.transport.on('consumed-queue-reconnected', (_: any, createdQueue: any) => {
      debug('#%s: fired reconnected event', this.serverId)
      this.queue = createdQueue
      this.emit(kQueueBound)
    })
  }

  async connect(): Promise<void> {
    this.connecting = true
    await this.transport.connect()
    await this.transport.createConsumedQueue(this.router)

    debug('#%s: adapter was created', this.serverId)
  }

  async close(): Promise<void> {
    debug('closing')
    this.connecting = false
    await this.transport.closeAllConsumers()
    await this.transport.close()
  }

  /**
   * @param message
   * @param {Object} headers
   */
  async router(message: Message, headers: Record<string, string>): Promise<void> {
    const { routingKey } = headers
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
   * @param {String} routingKey
   * @returns {Promise}
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
    }

    await this.transport.bindExchange(this.queue, routingKey)
    debug('#%s: routing key %s is bound', this.serverId, routingKey)
    this.exchangeCreated = true
    this.emit(kExchangeCreated)
    return true
  }

  /**
   * @param {String} routingKey
   * @returns {Promise}
   */
  async unbindRoutingKey(routingKey: string): Promise<boolean> {
    if (this.queue === null) {
      debug(
        '#%s: trying to unbind routing key %s, but queue is not ready',
        this.serverId,
        routingKey
      )

      await once(this, kQueueBound)
    }

    await this.transport.unbindExchange(this.queue, routingKey)
    debug('#%s: routing key %s is unbinded', this.serverId, routingKey)
    return true
  }

  /**
   * @param {String} routingKey
   * @param message
   * @returns {Promise}
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
   * @param {Array} parts
   * @returns {String}
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
