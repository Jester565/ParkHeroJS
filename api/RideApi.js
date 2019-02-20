var authManager = require('../core/AuthManager');
var disRides = require('../dis/Ride');
var rideManager = require('../core/RideManager');
var resortManager = require('../core/ResortManager');
var predictionManager = require('../core/Predictions');
var commons = require('./Commons');
var config = require('./config');

var query = commons.getDatabaseQueryMethod();

var RESORT_ID = 80008297;
var RIDE_IMG_SIZES = [200, 350, 500, 1000];

function getWaitRating(rideTime, predictions) {
    var id = rideTime["id"].toString();
    var predictTimeHeuristic = predictions[0][id];
    var avgWaitMins = null;
    var minWaitMins = null;
    var maxWaitMins = null;
    if (predictTimeHeuristic != null) {
        avgWaitMins = predictTimeHeuristic[0]["avgWaitMins"];
        minWaitMins = predictTimeHeuristic[0]["minWaitMins"];
        maxWaitMins = predictTimeHeuristic[0]["maxWaitMins"];
    }
    var firstPrediction = predictions[1][id];
    var secondPrediction = predictions[2][id];
    var firstPredictionWaitMins = null;
    var secondPredictionWaitMins = null;
    
    if (firstPrediction != null) {
        firstPredictionWaitMins = firstPrediction[0]["waitMins"];
    }
    if (secondPrediction != null) {
        secondPredictionWaitMins = secondPrediction[0]["waitMins"];
    }
    var waitRating = predictionManager.getWaitRating(rideTime["waitMins"], avgWaitMins, minWaitMins, maxWaitMins, firstPredictionWaitMins, secondPredictionWaitMins);
    return waitRating;
}

async function addRideInformations() {
    var AWS = require('aws-sdk');
    AWS.config.update({region: config.region});

    var s3 = new AWS.S3();

    await rideManager.addRideInformations(RESORT_ID, RIDE_IMG_SIZES, 'disneyapp3', s3, query);
}

async function getSavedRides() {
    var tz = await resortManager.getResortTimezone(RESORT_ID, query);
    var predictionPromises = [
        predictionManager.getPredictTimeHeuristics(tz, query), 
        predictionManager.getPredictTime(tz, 0, query), 
        predictionManager.getPredictTime(tz, 1, query)];

    var savedRides = await rideManager.getSavedRides(query, true);
    
    var predictions = await Promise.all(predictionPromises);

    var results = [];
    for (var ride of savedRides) {
        var waitRating = getWaitRating(ride, predictions);
        results.push({
            "id": ride.id,
            "info": {
                "name": ride["name"],
                "picUrl": ride["imgUrl"],
                "land": ride["land"],
                "height": ride["height"],
                "labels": ride["labels"]
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
        var rideTimes = await disRides.getRideTimes(apiToken, parkIDs, tz);
        var updatedRideTimes = await rideManager.getUpdatedRideTimes(rideTimes, query);
        return updatedRideTimes;
    };
    var getUpdatedRideTimesPromise = getUpdatedRideTimes();
 
    var predictionPromises = [
        predictionManager.getPredictTimeHeuristics(tz, query), 
        predictionManager.getPredictTime(tz, 0, query), 
        predictionManager.getPredictTime(tz, 1, query)];

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
        var waitRating = getWaitRating(rideTime, predictions);
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

async function updateRides(updatedRideTimes) {
    var tz = await resortManager.getResortTimezone(RESORT_ID, query);
    await rideManager.saveLatestRideTimes(updatedRideTimes, tz, query);
}

async function addHistoricalRideTimes() {
    var parks = await resortManager.getParks(RESORT_ID, query);
    var parkIDs = [];
    for (var park of parks) {
        parkIDs.push(park.id);
    }
    var tz = await resortManager.getResortTimezone(RESORT_ID, query);
    var token = await authManager.getAPIToken(query);
    var rideTimes = await disRides.getRideTimes(token, parkIDs, tz);
    await rideManager.saveToHistoricalRideTimes(rideTimes, tz, query);
    var updatedRideTimes = await disRides.getUpdatedRideTimes(rideTimes, query);
    await rideManager.saveLatestRideTimes(updatedRideTimes, tz, query);
}

module.exports = {
    addRideInformations: addRideInformations,
    getSavedRides: getSavedRides,
    getRides: getRides,
    updateRides: updateRides,
    addHistoricalRideTimes: addHistoricalRideTimes
};