/* eslint-disable no-unused-expressions */
const { expect } = require('chai');
const AdapterFactory = require('../src');
const Errors = require('common-errors');
const http = require('http').Server;
const Transport = require('./../src/transport');
const Promise = require('bluebird');
const SocketIO = require('socket.io');
const SocketIOClient = require('socket.io-client');

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
      const serverNamespace = socketIO.of(namespace);

      Promise.delay(500).tap(() => {
        callback(serverNamespace, SocketIOClient(url));
      });
    });
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
      create((server1, client1) => {
        create((server2, client2) => {
          client1.on('woot', (a, b) => {
            expect(a).to.eql([]);
            expect(b).to.eql({ a: 'b' });
            client1.disconnect();
            client2.disconnect();
            done();
          });
          server2.on('connection', (c2) => {
            client2.on('woot', () => {
              throw new Error();
            });
            c2.broadcast.emit('woot', [], { a: 'b' });
          });
        });
      });
    });

    it('broadcasts to rooms', (done) => {
      create((server1, client1) => {
        server1.on('connection', (c1) => {
          c1.join('woot');
        });

        create((server2, client2) => {
          server2.on('connection', (c2) => {
            // does not join, performs broadcast
            c2.on('do broadcast', () => {
              c2.broadcast.to('woot').emit('broadcast');
            });
          });

          client2.on('broadcast', () => {
            throw new Error('Not in room');
          });

          create((server3, client3) => {
            server3.on('connection', () => {
              // does not join, signals broadcast
              client2.emit('do broadcast');
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
          });
        });
      });
    });

    it('doesn\'t broadcast to left rooms', (done) => {
      create((server1, client1) => {
        server1.on('connection', (c1) => {
          c1.join('woot');
          c1.leave('woot');
        });

        client1.on('broadcast', () => {
          throw new Error('Not in room');
        });

        create((server2, client2) => {
          server2.on('connection', (c2) => {
            c2.on('do broadcast', () => {
              setTimeout(() => {
                c2.broadcast.to('woot').emit('broadcast');
              }, 500);
            });
          });

          create((server3, client3) => {
            server3.on('connection', (c3) => {
              c3.join('woot', () => {
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
            });
          });
        });
      });
    });

    it('deletes rooms upon disconnection', (done) => {
      create((server, client) => {
        server.on('connection', (c) => {
          c.join('woot');

          // delay is needed because delete happens in async fashion
          // and takes a few ticks
          c.on('disconnect', () => Promise.delay(250)
            .then(() => {
              expect(c.adapter.sids[c.id]).to.be.empty;
              expect(c.adapter.rooms).to.be.empty;
              client.disconnect();
            })
            .asCallback(done)
          );

          setTimeout(() => {
            c.disconnect();
          }, 1000);
        });
      });
    });
  });
});
