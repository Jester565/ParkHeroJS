var config = require('./config');
var moment = require('moment');
var resortManager = require('../core/ResortManager');
var rideManager = require('../core/RideManager');
var commons = require('./Commons');

var query = commons.getDatabaseQueryMethod();

var RESORT_ID = 80008297;

var EVENT_IMG_SIZES = [200, 350, 500, 1000];

async function addForecasts() {
    await resortManager.addForecasts(config.darksky.secret, RESORT_ID, query);
}

async function addSchedules() {
    var AWS = require('aws-sdk');
    AWS.config.update({region: config.region});

    var s3 = new AWS.S3();
    
    var tz = await resortManager.getResortTimezone(RESORT_ID, query);
    var now = moment().tz(tz);
    await resortManager.addSchedules(RESORT_ID, now, tz, EVENT_IMG_SIZES, config.s3.bucket, query, s3);
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

async function getEvents(body, userID) {
    console.log("INVOKED GET EVENTS");
    var dateStr = body["date"];
    var date = moment(dateStr, "YYYY-MM-DD");
    var tz = await resortManager.getResortTimezone(RESORT_ID, query);
    var customInfoPromises = [
        rideManager.getCustomAttractionNames(userID, query),
        rideManager.getCustomAttractionPics(userID, query)
    ];
    
    var events = await resortManager.getEvents(RESORT_ID, date, userID, tz, query);
    var customInfos = await Promise.all(customInfoPromises);
    var customNames = customInfos[0];
    var customPics = customInfos[1];
    for (var event of events) {
        var customNameArr = customNames[event.id];
        var customEventPics = customPics[event.id];
        event.info.name = (customNameArr)? customNameArr[0]: event.info.officialName;
        event.info.picUrl = (customEventPics)? customEventPics[0]: event.info.officialPicUrl;
        event.info.customPicUrls = customEventPics;
    }
    return events;
}

module.exports = {
    addSchedules: addSchedules,
    addForecasts: addForecasts,
    getSchedules: getSchedules,
    getWeather: getWeather,
    getEvents: getEvents
}