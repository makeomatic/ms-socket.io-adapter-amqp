const { expect } = require('chai');
const Errors = require('common-errors');
const http = require('http').Server;
const SocketIO = require('socket.io');
const SocketIOClient = require('socket.io-client');


var redis = require('redis').createClient;
var adapter = require('../src/adapter');

describe('socket.io-adapter-amqp', function suite() {
  this.timeout(1000 * 60 * 10);
  describe('constructor', function suite() {
    it('should throw error when trying to instance with invalid options', function test() {
      expect(() => adapter()).to.not.throw();
      expect(() => adapter('localhost')).to.throw(Errors.ArgumentError);
    });
  });

  describe('broadcasts', function suite() {
    it('broadcasts to namespace', function test(done) {
      create((server1, client1) => {
        create((server2, client2) => {
          client1.on('woot', (a, b) => {
            expect(a).to.eql([]);
            expect(b).to.eql({a: 'b'});
            client1.disconnect();
            client2.disconnect();
            done();
          });
          server2.on('connection', c2 => {
            client2.on('woot', (a, b) => {
              throw new Error();
            });
            c2.broadcast.emit('woot', [], {a: 'b'});
          });
        });
      });
    });

    it('broadcasts to rooms', function(done) {
      create(function(server1, client1){
        create(function(server2, client2){
          create(function(server3, client3){
            server1.on('connection', function(c1){
              c1.join('woot');
            });

            server2.on('connection', function(c2){
              // does not join, performs broadcast
              c2.on('do broadcast', function(){
                c2.broadcast.to('woot').emit('broadcast');
              });
            });

            server3.on('connection', function(c3){
              // does not join, signals broadcast
              client2.emit('do broadcast');
            });

            client1.on('broadcast', function(){
              client1.disconnect();
              client2.disconnect();
              client3.disconnect();
              setTimeout(done, 100);
            });

            client2.on('broadcast', function(){
              throw new Error('Not in room');
            });

            client3.on('broadcast', function(){
              throw new Error('Not in room');
            });
          });
        });
      });
    });

    it('doesn\'t broadcast to left rooms', function(done) {
      create(function(server1, client1){
        create(function(server2, client2){
          create(function(server3, client3){
            server1.on('connection', function(c1){
              c1.join('woot');
              c1.leave('woot');
            });

            server2.on('connection', function(c2){
              c2.on('do broadcast', function(){
                c2.broadcast.to('woot').emit('broadcast');

                setTimeout(function() {
                  client1.disconnect();
                  client2.disconnect();
                  client3.disconnect();
                  done();
                }, 1000);
              });
            });

            server3.on('connection', function(c3){
              client2.emit('do broadcast');
            });

            client1.on('broadcast', function(){
              throw new Error('Not in room');
            });
          });
        });
      });
    });

    it.only('deletes rooms upon disconnection', function(done){
      create(function(server, client){
        server.on('connection', function(c){
          c.join('woot');
          c.on('disconnect', function() {
            expect(c.adapter.sids[c.id]).to.be.empty();
            expect(c.adapter.rooms).to.be.empty();
            client.disconnect();
            done();
          });
          c.disconnect();
        });
      });
    });
  });

  /**
   * Create a pair of socket.io server+client
   *
   * @param {Function} callback
   * @param {String} namespace
   */
  function create(callback, namespace = '/chat') {
    const server = http();
    const socketIO = SocketIO(server);
    socketIO.adapter(new adapter());
    server.listen(err => {
      if (err) {
        throw err; // abort tests
      }

      const address = server.address();
      const url = 'http://localhost:' + address.port + namespace;
      callback(socketIO.of(namespace), SocketIOClient(url));
    });
  }
});
