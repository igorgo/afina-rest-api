/*
 * Afina Sequel Api Server
 * Created by igorgo on 08.07.2017.
 */
const express = require('express')
const logger = require('morgan')
const bodyParser = require('body-parser')
const cookieParser = require('cookie-parser')
const fs = require('fs')
const http = require('http')
const rfs = require('rotating-file-stream')
const sessionIdHeader = 'x-afs-session-id'

/**
 * Afina Sequel Api Server
 */
class AfinaApiServer {
    /**
     * Creates An Afina Sequel Api Server instance
     * @param {object} [options] The config options of the server
     * @param {number} [options.listenPort=3000] The port to listen by the server
     * @param {string} [options.logDest] The path to save the log files
     * @param {string} [options.apiRoot='/api'] The root api path in the URL
     * @param {string} [options.staticDest] The path to the static content, if you want to display it at '/' URL
     */
    constructor(options) {
        this._status = 'off'
        this._log = options.logDest || ''
        this._port = options.listenPort || 3000
        this._api = options.apiRoot || '/api'
        this._static = options.staticDest || ''
        this._express = express()
        this._express.use(bodyParser.json())
        this._express.use(bodyParser.urlencoded({extended: false}))
        this._express.use(cookieParser())
        // allow cross origin requests
        this._express.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*')
            res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE')
            res.header('Access-Control-Allow-Headers', 'Content-Type')
            next()
        })
    }
    /**
     * Starts listening the port
     * @returns {Promise<void>} Promise
     * @private
     */
    async _listen() {
        return new Promise((resolve) => {
            this._server.listen(this._port, resolve)
        })
    }

    /**
     * Starts the server
     * @returns {Promise.<AfinaApiServer>} The server instance
     */
    async start() {
        // set logger
        if (this._log) {
            fs.existsSync(this._log) || fs.mkdirSync(this._log)
            // create a rotating write stream
            const accessLogStream = rfs('access.log', {
                interval: '1d', // rotate daily
                path: this._log
            })
            this._express.use(logger(
                `:req[${sessionIdHeader}] :res[${sessionIdHeader}] :remote-addr :date :method :url :status :res[content-length] - :response-time ms`,
                {stream: accessLogStream}
            ))
        }
        this._express.set('port', this._port)
        this._apiRouter = express.Router()
        this._express.use(function (req, res, next) {
            res.setHeader('X-Powered-By', 'Afina Sequel Api Server')
            next()
        })
        this._express.use(this._api, this._apiRouter)
        this._express.use(function (req, res, next) {
            let err = new Error('Not Found')
            err.status = 404
            next(err)
        })
        this._express.use(function (err, req, res) {
            if (err && err.message) {
                // eslint-disable-next-line no-console
                if (err.message.startsWith('ORA-20103: Дальнейшая работа в Системе невозможна')) {
                    res.sendStatus(401)
                } else {
                    res.locals.message = err.message
                    res.locals.error = req.app.get('env') === 'development' ? err : {}
                    res.status(err.status || 500)
                    res.send(err.message)
                }
            }
        })
        // set static content
        if (this._static) {
            this._express.use(express.static(this._static))
            this._express.use('/', (req, res) => {
                res.redirect('index.html')
            })
        }
        this._server = http.createServer(this._express)
        this._server.on('error', error => {
            if (error.syscall !== 'listen') {
                throw error
            }
            const bind = typeof this._port === 'string' ? 'Pipe ' + this._port : 'Port ' + this._port
            // handle specific listen errors with friendly messages
            switch (error.code) {
            case 'EACCES':
                // eslint-disable-next-line no-console
                console.error(bind + ' requires elevated privileges')
                throw error
            case 'EADDRINUSE':
                // eslint-disable-next-line no-console
                console.error(bind + ' is already in use')
                throw error
            default:
                throw error
            }
        })
        this._server.on('listening', () => {
            this._status = 'on'
        })
        await this._listen()
        return this
    }

    /**
     * Stops the server
     * @returns {Promise.<AfinaApiServer>} The server instance
     */
    async stop() {
        return new Promise(resolve => {
            if (this._status === 'on') {
                this._server.close(() => {
                    this._status = 'off'
                    resolve(this)
                })
            }
            else resolve(this)
        })
    }

    /**
     * Exit routine
     * @param {object} options exit option
     * @param {error} err error
     * @returns {Promise.<void>} nothing
     * @private
     */
    async _exitHandler(options, err) {
        if (options.cleanup) {
            await this.stop()
        }
        // eslint-disable-next-line no-console
        if (err) console.log(err.stack)
        if (options.exit) {
            process.exit()
        }
    }

    // noinspection JSUnusedGlobalSymbols
    /**
     * Check the status of the server
     * @returns {string} "on" if server is started, "off" if server is stopped
     */
    get status() {
        return this._status
    }

    /**
     * Add the api route
     * @param {string} method The HTTP method or 'all'
     * @param {string} path The api path (without «/api» prefix)
     * @param {IRequestHandler} RequestHandler The route handler function
     * @return {number} 0
     */
    addApi(method, path, RequestHandler) {
        this._apiRouter[method.toLowerCase()](path, RequestHandler)
        return 0
    }
    /**
     * @callback IRequestHandler
     * @param {IRequest} req The http request, see http://expressjs.com/en/4x/api.html#req
     * @param {IResponse} res The http response see http://expressjs.com/en/4x/api.html#res
     * @param {IRequestHandler} next The next handler function
     */

}

module.exports = AfinaApiServer