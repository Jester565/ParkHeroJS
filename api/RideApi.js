var authManager = require('../core/AuthManager');
var disRides = require('../dis/Ride');
var rideManager = require('../core/RideManager');
var resortManager = require('../core/ResortManager');
var predictionManager = require('../core/Predictions');
var commons = require('./Commons');
var moment = require('moment-timezone');
var config = require('./config');

var query = commons.getDatabaseQueryMethod();

var RESORT_ID = 80008297;
var RIDE_IMG_SIZES = [200, 350, 500, 1000];

async function addRideInformations() {
    var AWS = require('aws-sdk');
    AWS.config.update({region: config.region});

    var s3 = new AWS.S3();

    await rideManager.addRideInformations(RESORT_ID, RIDE_IMG_SIZES, 'disneyapp3', s3, query);
}

async function updateCustomAttractionInfo(body, userID) {
    var AWS = require('aws-sdk');
    AWS.config.update({region: config.region});

    var s3 = new AWS.S3();

    var attractionID = body["attractionID"];
    var customName = body["customName"];
    var pics = body["pics"];
    var promises = [];
    promises.push(rideManager.updateCustomAttractionName(attractionID, customName, userID, query));
    promises.push(rideManager.updateCustomAttractionPics(attractionID, pics, RIDE_IMG_SIZES, userID, s3, query));
    await Promise.all(promises);
    
    return await rideManager.getAttractionInfo(attractionID, userID, query);
}

async function getSavedRides(_, userID) {
    var tz = await resortManager.getResortTimezone(RESORT_ID, query);
    var now = moment().tz(tz);
    var nextHourDateTime = now.clone().add(1, 'hours');
    
    var predictionPromises = [
        predictionManager.getPredictTimeHeuristics(now, query), 
        predictionManager.getPredictTime(now, query), 
        predictionManager.getPredictTime(nextHourDateTime, query)];

    var customInfoPromises = [
        rideManager.getCustomAttractionNames(userID, query),
        rideManager.getCustomAttractionPics(userID, query)
    ];

    var savedRides = await rideManager.getSavedRides(query, true);
    
    var predictions = await Promise.all(predictionPromises);

    var customInfos = await Promise.all(customInfoPromises);
    var customNames = customInfos[0];
    var customPics = customInfos[1];

    var results = [];
    for (var ride of savedRides) {
        var waitRating = rideManager.getWaitRating(ride, predictions);
        var customNameArr = customNames[ride.id];
        var customRidePics = customPics[ride.id];
        results.push({
            "id": ride.id,
            "info": {
                "name": (customNameArr)? customNameArr[0]: ride["name"],
                "officialName": ride["name"],
                "picUrl": (customRidePics)? customRidePics[0]: ride["imgUrl"],
                "officialPicUrl": ride["imgUrl"],
                "land": ride["land"],
                "height": ride["height"],
                "labels": ride["labels"],
                "customPicUrls": customRidePics
            },
            "time": {
                "status": ride["status"],
                "waitRating": waitRating,
                "changedTime": ride["lastChangeTime"],
                "changedRange": ride["lastChangeRange"],
                "waitTime": ride["waitMins"],
                "fastPassTime": ride["fastPassTime"]
            }
        });
    }
    return results;
}

