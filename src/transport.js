const merge = require('lodash/merge');
const AMQPTransport = require('ms-amqp-transport');
const debug = require('debug')('socket.io-adapter-amqp:transport');
const Errors = require('common-errors');
const is = require('is');
const Promise = require('bluebird');
const uid2 = require('uid2');

/**
 *
 */
class Transport {
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
  constructor(options = {}) {
    this.adapters = new Map();
    this.exchangeCreated = false;
    this.serverId = uid2(6);
    this.transport = new AMQPTransport(merge({}, options, Transport.essentialOptions));
    this.queue = null;

    this.transport.on('consumed-queue-reconnected', (consumer, createdQueue) => {
      debug('#%s: fired reconnected event', this.serverId);
      this.queue = createdQueue;
    });

    this.transport
      .connect()
      .then(() => this.transport.createConsumedQueue(this.router.bind(this)))
      .catch(e => setImmediate(() => { throw e; }));

    debug('#%s: adapter was created', this.serverId);
  }

  /**
   * @param message
   * @param {Object} headers
   */
  router(message, headers) {
    const routingKey = headers.routingKey;
    // expected that routingKey should be following pattern {namespace}.[{room}]
    const routingParts = routingKey.split(Transport.ROUTING_KEY_DELIMITER);
    debug('#%s: get message for', this.serverId, routingKey);

    if (routingParts.length < 1) {
      return debug('#%s: invalid routing key %s', this.serverId, routingKey);
    }

    const namespaceName = routingParts[0];
    const adapter = this.adapters.get(namespaceName);

    if (is.undefined(adapter)) {
      return debug('#%s: invalid adapter for routing key %s', this.serverId, routingKey);
    }

    return adapter.processMessage(routingKey, message);
  }

  /**
   * @param {String} routingKey
   * @returns {Promise}
   */
  bindRoutingKey(routingKey) {
    if (this.queue === null) {
      debug(
        '#%s: trying to bind routing key %s, but queue is not ready yet',
        this.serverId,
        routingKey
      );
      return Promise.bind(this, routingKey)
        .delay(100)
        .then(this.bindRoutingKey);
    }

    return this.transport.bindExchange(this.queue, routingKey)
      .tap(() => {
        debug('#%s: routing key %s is binded', this.serverId, routingKey);
        this.exchangeCreated = true;
      })
      .return(true);
  }

  /**
   * @param {String} routingKey
   * @returns {Promise}
   */
  unbindRoutingKey(routingKey) {
    if (this.queue === null) {
      debug(
        '#%s: trying to unbind routing key %s, but queue is not ready',
        this.serverId,
        routingKey
      );
      return Promise.delay(100)
        .return(routingKey)
        .bind(this)
        .then(this.unbindRoutingKey);
    }

    return this.transport.unbindExchange(this.queue, routingKey)
      .tap(() => debug('#%s: routing key %s is unbinded', this.serverId, routingKey))
      .return(true);
  }

  /**
   * @param {String} routingKey
   * @param message
   * @returns {Promise}
   */
  publish(routingKey, message) {
    if (this.exchangeCreated === false) {
      debug(
        '#%s: trying to publish to %s, but exchange is not ready yet',
        this.serverId,
        routingKey
      );

      return Promise
        .bind(this, [routingKey, message])
        .delay(100)
        .spread(this.publish);
    }

    debug('publishing to %s', routingKey);
    return this.transport.publish(routingKey, message)
      .tap(() => debug('#%s: publish to %s', this.serverId, routingKey))
      .return(true);
  }

  /**
   * @param {Array} parts
   * @returns {String}
   */
  static makeRoutingKey(...parts) {
    parts.forEach((part) => {
      if (is.string(part) === false) {
        throw new Errors.ArgumentError('part');
      }
    });

    return parts.join(Transport.ROUTING_KEY_DELIMITER);
  }
}

module.exports = Transport;
