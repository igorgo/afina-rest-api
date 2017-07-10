/**
 * Created by igorgo on 08.07.2017.
 */
const
    express = require('express'),
    logger = require('morgan'),
    bodyParser = require('body-parser'),
    cookieParser = require('cookie-parser'),
    session = require('express-session'),
    SQLiteStore = require('connect-sqlite3')(session),
    http = require('http')

const normalizePort = (val) => {
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

process.stdin.resume();//so the program will not close instantly

const exitHandler = (options, err) => {
    if (options.cleanup) console.log('clean')
    if (err) console.log(err.stack)
    if (options.exit) {
        console.log('server stopped')
        process.exit()
    }
}

//do something when app is closing
process.on('exit', exitHandler.bind(null, {cleanup: true}));

//catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {exit: true}));

//catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, {exit: true}))

/**
 * creates Afina SQL api server
 * @param {Object} config
 * @param {number} config.port Server's port.
 * @param {Object} config.db oracledb object.
 * @param {Object} config.user The database user name.
 * @param {Object} config.password The password of the database user.
 * @param {Object} config.connectString The Oracle database instance to connect to. </br>The string can be an Easy Connect string, or a Net Service Name from a tnsnames.ora file, or the name of a local Oracle database instance.
 * @param {Object} config.schema The Afina SQL schema.
 * @param {Object} config.application The Afina SQL application code.
 * @param {Object} config.company The Afina SQL company.
 * @param {Object} config.language The Afina SQL language.
 *
 */
class AfinaApiServer {
    constructor(config) {
        this.config = config
        this.express = express()
        this.express.use(logger('dev'))
        this.express.use(bodyParser.json())
        this.express.use(bodyParser.urlencoded({extended: false}))
        this.express.use(cookieParser())
        // allow cross origin requests
        this.express.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
            res.header('Access-Control-Allow-Headers', 'Content-Type');
            next();
        })
        this.express.use(session({
            store: new SQLiteStore,
            secret: 'papuaz',
            resave: false,
            saveUninitialized: false,
            cookie: {maxAge: 2 * 60 * 60 * 1000} // 2 hour
        }))
        this.apiRouter = express.Router()
        this.pubRouter = express.Router()
        this.express.use('/api', this.apiRouter)
        this.express.use('/pub', this.pubRouter)
    }

    async start() {
        this.config.port = normalizePort(this.config.port || '3000')
        this.express.set('port', this.config.port)
        this.pubRouter.post('/login',this._login.bind(this))
        this.pubRouter.post('/logoff',this._logoff.bind(this))
        /* this.express.use((req, res, next) => {
            let err = new Error('Not Found');
            err.status = 404;
            next(err);
        }); */
        this.express.use(function (err, req, res, next) {
            console.log(err.message);
            if (err.message.startsWith('ORA-20103: Дальнейшая работа в Системе невозможна')) {
                req.session.destroy();
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
    }

    async getConnection(token) {
        const conn = await this.pool.getConnection()
        await conn.execute(`alter session set CURRENT_SCHEMA = ${this.config.schema}`)
        if (token) {
            await conn.execute(
                `begin
              PKG_SESSION.VALIDATE_WEB(SCONNECT => :SCONNECT);
            end;`, [token])
        }
        return conn
    }

    async _createPool() {
        console.log('pool is created')
        return await this.db.createPool({
            user: this.config.user,
            password: this.config.password,
            connectString: this.config.connectString
        })
    }

    static async getNewToken() {
        let t = await require('crypto').randomBytes(48)
        return t.toString('hex')
    }

    async _login(req, res, next) {
        const inParams = req.body;
        const conn = await this.getConnection()
        const token =  await AfinaApiServer.getNewToken()
        try {
            await conn.execute(
                `begin
                   PKG_SESSION.LOGON_WEB(SCONNECT        => :SCONNECT,
                                         SUTILIZER       => :SUTILIZER,
                                         SPASSWORD       => :SPASSWORD,
                                         SIMPLEMENTATION => :SAPPLICATION,
                                         SAPPLICATION    => :SAPPLICATION,
                                         SCOMPANY        => :SCOMPANY,
                                         SBROWSER        => :SBROWSER,
                                         SLANGUAGE       => :SLANGUAGE);
                 end;`,
                {
                    "SCONNECT": token,
                    "SUTILIZER": inParams.username,
                    "SPASSWORD": inParams.password,
                    "SAPPLICATION": this.config.application,
                    "SCOMPANY": this.config.company,
                    "SBROWSER": req.header('user-agent'),
                    "SLANGUAGE": this.config.language
                }
            )
            const ncompany = (await conn.execute(
                `select PKG_SESSION.GET_COMPANY as NCOMPANY from dual`
            )).rows[0]["NCOMPANY"]
            res.status(200).json({
                "token": token,
                "ncompany" : ncompany
            })
        }
        catch (err) {
            next(err)
        }
        finally {
            conn.close()
        }
    }

    async _logoff(req, res, next) {
        const inParams = req.body;
        const conn = await this.getConnection()
        try {
            await conn.execute(' begin PKG_SESSION.LOGOFF_WEB(SCONNECT => :SCONNECT); end;',[inParams.token])
            res.sendStatus(200)
        }
        catch (err) {
            next(err)
        }
        finally {
            conn.close()
        }
    }
}

module.exports = AfinaApiServer