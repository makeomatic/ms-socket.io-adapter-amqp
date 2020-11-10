import Errors = require('common-errors')
import { Server as HttpServer } from 'http'
import { AddressInfo } from 'net'
import _debug = require('debug')
import { expect } from 'chai'
import { Transport } from '../src/transport'
import { AdapterFactory } from '../src'
import { Server as SocketIO, Socket as ServerSocket } from 'socket.io'
import { io as SocketIOClient, Socket as ClientSocket } from 'socket.io-client'
import Bluebird = require('bluebird')
import { once } from 'events'

const debug = _debug('socket.io-adapter-amqp:test')

describe('socket.io-adapter-amqp', function suite() {
  let poolToClose: (HttpServer | SocketIO)[] = []
  let sockets: (ServerSocket | ClientSocket)[] = []

  afterEach(async () => {
    sockets.map(socket => socket.disconnect())
    await Promise.all(poolToClose.map(server => (
      new Promise(resolve => server.close(resolve)))
    ))
    poolToClose = []
    sockets = []
  })

  /**
   * Create a pair of socket.io server+client
   * @param {String} namespace
   */
  async function create(namespace = '/chat'): Promise<[ClientSocket, ServerSocket]> {
    const server = new HttpServer()
    const socketIO = new SocketIO(server)
    const adapter = AdapterFactory.fromOptions()

    socketIO.adapter(adapter)
    poolToClose.push(socketIO, server)
    server.listen()

    await once(server, 'listening')

    const address = server.address() as AddressInfo
    const url = `http://localhost:${address.port}${namespace}`

    debug('listening on %s', url)

    const serverNamespace = socketIO.of(namespace)
    const socket = SocketIOClient(url)
    sockets.push(socket)

    const [[serverSocket]] = await Promise.all([
      once(serverNamespace, 'connection'),
      once(socket, 'connect')
    ])

    // to ensure that socket was able to connect to the amqp room
    await Bluebird.delay(1000)

    return [socket, serverSocket]
  }

  async function openConnections(n: number): Promise<[ClientSocket, ServerSocket][]> {
    const promises = []
    for (let i = 0; i < n; i += 1) {
      promises.push(create())
    }
    return Promise.all(promises)
  }

  describe('create from options', () => {
    it('should throw error when trying to instance with invalid options', function test() {
      expect(() => AdapterFactory.fromOptions()).to.not.throw()
      expect(() => AdapterFactory.fromOptions('localhost')).to.throw(Errors.ArgumentError)
    })

    it('should not be able to set exchange type', function test() {
      const transport = new Transport({ exchangeArgs: { type: 'topic' } })
      expect(transport.transport.config.exchangeArgs.type).to.be.equals('direct')
    })
  })

  describe('broadcasts', () => {
    it('broadcasts to namespace', async () => {
      const [c1, c2] = await openConnections(2)

      const [client1] = c1
      const [client2, serverClient2] = c2

      const promise = new Promise((resolve, reject) => {
        client1.once('woot', (a: any[], b: any) => {
          expect(a).to.eql([])
          expect(b).to.eql({ a: 'b' })
          resolve()
        })

        client2.once('woot', () => {
          reject(new Error('args not passed'))
        })
      })

      serverClient2.broadcast.emit('woot', [], { a: 'b' })
      await promise
    })

    it('broadcasts to rooms', async () => {
      const [c1, c2, c3] = await openConnections(3)

      const [client1, serverClient1] = c1
      const [client2, serverClient2] = c2
      const [client3] = c3

      debug('join?')
      serverClient1.join('woot')
      debug('joined')

      serverClient2.on('do broadcast', () => {
        serverClient2.broadcast.to('woot').emit('broadcast')
      })

      const promise = new Promise((resolve, reject) => {
        client2.on('broadcast', () => {
          reject(new Error('Not in room'))
        })

        client3.on('broadcast', () => {
          reject(new Error('Not in room'))
        })

        client1.on('broadcast', () => {
          debug('broadcast?')
          resolve()
        })

        // does not join, signals broadcast
        debug('do broadcast?')
        client2.emit('do broadcast')
      })

      await promise
    })

    it('doesn\'t broadcast to left rooms', async () => {
      const [c1, c2, c3] = await openConnections(3)
      const [client1, serverClient1] = c1
      const [client2, serverClient2] = c2
      const [client3, serverClient3] = c3

      serverClient1.join('woot')
      serverClient1.leave('woot')

      const promise = await new Promise((resolve, reject) => {
        client1.on('broadcast', () => {
          reject(new Error('Not in room'))
        })

        serverClient2.on('do broadcast', async () => {
          await Bluebird.delay(500)
          serverClient2.broadcast.to('woot').emit('broadcast')
        })

        serverClient3.join('woot')
        client3.on('broadcast', async () => {
          await Bluebird.delay(500)
          resolve()
        })

        client2.emit('do broadcast')
      })

      await promise
    })

    it('deletes rooms upon disconnection', async () => {
      const [[, serverClient]] = await openConnections(1)

      serverClient.join('woot')

      const promise = new Promise((resolve) => {
        // delay is needed because delete happens in async fashion
        // and takes a few ticks
        serverClient.on('disconnect', async () => {
          // needs to unbind listeners, not instant
          await new Promise(resolve => setTimeout(resolve, 50))

          // @ts-expect-error -- testing private properties
          expect(serverClient.adapter.sids.get(serverClient.id)).to.be.undefined
          // @ts-expect-error -- testing room size
          expect(serverClient.adapter.rooms.size).to.be.equal(0)
          resolve()
        })

        serverClient.disconnect()
      })

      await promise
    })
  })
})
