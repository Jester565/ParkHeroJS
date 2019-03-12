var config = require('./config');
var moment = require('moment');
var resortManager = require('../core/ResortManager');
var commons = require('./Commons');

var query = commons.getDatabaseQueryMethod();

var RESORT_ID = 80008297;

async function addForecasts() {
    await resortManager.addForecasts(config.darksky.secret, RESORT_ID, query);
}

async function addSchedules() {
    var tz = await resortManager.getResortTimezone(RESORT_ID, query);
    var now = moment().tz(tz);
    await resortManager.addSchedules(RESORT_ID, now, tz, query);
}

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
    var date = moment().tz(tz);
    date.subtract(4, 'hours');
    var parkSchedules = await resortManager.getSchedules(RESORT_ID, date, query);
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
    addSchedules: addSchedules,
    addForecasts: addForecasts,
    getSchedules: getSchedules,
    getWeather: getWeather
}