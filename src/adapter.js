const Adapter = require('socket.io-adapter');
const debug = require('debug')('socket.io-adapter-amqp:adapter');
const Errors = require('common-errors');
const is = require('is');
const Namespace = require('socket.io/lib/namespace');
const Promise = require('bluebird');
const Transport = require('./transport');

/**
 *
 */
class AMQPAdapter extends Adapter {
  /**
   * @param {Namespace} namespace
   * @param {Transport} transport
   */
  constructor(namespace, transport) {
    if (namespace instanceof Namespace === false) {
      throw new Errors.ArgumentError('namespace');
    }

    if (transport instanceof Transport === false) {
      throw new Errors.ArgumentError('transport');
    }

    super(namespace);
    this.transport = transport;
    this.routingKey = transport.makeRoutingKey(namespace.name);

    transport.bindRoutingKey(this.routingKey);
    transport.adapters.set(namespace.name, this);
    debug('#%s: namespace %s was created', transport.serverId, namespace.name);
  }

  /**
   * @param packet
   * @param options
   * @param fromAnotherNode
   */
  broadcast(packet, options, fromAnotherNode = false) {
    super.broadcast(packet, options);

    // if broadcasting from local node, need to broadcast to another nodes
    // else means that message came from amqp and already broadcasted
    if (fromAnotherNode === false) {
      const routingKey = this.transport.makeRoutingKey(packet.nsp);
      const message = [this.transport.serverId, packet, options];

      if (options.rooms) {
        return Promise.map(
          options.rooms,
          room => this.transport.publish(this.transport.makeRoutingKey(routingKey, room), message)
        );
      }

      return this.transport.publish(routingKey, message);
    }

    return Promise.resolve(true);
  }

  /**
   * @param routingKey
   * @param message
   */
  processMessage(routingKey, message) {
    if (routingKey.startsWith(this.routingKey) === false) {
      debug(
        '#%s: ignore different routing keys %s and %s',
        this.transport.serverId,
        routingKey,
        this.routingKey
      );
      return Promise.resolve(true);
    }

    const args = message;
    const messageServerId = args.shift();

    if (messageServerId === this.transport.serverId) {
      debug('#%s: ignore same server id %s', this.transport.serverId, messageServerId);
      return Promise.resolve(true);
    }

    const packet = args[0];

    if (packet && packet.nsp === undefined) {
      packet.nsp = '/';
    }

    if (!packet || packet.nsp !== this.nsp.name) {
      return debug('#%s: ignore different namespace', this.transport.serverId);
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
    debug('#%s: adding %s to %s ', this.transport.serverId, id, room);
    super.add(id, room);

    const promise = this.transport
      .bindRoutingKey(this.transport.makeRoutingKey(this.nsp.name, room))
      .return(true)
      .catch(error => {
        if (this.listenerCount('error')) {
          this.emit('error', error);
        }
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
    debug('#%s: removing %s from %s', this.transport.serverId, id, room);
    const hasRoom = this.rooms.hasOwnProperty(room);
    let promise;
    super.del(id, room);

    if (hasRoom && !this.rooms[room]) {
      promise = this.transport
        .unbindRoutingKey(this.transport.makeRoutingKey(this.nsp.name, room))
        .return(true)
        .catch(error => {
          if (this.listenerCount('error')) {
            this.emit('error', error);
          }
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
    debug('#%s: removing %s from all rooms', this.transport.serverId, id);

    const rooms = this.sids[id];
    let promise;

    if (rooms) {
      promise = Promise.map(Object.keys(rooms), room => this.del(id, room))
        .tap(() => delete this.sids[id])
        .return(true)
        .catch(error => {
          if (this.listenerCount('error')) {
            this.emit('error', error);
          }
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

module.exports = AMQPAdapter;