async function getRides(_, userID) {
    var rideTimeArgPromises = [
        authManager.getAPIToken(query),
        resortManager.getResortTimezone(RESORT_ID, query),
        resortManager.getParks(RESORT_ID, query)
    ];
    
    var AWS = require('aws-sdk');
    AWS.config.update({region: config.region});
    
    var sns = new AWS.SNS();

    var rideTimeArgs = await Promise.all(rideTimeArgPromises);
    var apiToken = rideTimeArgs[0];
    var tz = rideTimeArgs[1];
    var parks = rideTimeArgs[2];
    var parkIDs = [];
    for (var park of parks) {
        parkIDs.push(park.id);
    }

    var getUpdatedRideTimes = async () => {
        var rideTimes = await disRides.getRideTimes(apiToken, parkIDs);
        var updatedRideTimes = await rideManager.getUpdatedRideTimes(rideTimes, query);
        return updatedRideTimes;
    };
    var getUpdatedRideTimesPromise = getUpdatedRideTimes();
    
    var now = moment().tz(tz);
    var nextHourDateTime = now.clone().add(1, 'hours');
    var predictionPromises = [
        predictionManager.getPredictTimeHeuristics(now, query), 
        predictionManager.getPredictTime(now, query), 
        predictionManager.getPredictTime(nextHourDateTime, query)];

    var updatedRideTimes = await getUpdatedRideTimesPromise;
    
    var msg = JSON.stringify({"default": JSON.stringify(updatedRideTimes)});
    var params = {
        Message: msg,
        MessageStructure: 'json',
        TopicArn: config.sns.rideUploadTopicArn
    };
    var snsPublishPromise = sns.publish(params).promise();

    var predictions = await Promise.all(predictionPromises);

    var results = [];
    for (var rideTime of updatedRideTimes) {
        var waitRating = rideManager.getWaitRating(rideTime, predictions);
        results.push({
            "id": rideTime.id,
            "time": {
                "status": rideTime["status"],
                "waitRating": waitRating,
                "waitTime": rideTime["waitMins"],
                "fastPassTime": rideTime["fastPassTime"]
            }
        });
    }
    await snsPublishPromise;

    return results;
}

async function getRideDPs(body, _) {
    var rideID = body["rideID"];
    var dateStr = body["date"];
    var date = moment(dateStr, "YYYY-MM-DD");
    var tz = await resortManager.getResortTimezone(RESORT_ID, query);
    var now = moment().tz(tz);
    var rideDPs = await rideManager.getRideDPs(date, now, tz, query, rideID);
    return rideDPs;
}

async function updateRides(updatedRideTimes) {
    var tz = await resortManager.getResortTimezone(RESORT_ID, query);
    var watchUpdates = await rideManager.getWatchUpdates(updatedRideTimes, tz, query);
    await rideManager.saveLatestRideTimes(updatedRideTimes, tz, query);
    if (watchUpdates.length > 0) {
        var AWS = require('aws-sdk');
        AWS.config.update({region: config.region});
        
        var sns = new AWS.SNS();
        var snsPromises = [];
        for (var userUpdate of watchUpdates) {
            console.log("SEND SNS: ", userUpdate.userID, " BODY: ", JSON.stringify(userUpdate, null, 2));
            snsPromises.push(commons.sendSNS(userUpdate.userID, 'watchUpdate', userUpdate, sns));
        }
        await Promise.all(snsPromises);
    }
}

async function addHistoricalRideTimes() {
    var parks = await resortManager.getParks(RESORT_ID, query);
    var parkIDs = [];
    for (var park of parks) {
        parkIDs.push(park.id);
    }
    var tz = await resortManager.getResortTimezone(RESORT_ID, query);
    var token = await authManager.getAPIToken(query);
    var rideTimes = await disRides.getRideTimes(token, parkIDs);
    await rideManager.saveToHistoricalRideTimes(rideTimes, tz, query);
    var updatedRideTimes = await rideManager.getUpdatedRideTimes(rideTimes, query);
    await rideManager.saveLatestRideTimes(updatedRideTimes, tz, query);
}

async function getFilters(_, userID) {
    var tz = await resortManager.getResortTimezone(RESORT_ID, query);
    return await rideManager.getFilters(userID, tz, query);
}

async function updateFilter(body, userID) {
    var filterName = body["filterName"];
    var attractionIDs = body["attractionIDs"];
    var watchConfig = body["watchConfig"];
    var filterType = body["filterType"];
    var tz = await resortManager.getResortTimezone(RESORT_ID, query);
    await rideManager.updateFilter(filterName, attractionIDs, filterType, watchConfig, userID, tz, query);
}

async function deleteFilters(body, userID) {
    var filterNames = body["filterNames"];
    var filterType = body["filterType"];
    await rideManager.deleteFilters(filterNames, filterType, userID, query);
}

module.exports = {
    addRideInformations: addRideInformations,
    getSavedRides: getSavedRides,
    getRides: getRides,
    getRideDPs: getRideDPs,
    updateRides: updateRides,
    addHistoricalRideTimes: addHistoricalRideTimes,
    updateCustomAttractionInfo: updateCustomAttractionInfo,
    getFilters: getFilters,
    updateFilter: updateFilter, 
    deleteFilters: deleteFilters
};
