var authManager = require('../core/AuthManager');
var disRides = require('../dis/Ride');
var rideManager = require('../core/RideManager');
var rideAPI = require('./RideApi');
var resortManager = require('../core/ResortManager');
var fastPassManager = require('../core/FastPassManager');
var commons = require('./Commons');
var config = require('./config');
var moment = require('moment-timezone');

var query = commons.getDatabaseQueryMethod();

var RESORT_ID = 80008297;

async function pollRideUpdates(parkDate, tz) {
    var parkDateStr = parkDate.format("YYYY-MM-DD");
    var activeWatchFiltersResult = await query(`SELECT COUNT(*) AS activeCount FROM WatchFilters WHERE watchDate=?`, [parkDateStr]);
    var activeWatchFilterCount = activeWatchFiltersResult[0].activeCount;
    
    if (activeWatchFilterCount > 0) {
        var parks = await resortManager.getParks(RESORT_ID, query);
        var parkIDs = [];
        for (var park of parks) {
            parkIDs.push(park.id);
        }
        var token = await authManager.getAPIToken(query);
        var rideTimes = await disRides.getRideTimes(token, parkIDs);
        var updatedRides = await rideManager.getUpdatedRideTimes(rideTimes, query);
        await rideAPI.updateRides(updatedRides);
    }
}

async function pollFastPassUpdates(parkDate, tz) {
    var transactions = await fastPassManager.getActiveTransactions(moment().tz(tz), parkDate, tz, query);
    if (transactions.length > 0) {
        var loginRes = await authManager.getAccessToken('0', config.dis.username, config.dis.password, query);
        var accessToken = loginRes.accessToken;
        var updates = await fastPassManager.pollMaxPassOrders(transactions, RESORT_ID, accessToken, parkDate, tz, query);
        var snsPromises = [];
        for (var userID in updates) {
            var AWS = require('aws-sdk');
            AWS.config.update({region: config.region});
            var sns = new AWS.SNS();
        
            snsPromises.push(commons.sendSNS(userID, "fastPass", updates[userID], sns));
        }
        await Promise.all(snsPromises);
    }
}

async function pollUpdates() {
    var tz = await resortManager.getResortTimezone(RESORT_ID, query);
    var parkDate = moment().tz(tz).subtract(4, 'hours');
    await Promise.all([
        pollRideUpdates(parkDate, tz),
        pollFastPassUpdates(parkDate, tz)
    ]);
}

module.exports = {
    pollUpdates: pollUpdates
};
