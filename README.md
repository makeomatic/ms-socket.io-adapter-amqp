# ms-socket.io-adapter-amqp

## How to use

```js
const socketIO = require('socket.io')(3000);
const AdapterFactory = require('ms-socket.io-adapter-amqp');
const options = {
  // ms-amqp-transport options e.g.
  //{
  //  exchange: 'my-exchange',
  //  connection: {
  //    host: 'localhost',
  //    port: 5672,
  //  }
  //}
};
socketIO.adapter(AdapterFactory.fromOptions(options));
```

By running socket.io with the `ms-socket.io-adapter-amqp` adapter 
you can run multiple socket.io instances in different processes or 
servers that can all broadcast and emit events to and from each other.

## License

MIT
