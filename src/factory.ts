import Errors = require('common-errors');
import is = require('is');
import AMQPAdapter from './adapter'
import Transport from './transport'
import type { Namespace } from 'socket.io'

/**
 *
 */
class AdapterFactory {
  /**
   * @param options
   * @returns {AdapterFactory}
   */
  static fromOptions(options = {}): AdapterFactory {
    if (is.object(options) === false) {
      throw new Errors.ArgumentError('options')
    }

    const transport = new Transport(options)
    return new AdapterFactory(transport)
  }

  /**
   * @param transport
   * @returns {AdapterFactory.fromOptions}
   */
  constructor(transport: Transport) {
    if (transport instanceof Transport === false) {
      throw new Errors.ArgumentError('transport')
    }

    return function factory(namespace: Namespace) {
      return new AMQPAdapter(namespace, transport)
    }
  }
}

export default AdapterFactory
