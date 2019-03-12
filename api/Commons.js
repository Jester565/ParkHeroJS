const config = require('./config');
const util = require('util');
const mysql = require('mysql'); // or use import if you use TS

function getDatabaseQueryMethod() {
    var connection = null;
    connection = mysql.createConnection({
        host: config.mysql.host,
        user: config.mysql.user,
        password: config.mysql.password,
        database: config.mysql.database,
        port: config.mysql.port
    });
    return util.promisify(connection.query).bind(connection);
}


async function sendSNS(userID, type, payload, sns) {
	var topicArn = config.sns.prefix + ":" + userID.substring(userID.indexOf(':') + 1);
	//POSSIBLE PROBLEM: May have to stringify the value of default
	var msg = JSON.stringify({"default": JSON.stringify({"type": type, "payload": payload})});
    try {
        await sns.publish({
            Message: msg,
            MessageStructure: 'json',
            TopicArn: topicArn
        }).promise();
    } catch (e) {
        //Failed to publish, likely to user not linking endpoint
        console.log("Failed to publish to ", userID, ": ", e);
    }
}

module.exports = {
    getDatabaseQueryMethod: getDatabaseQueryMethod,
    sendSNS: sendSNS
};