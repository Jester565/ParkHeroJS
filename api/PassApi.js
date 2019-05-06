var config = require('./config');
var userManager = require('../core/User');
var passManager = require('../core/PassManager');
var commons = require('./Commons');
var authManager = require('../core/AuthManager');
var resortManager = require('../core/ResortManager');
var disPasses = require('../dis/Pass');
var moment = require('moment-timezone');

var query = commons.getDatabaseQueryMethod();

var RESORT_ID = 80008297;

/*
    Response: [
        {
            user: {
                id,
                name,
                profilePicUrl
            },
            passes: [{
                id,
                name,
                type,
                expirationDT,
                isPrimary,
                isEnabled,
                hasMaxPass
            }]
        }
    ]
*/
async function getUserPasses(body, userID) {
    var reqUserID = body["userID"];
    if (reqUserID != null && reqUserID != userID) {
        var checkPromises = [
            userManager.areFriends(userID, [reqUserID], query),
            userManager.getPartyMembers(userID, query)
        ];
        var checkResults = await Promise.all(checkPromises);
        if (checkResults[0]) {
            userID = reqUserID;
        } else {
            for (var partyMember of checkResults[1]) {
                if (partyMember.id == reqUserID) {
                    userID = reqUserID;
                }
            }
        }
        if (userID != reqUserID) {
            throw "User is not friend or party member";
        }
    }
    var tz = await resortManager.getResortTimezone(RESORT_ID, query);
    var userPasses = await passManager.getPassesForUsers([userID], true, tz, query);
    return userPasses;
}

/*
    Response: {
        userPasses: 
        [
            {
                user: {
                    id,
                    name,
                    profilePicUrl
                },
                passes: [{
                    id,
                    name,
                    type,
                    expirationDT,
                    isPrimary,
                    isEnabled,
                    hasMaxPass
                }]
            }
        ],
        splitters: [String]
    }
*/
async function getPartyPasses(_, userID) {
    var tz = await resortManager.getResortTimezone(RESORT_ID, query);
    var partyID = await userManager.getPartyID(userID, query);
    var partyMembers = await userManager.getPartyMembers(userID, query);
    var userIDs = [];
    for (var partyMember of partyMembers) {
        userIDs.push(partyMember.id);
    }
    if (userIDs.length == 0) {
        userIDs.push(userID);
    }
    console.log("USERID: ", userID);
    console.log("USERIDS: ", JSON.stringify(userIDs));
    var userPasses = await passManager.getPassesForUsers(userIDs, true, tz, query);
    var splitters = await passManager.getSplitters(partyID + ":" + "party", query);
    return {
        userPasses: userPasses,
        splitters: splitters
    };
}

async function getFriendPasses(_, userID) {
    var tz = await resortManager.getResortTimezone(RESORT_ID, query);
    var friends = await userManager.getFriends(userID, query);
    var userIDs = [userID];
    for (var friend of friends) {
        userIDs.push(friend.id);
    }
    var userPasses = await passManager.getPassesForUsers(userIDs, true, tz, query);
    return userPasses;
    
}

/*
    body: {
        groupID,
        action
    }
    ---
    response: [String]
*/
async function updateSplitters(body, userID) {
    var groupID = body["groupID"];
    var action = body["action"];
    var partyID = await userManager.getPartyID(userID, query);
    if (partyID == null) {
        throw "User not in party";
    }
    var realGroupID = partyID + ":" + groupID;
    if (action == "split") {
        await passManager.splitPasses(realGroupID, userID, query);
    } else if (action == "unsplit") {
        await passManager.unsplitPasses(realGroupID, userID, query);
    } else if (action == "merge") {
        await passManager.mergePasses(realGroupID, query);
    } else {
        throw "Unknown action: " + action;
    }
    var splitters = await passManager.getSplitters(realGroupID, query);
    return {
        groupID: groupID,
        splitters: splitters
    };
}

/*
    body: {
        passID,
        isPrimary,
        isEnabled
    }
*/
async function updatePass(body, userID) {
    var tz = await resortManager.getResortTimezone(RESORT_ID, query);
    var passID = body["passID"];
    var isPrimary = body["isPrimary"];
    var isEnabled = body["isEnabled"];
    
    var loginRes = await authManager.getAccessToken('0', config.dis.username, config.dis.password, query);
    var accessToken = loginRes.accessToken;
    var user = userManager.getUser(userID, query);
    var pass = await passManager.updatePass(userID, passID, isPrimary, isEnabled, accessToken, tz, query);
    return {
        "user": user,
        "pass": pass
    };
}

async function refreshPass(passID, accessToken, tz) {
    try {
        var passInfo = await disPasses.getParsedPass(passID, accessToken, tz);
        var maxPassDateStr = null;
        if (passInfo.hasMaxPass) {
            maxPassDateStr = moment().tz(tz).subtract(4, 'hours').format("YYYY-MM-DD HH:mm:ss");
        }
        var expireDTStr = (passInfo.expireDT)? passInfo.expireDT.format("YYYY-MM-DD HH:mm:ss"): null;
        await query(`UPDATE ParkPasses SET expirationDT=?, maxPassDate=? WHERE id=?`, [expireDTStr, maxPassDateStr, passID]);
    } catch (e) {
        console.log("PASS INFO ERROR: ", e);
    }
}

/*
    body: {
        passID
    }
*/
async function removePass(body, userID) {
    var passID = body["passID"];
    await passManager.removePass(userID, passID, query);
}

async function refreshPasses(body, userID) {
    var tz = await resortManager.getResortTimezone(RESORT_ID, query);
    var loginRes = await authManager.getAccessToken('0', config.dis.username, config.dis.password, query);
    var accessToken = loginRes.accessToken;
    var partyMembers = await userManager.getPartyMembers(userID, query);
    var userIDs = [];
    for (var partyMember of partyMembers) {
        userIDs.push(partyMember.id);
    }
    var passInfoPromises = [];
    var allUserPasses = await passManager.getPassesForUsers(userIDs, true, tz, query);
    for (var userPasses of allUserPasses) {
        for (var pass of userPasses.passes) {
            passInfoPromises.push(refreshPass(pass.id, accessToken, tz));
        }
    }
    await Promise.all(passInfoPromises);
    return "Done";
}

/*
    body: {
        passID
    }
*/
async function syncPasses(body, userID) {
    var tz = await resortManager.getResortTimezone(RESORT_ID, query);
    var passID = body["passID"];
    var disIDs = await query(`SELECT disID FROM ParkPasses WHERE id=?`, passID);
    if (disIDs.length == 0) {
        throw "No Matching Pass";
    }
    var disID = disIDs[0].disID;
    var loginRes = await authManager.getAccessToken('0', config.dis.username, config.dis.password, query);
    var accessToken = loginRes.accessToken;
    var partyMembers = await userManager.getPartyMembers(userID, query);
    var userIDs = [];
    for (var partyMember of partyMembers) {
        userIDs.push(partyMember.id);
    }
    var passIDs = [];
    var allUserPasses = await passManager.getPassesForUsers(userIDs, true, tz, query);
    for (var userPasses of allUserPasses) {
        for (var pass of userPasses.passes) {
            passIDs.push(pass.id);
        }
    }
    
    await disPasses.fillPartyWithPasses(passIDs, disID, accessToken);
    return "Done";
}

module.exports = {
    getUserPasses: getUserPasses,
    getPartyPasses: getPartyPasses,
    getFriendPasses: getFriendPasses,
    updateSplitters: updateSplitters,
    updatePass: updatePass,
    removePass: removePass,
    refreshPasses: refreshPasses,
    syncPasses: syncPasses
};