var config = require('./config');

const util = require('util');
const mysql = require('mysql'); // or use import if you use TS

var username = config.dis.username;
var password = config.dis.password;

var connection = null;
connection = mysql.createConnection({
    host: config.mysql.host,
    user: config.mysql.user,
    password: config.mysql.password,
    database: config.mysql.database,
    port: config.mysql.port
});
const query = util.promisify(connection.query).bind(connection);

var auth = require('../dis/Auth');

test('login', async () => {
    var tokenInfo = await auth.login(username, password);
    expect(tokenInfo["accessToken"]).toBeTruthy();
    var refreshedTokenInfo = await auth.getAccessToken(tokenInfo);
    expect(tokenInfo).toEqual(refreshedTokenInfo);
    console.log("REFRESH TIME: ", tokenInfo["refreshTime"]);
    tokenInfo["refreshTime"] = tokenInfo["refreshTime"] - 60 * 60 * 1000;
    console.log("REFRESH TIME2: ", tokenInfo["refreshTime"]);
    refreshedTokenInfo = await auth.getAccessToken(tokenInfo);
    expect(tokenInfo["accessToken"]).not.toBe(refreshedTokenInfo["accessToken"]);
    refreshedTokenInfo["loginTTL"] = 0;
    
    var error = null;
    try {
        await auth.getAccessToken(refreshedTokenInfo);
    } catch (e) {
        error = e;
    }
    expect(error).toBeTruthy();
});
