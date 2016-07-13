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

`options`: [ms-amqp-transport](https://github.com/makeomatic/ms-amqp-transport) options

Allowed options:

* `name`
* `exchange`: exchange name, default `socket.io-adapter-amqp`
* `connection`
    * `host`
    * `port`
    * `login`
    * `password`
    * `vhost`

## Changelog

- Initial Release: 01.07.2016

## License

MIT
