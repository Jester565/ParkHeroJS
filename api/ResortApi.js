var config = require('./config');
var resortManager = require('../core/ResortManager');
var commons = require('./Commons');

var query = commons.getDatabaseQueryMethod();

var RESORT_ID = 80008297;

/*
body: [
    {
        parkName,
        blockLevel,
        crowdLevel,
        openTime,
        closeTime,
        magicStartTime
    }
]
*/
async function getSchedules() {
    var tz = await resortManager.getResortTimezone(RESORT_ID, query);
    var parkSchedules = await resortManager.getSchedules(RESORT_ID, moment().tz(tz), query);
    return parkSchedules;
}

/*
body: [
    {
        dateTime,
        rainStatus,
        feelsLikeF
    }
]
*/
async function getWeather(body) {
    var date = moment(body["date"], "YYYY-MM-DD");
    var forecasts = await resortManager.getHourlyWeather(RESORT_ID, date, query);
    return forecasts;
}

module.exports = {
    getSchedules: getSchedules,
    getWeather: getWeather
}