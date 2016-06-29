const MemoryAdapter = require('socket.io-adapter');
const AMQPTransport = require('ms-amqp-transport');
const debug = require('debug')('socket.io-adapter-amqp');
const Errors = require('common-errors');
const is = require('is');
const Namespace = require('socket.io/lib/namespace');
const Promise = require('bluebird');
const uid2 = require('uid2');

const defaultTransportOptions = {
  exchange: 'socket.io-adapter-amqp',
  exchangeArgs: {
    autoDelete: true,
    type: 'direct',
  },
  defaultQueueOpts: {
    autoDelete: true,
    exclusive: true,
  },
};
const ROUTING_KEY_DELIMITER = '.';

/**
 * @param {Object} transportOptions
 * @returns {AMQPAdapter}
 */
function Adapter(transportOptions = {}) {
  if (is.object(transportOptions) === false) {
    throw new Errors.ArgumentError('transportOptions');
  }

  let queue = null;
  let exchangeCreated = false;

  const adapters = new Map();
  const serverId = uid2(6);
  debug('#%s: create adapter', serverId);

  /**
   * @param message
   * @param headers
   */
  function router(message, headers) {
    const routingKey = headers.routingKey;
    debug('#%s: get message for', serverId, routingKey);

    // expected that routingKey should be following pattern {namespace}.[{room}]
    const routingParts = routingKey.split(ROUTING_KEY_DELIMITER);

    if (routingParts.length < 1) {
      return debug('#%s: invalid routing key %s', serverId, routingKey);
    }

    const namespaceName = routingParts[0];
    const adapter = adapters.get(namespaceName);

    if (is.undefined(adapter)) {
      return debug('#%s: invalid adapter for routing key %s', serverId, routingKey);
    }

    return adapter.processMessage(routingKey, message);
  }

  const transport = new AMQPTransport(Object.assign({}, transportOptions, defaultTransportOptions));
  transport.on('consumed-queue-reconnected', (consumer, createdQueue) => {
    debug('#%s: fired reconnected event', serverId);
    queue = createdQueue;
  });
  transport.connect().then(() => transport.createConsumedQueue(router));

  /**
   * @param routingKey
   */
  function bindRoutingKey(routingKey) {
    if (queue === null) {
      debug('#%s: trying to bind routing key %s, but queue is not ready yet', serverId, routingKey);
      return Promise.delay(100).return(routingKey).then(bindRoutingKey);
    }

    return transport.bindExchange(queue, routingKey)
      .tap(() => {
        debug('#%s: routing key %s is binded', serverId, routingKey);
        exchangeCreated = true;
      })
      .return(true);
  }

  /**
   * @param routingKey
   */
  function unbindRoutingKey(routingKey) {
    if (queue === null) {
      debug('#%s: trying to unbind routing key %s, but queue is not ready', serverId, routingKey);
      return Promise.delay(100).return(routingKey).then(unbindRoutingKey);
    }

    return transport.unbindExchange(queue, routingKey)
      .tap(() => debug('#%s: routing key %s is unbinded', serverId, routingKey))
      .return(true);
  }

  /**
   * @param routingKey
   * @param message
   */
  function publish(routingKey, message) {
    if (exchangeCreated === false) {
      debug('#%s: trying to publish to %s, but exchange is not ready yet', serverId, routingKey);
      return Promise.delay(100).return([routingKey, message]).spread(publish);
    }

    return transport.publish(routingKey, message)
      .tap(() => debug('#%s: publish to %s', serverId, routingKey))
      .return(true);
  }

  /**
   * @param {Array} parts
   * @returns {*}
   */
  function makeRoutingKey(...parts) {
    parts.forEach(part => {
      if (is.string(part) === false) {
        throw new Errors.ArgumentError('part');
      }
    });

    return parts.join(ROUTING_KEY_DELIMITER);
  }

  class AMQPAdapter extends MemoryAdapter {
    /**
     * @param {Namespace} namespace
     */
    constructor(namespace) {
      if (namespace instanceof Namespace === false) {
        throw new Errors.ArgumentError('namespace');
      }

      super(namespace);
      this.routingKey = makeRoutingKey(namespace.name);
      bindRoutingKey(this.routingKey);
      adapters.set(namespace.name, this);
      debug('#%s: namespace %s was created', serverId, namespace.name);
    }

    broadcast(packet, options, fromAnotherNode = false) {
      super.broadcast(packet, options);

      // if broadcasting from local node, need to broadcast to another nodes
      // else means that message came from amqp and already broadcasted
      if (fromAnotherNode === false) {
        const routingKey = makeRoutingKey(packet.nsp);
        const message = [serverId, packet, options];

        if (options.rooms) {
          const promises = options.rooms
            .map(room => publish(makeRoutingKey(routingKey, room), message));

          return Promise.all(promises);
        }

        return publish(routingKey, message);
      }

      return Promise.resolve(true);
    }

    processMessage(routingKey, message) {
      if (routingKey.startsWith(this.routingKey) === false) {
        debug(
          '#%s: ignore different routing keys %s and %s',
          serverId,
          routingKey,
          this.routingKey
        );
        return Promise.resolve(true);
      }

      const args = message;
      const messageServerId = args.shift();

      if (messageServerId === serverId) {
        debug('#%s: ignore same server id %s', serverId, messageServerId);
        Promise.resolve(true);
      }

      const packet = args[0];

      if (packet && packet.nsp === undefined) {
        packet.nsp = '/';
      }

      if (!packet || packet.nsp !== this.nsp.name) {
        return debug('#%s: ignore different namespace', serverId);
      }

      args.push(true);

      return this.broadcast(...args);
    }

    /**
     * Subscribe client to room messages
     *
     * @param {String} id
     * @param {String} room
     * @param {Function} callback
     */
    add(id, room, callback) {
      debug('#%s: adding %s to %s ', serverId, id, room);
      super.add(id, room);

      const promise = bindRoutingKey(makeRoutingKey(this.nsp.name, room))
        .return(true)
        .catch(error => {
          this.emit('error', error);
        });

      if (is.fn(callback)) {
        return promise.asCallback(callback);
      }

      return promise;
    }

    /**
     * Unsubscribe client from room messages.
     *
     * @param {String} id
     * @param {String} room
     * @param {Function} callback
     */
    del(id, room, callback) {
      debug('#%s: removing %s from %s', serverId, id, room);
      const hasRoom = this.rooms.hasOwnProperty(room);
      let promise;
      super.del(id, room);

      if (hasRoom && !this.rooms[room]) {
        promise = unbindRoutingKey(makeRoutingKey(this.nsp.name, room))
          .return(true)
          .catch(error => {
            this.emit('error', error);
          });
      } else {
        promise = Promise.resolve(true);
      }

      if (is.fn(callback)) {
        return promise.asCallback(callback);
      }

      return promise;
    }

    /**
     * Unsubscribe client completely
     *
     * @param {String} id
     * @param {Function} callback
     */
    delAll(id, callback) {
      debug('#%s: removing %s from all rooms', serverId, id);

      const adapter = this;
      const rooms = adapter.sids[id];
      let promise;

      if (rooms) {
        const promises = Object.keys(rooms).map(room => adapter.del(id, room));
        promise = Promise.all(promises)
          .tap(() => delete adapter.sids[id])
          .return(true)
          .catch(error => {
            adapter.emit('error', error);
          });
      } else {
        promise = Promise.resolve(true);
      }

      if (is.fn(callback)) {
        return promise.asCallback(callback);
      }

      return promise;
    }
  }

  return AMQPAdapter;
}

module.exports = Adapter;
