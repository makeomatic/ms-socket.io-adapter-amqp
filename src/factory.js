const Errors = require('common-errors');
const is = require('is');
const Namespace = require('socket.io/lib/namespace');
const AMQPAdapter = require('./adapter');
const Transport = require('./transport');

/**
 *
 */
class AdapterFactory {
  /**
   * @param options
   * @returns {AdapterFactory}
   */
  static fromOptions(options = {}) {
    if (is.object(options) === false) {
      throw new Errors.ArgumentError('options');
    }

    const transport = new Transport(options);
    return new AdapterFactory(transport);
  }

  /**
   * @param transport
   * @returns {AdapterFactory.fromOptions}
   */
  constructor(transport) {
    if (transport instanceof Transport === false) {
      throw new Errors.ArgumentError('transport');
    }

    return function factory(namespace) {
      if (namespace instanceof Namespace === false) {
        throw new Errors.ArgumentError('namespace');
      }

      return new AMQPAdapter(namespace, transport);
    };
  }
}

module.exports = AdapterFactory;
