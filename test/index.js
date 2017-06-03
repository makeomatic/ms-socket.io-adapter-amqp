/* eslint-disable no-unused-expressions */
const { expect } = require('chai');
const Promise = require('bluebird');
const AdapterFactory = require('../src');
const Errors = require('common-errors');
const http = require('http').Server;
const Transport = require('./../src/transport');
const SocketIO = require('socket.io');
const SocketIOClient = require('socket.io-client');
const debug = require('debug')('socket.io-adapter-amqp:test');

describe('socket.io-adapter-amqp', function suite() {
  /**
   * Create a pair of socket.io server+client
   *
   * @param {Function} callback
   * @param {String} namespace
   */
  function create(callback, namespace = '/chat') {
    const server = http();
    const socketIO = SocketIO(server);
    const adapter = AdapterFactory.fromOptions();

    socketIO.adapter(adapter);
    server.listen((err) => {
      if (err) {
        throw err; // abort tests
      }

      const address = server.address();
      const url = `http://localhost:${address.port}${namespace}`;

      debug('listening on %s', url);

      const serverNamespace = socketIO.of(namespace);
      const socket = SocketIOClient(url);
      const done = callback.bind(null, null, serverNamespace, socket);

      serverNamespace.once('connection', done);
    });
  }

  function openConnections(n) {
    const promises = [];
    for (let i = 0; i < n; i += 1) {
      promises.push(Promise.fromCallback(create, { multiArgs: true }));
    }
    return Promise.all(promises);
  }

  describe('create from options', () => {
    it('should throw error when trying to instance with invalid options', function test() {
      expect(() => AdapterFactory.fromOptions()).to.not.throw();
      expect(() => AdapterFactory.fromOptions('localhost')).to.throw(Errors.ArgumentError);
    });

    it('should not be able to set exchange type', function test() {
      const transport = new Transport({ exchangeArgs: { type: 'topic' } });
      expect(transport.transport._config.exchangeArgs.type).to.be.equals('direct');
    });
  });

  describe('broadcasts', () => {
    it('broadcasts to namespace', function test(done) {
      openConnections(2).spread((c1, c2) => {
        const [, client1] = c1;
        const [, client2, serverClient2] = c2;

        client1.on('woot', (a, b) => {
          expect(a).to.eql([]);
          expect(b).to.eql({ a: 'b' });
          client1.disconnect();
          client2.disconnect();
          done();
        });

        client2.on('woot', () => {
          throw new Error();
        });

        serverClient2.broadcast.emit('woot', [], { a: 'b' });
      })
      .catch(done);
    });

    it('broadcasts to rooms', (done) => {
      openConnections(3).spread((c1, c2, c3) => {
        const [, client1, serverClient1] = c1;
        const [, client2, serverClient2] = c2;
        const [, client3] = c3;

        serverClient1.join('woot');

        serverClient2.on('do broadcast', () => {
          serverClient2.broadcast.to('woot').emit('broadcast');
        });

        client2.on('broadcast', () => {
          throw new Error('Not in room');
        });

        client3.on('broadcast', () => {
          throw new Error('Not in room');
        });

        client1.on('broadcast', () => {
          client1.disconnect();
          client2.disconnect();
          client3.disconnect();
          setTimeout(done, 100);
        });

        // does not join, signals broadcast
        client2.emit('do broadcast');
      })
      .catch(done);
    });

    it('doesn\'t broadcast to left rooms', (done) => {
      openConnections(3).spread((c1, c2, c3) => {
        const [, client1, serverClient1] = c1;
        const [, client2, serverClient2] = c2;
        const [, client3, serverClient3] = c3;

        serverClient1.join('woot');
        serverClient1.leave('woot');

        client1.on('broadcast', () => {
          throw new Error('Not in room');
        });

        serverClient2.on('do broadcast', () => {
          setTimeout(() => {
            serverClient2.broadcast.to('woot').emit('broadcast');
          }, 500);
        });

        serverClient3.join('woot', () => {
          client3.on('broadcast', () => {
            setTimeout(() => {
              client1.disconnect();
              client2.disconnect();
              client3.disconnect();
              done();
            }, 500);
          });

          client2.emit('do broadcast');
        });
      })
      .catch(done);
    });

    it('deletes rooms upon disconnection', (done) => {
      openConnections(1).spread(([, client, serverClient]) => {
        serverClient.join('woot');

        // delay is needed because delete happens in async fashion
        // and takes a few ticks
        serverClient.on('disconnect', () => Promise.delay(250)
          .then(() => {
            expect(serverClient.adapter.sids[serverClient.id]).to.be.undefined;
            expect(serverClient.adapter.rooms).to.be.empty;
            client.disconnect();
            return null;
          })
          .asCallback(done)
        );

        setTimeout(() => {
          serverClient.disconnect();
        }, 1000);
      })
      .catch(done);
    });
  });
});
