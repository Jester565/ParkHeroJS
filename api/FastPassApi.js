var config = require('./config');
var userManager = require('../core/User');
var commons = require('./Commons');
var authManager = require('../core/AuthManager');
var resortManager = require('../core/ResortManager');
var fastPassManager = require('../core/FastPassManager');
var rideManager = require("../core/RideManager");
var coreCommons = require('../core/Commons');
var moment = require('moment-timezone');

var query = commons.getDatabaseQueryMethod();

var RESORT_ID = 80008297;

/*
    plannedTransactions: [{
        id (optional),
        rideID,
        passes: [{
            id,
            priority
        }]
    }]
*/
async function updatePlannedFpTransactions(body, userID) {
    var plannedTransactions = body["plannedTransactions"];
    var partyMembers = await userManager.getPartyMembers(userID, query);
    var partyUserIDs = [];
    for (var partyMember of partyMembers) {
        partyUserIDs.push(partyMember.id);
    }
    var tz = await resortManager.getResortTimezone(RESORT_ID, query);
    var parkDate = moment().tz(tz).subtract(4, 'hours');
    await fastPassManager.updatePlannedTransactions(plannedTransactions, partyUserIDs, parkDate, tz, query);
    var respPromise = await getFastPasses(null, userID);
    var AWS = require('aws-sdk');
    AWS.config.update({region: config.region});
    var sns = new AWS.SNS();
    
    var msg = JSON.stringify({"default": JSON.stringify({})});
    var params = {
        Message: msg,
        MessageStructure: 'json',
        TopicArn: config.sns.pollTopicArn
    };
    await sns.publish(params).promise();
    var resp = await respPromise;
    return resp;
}

async function getRideInfos() {
    var rides = await query(`SELECT id AS rideID, name AS officialName, imgUrl AS officialPicUrl FROM Rides`);
    var ridesMap = coreCommons.indexArray({}, rides, 'rideID');
    return ridesMap;
}

function setTransactionAttraction(transactions, rideInfos, customNames, customPics) {
    for (var transaction of transactions) {
        transaction.attractionID = transaction.rideID;
        if (transaction.attractionID != null) {
            var customNameArr = customNames[transaction.attractionID];
            var customAttractionPics = customPics[transaction.attractionID];
            if (rideInfos[transaction.attractionID] != null) {
                var rideInfo = rideInfos[transaction.attractionID][0];
                transaction.attractionOfficialName = rideInfo.officialName;
                transaction.attractionOfficialPicUrl = rideInfo.officialPicUrl;
                transaction.attractionName = (customNameArr)? customNameArr[0]: rideInfo.officialName,
                transaction.attractionPicUrl = (customAttractionPics)? customAttractionPics[0]: rideInfo.officialPicUrl
            }
        } else {
            transaction.attractionName = "All Experiences";
            transaction.attractionOfficialName = "All Experiences";
            transaction.attractionPicUrl = "rides/allExp";
            transaction.attractionOfficialPicUrl = "rides/allExp";
        }
    }
    return transactions;
}

/*
    Response: {
        transactions: [{
            rideID,
            startDateTime,
            endDateTime,
            passes: [{
                id,
                startDateTime,
                endDateTime
            }]
        }],
        plannedTransactions: [{
            id,
            rideID,
            selectionDateTime,
            fastPassTime,
            passes: [{
                id,
                priority,
                nextSelectionDateTime
            }]
        }],
        allUserPasses: [
            {
                user: {
                    id,
                    profilePicUrl,
                    name
                }
                allPasses: [
                    {
                        pass: {
                            passID,
                            name,
                            expirationDT,
                            type
                        }
                        fastPassInfo: {
                            selectionDateTime,
                            earliestSelectionDateTime
                        ]
                    }
                ]
            }
        ]
    }
*/
async function getFastPasses(body, userID) {
    var attractionPromises = [
        getRideInfos(),
        rideManager.getCustomAttractionNames(userID, query),
        rideManager.getCustomAttractionPics(userID, query)
    ];
    var accessTokenPromise = await authManager.getAccessToken('0', config.dis.username, config.dis.password, query);
    var partyMembers = await userManager.getPartyMembers(userID, query);
    var partyUserIDs = [];
    for (var partyMember of partyMembers) {
        partyUserIDs.push(partyMember.id);
    }
    var tz = await resortManager.getResortTimezone(RESORT_ID, query);
    var parkDate = moment().tz(tz).subtract(4, 'hours');
    var loginRes = await accessTokenPromise;
    var accessToken = loginRes.accessToken;
    var result = await fastPassManager.getFastPasses(RESORT_ID, partyUserIDs, accessToken, parkDate, tz, query);
    var attractionResults = await Promise.all(attractionPromises);
    var rideInfos = attractionResults[0];
    var customNames = attractionResults[1];
    var customPics = attractionResults[2];
    result.transactions = setTransactionAttraction(result.transactions, rideInfos, customNames, customPics);
    result.plannedTransactions = setTransactionAttraction(result.plannedTransactions, rideInfos, customNames, customPics);
    console.log("FP RESP: ", JSON.stringify(result, null, 2));
    return result;
}


module.exports = {
    updatePlannedFpTransactions: updatePlannedFpTransactions,
    getFastPasses: getFastPasses
};