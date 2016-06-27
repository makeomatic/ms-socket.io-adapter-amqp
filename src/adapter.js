const Adapter = require('socket.io-adapter');
const AMQPTransport = require('ms-amqp-transport');
const async = require('async');
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
  }
};

/**
 * @param {Object} transportOptions
 * @returns {AMQPAdapter}
 */
function adapter(transportOptions = {}) {
  if (is.object(transportOptions) === false) {
    throw Errors.ArgumentError('transportOptions');
  }

  let queue = null;
  let exchangeCreated = false;

  const adapters = new Map();
  const serverId = uid2(6);
  debug('#%s: create adapter', serverId);

  const transport = new AMQPTransport(Object.assign({}, transportOptions, defaultTransportOptions));
  transport.on('consumed-queue-reconnected', (consumer, createdQueue) => {
    debug('#%s: fired reconnected event', serverId);
    queue = createdQueue;
  });
  transport.connect().then(transport => transport.createConsumedQueue(router));

  /**
   * @param message
   * @param headers
   */
  function router(message, headers) {
    const routingKey = headers.routingKey;
    debug('#%s: get message for', serverId, routingKey);

    // expected that routingKey should be following pattern {namespace}#[{room}]
    const routingParts = routingKey.split('#');

    if (routingParts.length < 1) {
      return debug('#%s: invalid routing key %s', serverId, routingKey);
    }

    const namespaceName = routingParts[0];
    const adapter = adapters.get(namespaceName);

    if (is.undefined(adapter)) {
      return debug('#%s: invalid adapter for routing key %s', serverId, routingKey);
    }

    adapter.processMessage(routingKey, message);
  }

  /**
   * @param routingKey
   */
  function bindRoutingKey(routingKey) {
    if (queue === null) {
      debug('#%s: trying to bind routing key %s, but queue is not ready yet', serverId, routingKey);
      return Promise.delay(100).then(bindRoutingKey.bind(null, routingKey));
    }

    return transport.bindExchange(queue, routingKey)
      .tap(() => {
        debug('#%s: routing key %s is binded', serverId, routingKey);
        exchangeCreated = true;
      });
  }

  /**
   * @param routingKey
   */
  function unbindRoutingKey(routingKey) {
    if (queue === null) {
      debug('#%s: trying to unbind routing key %s, but queue is not ready yet', serverId, routingKey);
      return Promise.delay(100).then(unbindRoutingKey.bind(null, routingKey));
    }

    return transport.unbindExchange(queue, routingKey)
      .tap(() => debug('#%s: routing key %s is unbinded', serverId, routingKey));
  }

  /**
   * @param routingKey
   * @param message
   */
  function publish(routingKey, message) {
    if (exchangeCreated === false) {
      debug('#%s: trying to publish to %s, but exchange is not ready yet', serverId, routingKey);
      return Promise.delay(100).then(publish.bind(null, routingKey, message));
    }

    return transport.publish(routingKey, message)
      .tap(() => debug('#%s: publish to %s', serverId, routingKey));
  }

  /**
   * @param {Namespace} namespace
   */
  function AMQPAdapter(namespace) {
    if (namespace instanceof Namespace === false) {
      throw Errors.ArgumentError('namespace');
    }

    Adapter.call(this, namespace);
    this.routingKey = `${namespace.name}#`;
    bindRoutingKey(this.routingKey);
    adapters.set(namespace.name, this);
    debug('#%s: namespace %s was created', serverId, namespace.name);
  }

  AMQPAdapter.prototype.__proto__ = Adapter.prototype;

  /**
   * @param {Object} packet
   * @param {Object} options
   * @param {Boolean} fromAnotherNode
   */
  AMQPAdapter.prototype.broadcast = function broadcast(packet, options, fromAnotherNode = false) {
    Adapter.prototype.broadcast.call(this, packet, options);

    // if broadcasting from local node, need to broadcast to another nodes
    // else means that message came from amqp and already broadcasted
    if (fromAnotherNode === false) {
      const routingKey = `${packet.nsp}#`;
      const message = [serverId, packet, options];

      if (options.rooms) {
        options.rooms.forEach(room => publish(`${routingKey}${room}#`, message));
      } else {
          publish(routingKey, message)
      }
    }
  };

  /**
   * @param {string} routingKey
   * @param {Buffer} message
   * @returns {*}
   */
  AMQPAdapter.prototype.processMessage = function processMessage(routingKey, message) {
    if (routingKey.startsWith(this.routingKey) === false) {
      debug('#%s: ignore different routing keys %s and %s', serverId, routingKey, this.routingKey);
      return;
    }

    const args = message;
    const messageServerId = args.shift();
    let packet;

    if (messageServerId === serverId) {
      return debug('#%s: ignore same server id %s', serverId, messageServerId);
    }

    packet = args[0];

    if (packet && packet.nsp === undefined) {
      packet.nsp = '/';
    }

    if (!packet || packet.nsp !== this.nsp.name) {
      return debug('#%s: ignore different namespace', serverId);
    }

    args.push(true);

    this.broadcast.apply(this, args);
  };


  /**
   * Subscribe client to room messages
   *
   * @param {String} id
   * @param {String} room
   * @param {Function} callback
   */
  AMQPAdapter.prototype.add = function add(id, room, callback) {
    debug('#%s: adding %s to %s ', serverId, id, room);
    Adapter.prototype.add.call(this, id, room);
    const routingKey = `${this.nsp.name}#${room}#`;
    bindRoutingKey(routingKey)
      .tap(() => callback && callback(null))
      .catch(error => {
        this.emit('error', error);
        callback && callback(error);
      });
  };

  /**
   * Unsubscribe client from room messages.
   *
   * @param {String} id
   * @param {String} room
   * @param {Function} callback
   */
  AMQPAdapter.prototype.del = function(id, room, callback){
    debug('#%s: removing %s from %s', serverId, id, room);
    const hasRoom = this.rooms.hasOwnProperty(room);
    Adapter.prototype.del.call(this, id, room);

    if (hasRoom && !this.rooms[room]) {
      const routingKey = `${this.nsp.name}#${room}#`;
      unbindRoutingKey(routingKey)
        .tap(() => callback && callback(null))
        .catch(error => {
          this.emit('error', error);
          callback && callback(error);
        });
    } else {
      callback && process.nextTick(callback.bind(null, null));
    }
  };

  /**
   * Unsubscribe client completely
   *
   * @param {String} id
   * @param {Function} callback
   */
  AMQPAdapter.prototype.delAll = function(id, callback) {
    debug('#%s: removing %s from all rooms', serverId, id);

    const rooms = this.sids[id];
    const adapter = this;

    if (!rooms) {
      if (fn) process.nextTick(callback.bind(null, null));
      return;
    }

    async.forEach(Object.keys(rooms), function(room, next){
      adapter.del(id, room, next);
    }, function(error){
      if (error) {
        adapter.emit('error', error);
        callback && callback(error);
        return;
      }
      delete adapter.sids[id];
      callback && callback(null);
    });
  };

  return AMQPAdapter;
}

module.exports = adapter;
