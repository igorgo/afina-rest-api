# Rest api for Afina SQL

example

`const Server = require('afina-rest-api')

let server = new Server({
    // server parameters
    "port": 3000,
    "db": require('oracledb'),
    // anonymous user
    "user": '*****',
    "password": '*****',
    "connectString": "*****",
    "schema": "******",
    // session params
    "application": 'Admin',
    "company": 'Организация',
    "language": 'RUSSIAN'
})

server.start()`
