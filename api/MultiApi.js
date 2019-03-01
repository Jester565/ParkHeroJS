var authManager = require('../core/AuthManager');
var disRides = require('../dis/Ride');
var rideManager = require('../core/RideManager');
var rideAPI = require('./RideApi');
var resortManager = require('../core/ResortManager');
var commons = require('./Commons');
var moment = require('moment-timezone');

var query = commons.getDatabaseQueryMethod();

var RESORT_ID = 80008297;

async function pollUpdates() {
    var tz = await resortManager.getResortTimezone(RESORT_ID, query);
    var parkDate = moment().tz(tz).subtract(4, 'hours');
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

module.exports = {
    pollUpdates: pollUpdates
};
