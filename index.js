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
        console.log ('server stopped')
        process.exit()
    }
}

//do something when app is closing
process.on('exit', exitHandler.bind(null,{cleanup:true}));

//catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {exit:true}));

//catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, {exit:true}))


class AfinaApiServer {
    /**
     * creates Afina SQL api server
     * @param config
     */
    constructor(config) {
        this.config = config
        this.expess = express()
        this.expess.use(logger('dev'))
        this.expess.use(bodyParser.json())
        this.expess.use(bodyParser.urlencoded({extended: false}))
        this.expess.use(cookieParser())
        // allow cross origin requests
        this.expess.use((req, res, next) => {
            res.header('Access-Control-Allow-Origin', '*');
            res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE');
            res.header('Access-Control-Allow-Headers', 'Content-Type');
            next();
        })
        this.expess.use(session({
            store: new SQLiteStore,
            secret: 'papuaz',
            resave: false,
            saveUninitialized: false,
            cookie: {maxAge: 2 * 60 * 60 * 1000} // 2 hour
        }))
        this.apiRouter = this.expess.Router()
        this.pubRouter = this.expess.Router()
        this.expess.use('/api', this.apiRouter)
        this.expess.use('/pub', this.pubRouter)
    }
    start() {
        this.config.port = normalizePort(this.config.port || '3000')
        this.expess.set('port', this.config.port)
        this.expess.use((req, res, next) => {
            let err = new Error('Not Found');
            err.status = 404;
            next(err);
        });
        this.expess.use(function (err, req, res, next) {
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
        this.server = http.createServer(this.expess)
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

}

module.exports  = AfinaApiServer