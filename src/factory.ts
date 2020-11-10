import Errors = require('common-errors')
import is from '@sindresorhus/is'
import { AMQPAdapter } from './adapter'
import { Transport } from './transport'
import type { Namespace } from 'socket.io'

/**
 * Adapter Factory
 */
export const AdapterFactory = (transport: Transport) => function factory(namespace: Namespace): AMQPAdapter {
  return new AMQPAdapter(namespace, transport)
}

/**
 * @param options
 */
AdapterFactory.fromOptions = (options: any = {}) => {
  if (is.object(options) === false) {
    throw new Errors.ArgumentError('options')
  }

  const transport = new Transport(options)
  return AdapterFactory(transport)
}

export default AdapterFactory
