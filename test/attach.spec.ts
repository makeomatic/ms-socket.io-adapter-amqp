import { Server as HttpServer,  } from 'http'
import { AddressInfo } from 'net'

import { Server as SocketioServer } from 'socket.io'
import { io as SocketioClient } from 'socket.io-client'
import { delay } from 'bluebird'

import { AdapterFactory } from '../src'

describe('socket.io-adapter-amqp', () => {
  it('should be able to work using .attach() method', async () => {
    const adapter0 = AdapterFactory.fromOptions()
    const socketioServer0 = new SocketioServer({ adapter: adapter0 })
    const httpServer0 = new HttpServer()

    const adapter1 = AdapterFactory.fromOptions()
    const socketioServer1 = new SocketioServer({ adapter: adapter1 })
    const httpServer1 = new HttpServer()

    socketioServer0.attach(httpServer0)
    socketioServer1.attach(httpServer1)

    // prepare servers
    await new Promise((resolve, reject) => httpServer0.listen().once('listening', resolve).once('error', reject))
    await new Promise((resolve, reject) => httpServer1.listen().once('listening', resolve).once('error', reject))

    // create socket.io clients
    const socketioClient0 = SocketioClient(`http://localhost:${(httpServer0.address() as AddressInfo).port}`)
    const socketioClient1 = SocketioClient(`http://localhost:${(httpServer1.address() as AddressInfo).port}`)

    // listen an event on different servers
    const promise = Promise.all([
      new Promise((resolve) => {
        socketioClient0.on('foo', resolve)
      }),
      new Promise((resolve) => {
        socketioClient1.on('foo', resolve)
      }),
    ])

    // connect to servers
    await new Promise((resolve, reject) => socketioClient0.once('connect', () => resolve(undefined)).once('error', reject))
    await new Promise((resolve, reject) => socketioClient1.once('connect', () => resolve(undefined)).once('error', reject))

    await delay(5000)

    // emit from first server
    socketioServer0.emit('foo', 'bar')

    // event should be on both servers
    await promise

    // disconnect from servers
    await new Promise((resolve, reject) => {
      socketioClient0.once('disconnect', resolve).once('error', reject)
      socketioClient0.close()
    })
    await new Promise((resolve, reject) => {
      socketioClient1.once('disconnect', resolve).once('error', reject)
      socketioClient1.close()
    })

    // close http servers
    await new Promise((resolve, reject) => httpServer0.close().once('close', resolve).once('error', reject))
    await new Promise((resolve, reject) => httpServer1.close().once('close', resolve).once('error', reject))
  })
})
