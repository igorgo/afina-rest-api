/**
 * Created by igorgo on 08.07.2017.
 */
const
    express = require('express'),
    logger = require('morgan'),
    bodyParser = require('body-parser'),
    cookieParser = require('cookie-parser'),
    fs = require('fs'),
    rfs = require('rotating-file-stream'),
    http = require('http'),
    tokenHeader = 'x-afs-token'

/**
 * Creates Afina SQL api server
 * @param {Object} config
 * @param {number} config.port Server's port.
 * @param {string} config.log directory to log requests
 * @param {Object<oracledb.Oracledb>} config.db oracledb object.
 * @param {string} config.user The database user name.
 * @param {string} config.password The password of the database user.
 * @param {string} config.connectString The Oracle database instance to connect to. </br>The string can be an Easy Connect string, or a Net Service Name from a tnsnames.ora file, or the name of a local Oracle database instance.
 * @param {string} config.schema The AfinaSQL schema.
 * @param {number} config.release The AfinaSQL release number.
 * @param {string} config.application The Afina SQL application code.
 * @param {string} config.company The AfinaSQL company.
 * @param {string} config.language The AfinaSQL language.
 *
 */
class AfinaApiServer {
    constructor(config) {
        this.config = config
        this.express = express()
        this.express.use(bodyParser.json())
        this.express.use(bodyParser.urlencoded({extended: false}))
        this.express.use(cookieParser())
        // allow cross origin requests
        this.express.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*')
            res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE')
            res.header('Access-Control-Allow-Headers', 'Content-Type')
            next()
        })
        // set logger
        if (this.config.hasOwnProperty("log") && this.config.log) {
            fs.existsSync(this.config.log) || fs.mkdirSync(this.config.log)
            // create a rotating write stream
            const accessLogStream = rfs('access.log', {
                interval: '1d', // rotate daily
                path: this.config.log
            })
            this.express.use(logger(
                `:req[${tokenHeader}] :res[${tokenHeader}] :date :method :url :status :res[content-length] - :response-time ms`,
                {stream: accessLogStream}
            ))
        }
        this._apiRouter = express.Router()
        this.express.use('/api', this._apiRouter)
        // set static content
        if (this.config.hasOwnProperty("static") && this.config.static) {
            this.express.use(express.static(this.config.static))
            this.express.use('/', (req, res) => {res.redirect('index.html')})
        }
    }

    /**
     * Starts the server
     * @returns {Promise.<void>}
     */
    async start() {
        this.config.port = AfinaApiServer.normalizePort(this.config.port || '3000')
        this.express.set('port', this.config.port)
        this._apiRouter.post('/login', this._login.bind(this))
        this._apiRouter.post('/logoff', this._logoff.bind(this))
        this.express.use(function (err, req, res) {
            console.log(err.message);
            if (err.message.startsWith('ORA-20103: Дальнейшая работа в Системе невозможна')) {
                res.sendStatus(401);
            } else {
                res.locals.message = err.message;
                res.locals.error = req.app.get('env') === 'development' ? err : {};
                res.status(err.status || 500);
                res.send(err.message);
            }
        });

        this.db = this.config.db
        this.db.outFormat = this.db.OBJECT
        this.pool = await this._createPool()

        this.server = http.createServer(this.express)
        this.server.listen(this.config.port)
        this.server.on('error', error => {
            if (error.syscall !== 'listen') {
                throw error;
            }
            const bind = typeof port === 'string' ? 'Pipe ' + port : 'Port ' + port
            // handle specific listen errors with friendly messages
            switch (error.code) {
                case 'EACCES':
                    console.error(bind + ' requires elevated privileges');
                    throw error;
                    break;
                case 'EADDRINUSE':
                    console.error(bind + ' is already in use');
                    throw error;
                    break;
                default:
                    throw error;
            }
        });
        this.server.on('listening', () => {
            const addr = this.server.address()
            const bind = typeof addr === 'string' ? 'pipe ' + addr : 'port ' + addr.port
            console.log('Listening on ' + bind);
        })

        process.stdin.resume();//so the program will not close instantly
        //catches closing app
        process.on('exit', this._exitHandler.bind(this, {cleanup: true}));
        //catches ctrl+c event
        process.on('SIGINT', this._exitHandler.bind(this, {exit: true, cleanup: true}));
        //catches uncaught exceptions
        process.on('uncaughtException', this._exitHandler.bind(this, {exit: true, cleanup: true}))
    }

    /**
     * Exit routine
     * @param options
     * @param err
     * @returns {Promise.<void>}
     * @private
     */
    async _exitHandler(options, err) {
        if (options.cleanup) {
            await this.pool.close()
            console.log('Oracle connection pool terminated')
        }
        if (err) console.log(err.stack)
        if (options.exit) {
            console.log('Server stopped')
            process.exit()
        }
    }

    /**
     * Returns an oracle connection from the pool,
     * sets the schema and switches the utilizer context
     * @param req
     * @returns {Promise.<oracledb.Connection>}
     */
    async getConnection(req) {
        if (!req.headers.hasOwnProperty(tokenHeader)) {
            throw new Error('Unauthorized', 401)
        }
        const token = req.headers[tokenHeader]
        const conn = await this.pool.getConnection()
        await conn.execute(`alter session set CURRENT_SCHEMA = ${this.config.schema}`)
        await conn.execute(
            `begin
              PKG_SESSION.VALIDATE_WEB(SCONNECT => :SCONNECT);
            end;`, [token])
        return conn
    }

    /**
     * Creates an oracle connection pool
     * @returns {Promise.<oracledb.Pool>}
     * @private
     */
    async _createPool() {
        console.log('oracle connection pool created')
        return await this.db.createPool({
            user: this.config.user,
            password: this.config.password,
            connectString: this.config.connectString
        })
    }

    /**
     * Generates the 48-byte token
     * @returns {Promise.<string>}
     */
    static async getNewToken() {
        let t = await require('crypto').randomBytes(24)
        return t.toString('hex')
    }

    /**
     * Port/pipe normalizer
     * @param val
     * @returns {int|string}
     */
    static normalizePort(val) {
        const port = parseInt(val, 10);
        if (isNaN(port)) {
            // named pipe
            return val;
        }
        if (port >= 0) {
            // port number
            return port;
        }
        return false;
    }

    /** End user login.
     * @param req
     * @param res
     * @param next
     * @returns {Promise.<void>}
     * @private
     */
    async _login(req, res, next) {
        const inParams = req.body;
        const conn = await this.pool.getConnection()
        const token = await AfinaApiServer.getNewToken()
        await conn.execute(`alter session set CURRENT_SCHEMA = ${this.config.schema}`)
        const sql = `begin
                   PKG_SESSION.LOGON_WEB(SCONNECT        => :SCONNECT,
                                         SUTILIZER       => :SUTILIZER,
                                         SPASSWORD       => :SPASSWORD,
                                         SIMPLEMENTATION => :SAPPLICATION,
                                         SAPPLICATION    => :SAPPLICATION,
                                         SCOMPANY        => :SCOMPANY,
                                         ${this.config.release >= 8 ? 'SBROWSER        => :SBROWSER' : ''},
                                         SLANGUAGE       => :SLANGUAGE);
                 end;`
        let binds = {
            "SCONNECT": token,
            "SUTILIZER": inParams.username,
            "SPASSWORD": inParams.password,
            "SAPPLICATION": this.config.application,
            "SCOMPANY": this.config.company,
            "SLANGUAGE": this.config.language
        }
        if (this.config.release >= 8) binds["SBROWSER"] = req.header('user-agent')
        try {
            await conn.execute(sql, binds)
            const ncompany = (await conn.execute(
                `select PKG_SESSION.GET_COMPANY as NCOMPANY from dual`
            )).rows[0]["NCOMPANY"]
            res.header(tokenHeader, token)
            res.status(200).json({
                "ncompany": ncompany
            })
        }
        catch (err) {
            next(err)
        }
        finally {
            conn.close()
        }
    }

    /**
     * End user logoff
     * @param req
     * @param res
     * @param next
     * @returns {Promise.<void>}
     * @private
     */
    async _logoff(req, res, next) {
        try {
            const conn = await this.getConnection(req)
            try {
                await conn.execute(' begin PKG_SESSION.LOGOFF_WEB(SCONNECT => :SCONNECT); end;', [req.headers[tokenHeader]])
                res.sendStatus(200)
            }
            finally {
                conn.close()
            }
        }
        catch (err) {
            next(err)
        }
    }

    get apiRouter() {
        return this._apiRouter
    }
}

module.exports = AfinaApiServer