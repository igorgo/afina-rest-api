/* eslint-disable no-console */

const Server = require('../index')
    , assert = require('assert')
    , http = require('http')

/**
 * Main test function
 * @returns {Promise.<void>} noting
 */
const tst = async () => {
    /**
     * @type AfinaApiServer
     */
    const server = new Server({
        apiRoot: '/appi',
        listenPort: 3200
    })
    assert.equal(server.status, 'off', 'Wrong status')

    await server.start()
    assert.equal(server.status, 'on', 'Wrong status')

    server.addApi('get','/test/:id',(req, res) => {
        res.sendStatus(404)
    })

    /**
     * request
     * @returns {Promise} response
     */
    const request = () => {
        return new Promise(resolve => {
            http.get('http://localhost:3200/appi/test/16', (res) => resolve(res))
        })
    }

    assert.equal((await request()).statusCode,'404','response error')

    await server.stop()
    assert.equal(server.status, 'off', 'Wrong status')
}

tst()
    .then(() => process.exit(0))
    .catch(e => {
        console.log(e)
        process.exit(1)
    })