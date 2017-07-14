# Rest api for Afina SQL

example
```javascript
const 
    Server = require('afina-rest-api'),
    path = require('path')

let server = new Server({
    // server parameters
    "port": 3000,
    "log": path.join(__dirname, 'log'),
    "static": path.join(__dirname, 'dist'),
    "db": require('oracledb'),
    // anonymous user
    "user": 'PARUSWEB',
    "password": "parusweb",
    "connectString": "P852ONE",
    "schema": "VMF",
    "release": 8,
    // session params
    "application": 'Admin',
    "company": 'Организация',
    "language": 'RUSSIAN',

})

server.apiRouter.get('/agents', async (req, res, next) => {
    const inParams = req.query;
    let sql = 'select RN, AGNABBR, AGNNAME, AGNIDNUMB from V_AGNLIST'
    let binds = {}
    if (inParams.type) {
        sql += ' where AGNTYPE = :AGNTYPE'
        binds["AGNTYPE"] = inParams.type
    }
    try {
        const conn = await server.getConnection(req)
        try {

            rows = (await conn.execute(sql, binds)).rows
            res.status(200).json(rows)
        }
        finally {
            conn.close()
        }
    }
    catch (err) {
        next(err)
    }
})

server.start()
```
