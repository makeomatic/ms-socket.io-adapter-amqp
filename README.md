# ms-socket.io-adapter-amqp

[![npm version](https://badge.fury.io/js/ms-socket.io-adapter-amqp.svg)](https://badge.fury.io/js/ms-socket.io-adapter-amqp)
[![Build Status](https://semaphoreci.com/api/v1/makeomatic/ms-socket-io-adapter-amqp/branches/master/shields_badge.svg)](https://semaphoreci.com/makeomatic/ms-socket-io-adapter-amqp)

## How to use

```bash
npm i ms-socket.io-adapter-amqp -S
```

```js
const AdapterFactory = require('ms-socket.io-adapter-amqp');
const adapter = AdapterFactory.fromOptions(/* options object */);
const socketIO = require('socket.io')(3000);
socketIO.adapter(adapter);
```

## Overview

By running socket.io with the `ms-socket.io-adapter-amqp` adapter
you can run multiple socket.io instances in different processes or
servers that can all broadcast and emit events to and from each other.

## API

### `AdapterFactory.fromOptions(options)`

`options`: [@microfleet/transport-amqp](https://github.com/microfleet/transport-amqp) options

Options that has no effect:

* `exchangeArgs.autoDelete` (`true`)
* `exchangeArgs.type` (`direct`)
* `defaultQueueOpts.autoDelete` (`true`)
* `defaultQueueOpts.exclusive` (`true`)

## Changelog

- Initial Release: 01.07.2016
- ---

## License

MIT
